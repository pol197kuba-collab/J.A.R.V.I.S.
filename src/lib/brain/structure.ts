// Mózg 3D — tryb STRUKTURA: tabele bazy jako planety, klucze obce jako
// połączenia. Czysta logika (bez I/O, bez three.js): przypisanie tabel do
// modułów aplikacji, układ siłowy 3D, rozmiar planet, ochrona sekretów
// w podglądzie danych.

import { normalize, seededRandom, type Vec3 } from "./projection";

export type SchemaColumn = { name: string; type: string; nullable: boolean; pk: boolean };
export type SchemaTable = {
  name: string;
  rls: boolean;
  /** pg_class.reltuples — szacunek dla całej tabeli; -1 = nieznany. */
  rows_estimate: number;
  columns: SchemaColumn[];
  policies: { name: string; command: string }[];
};
export type SchemaForeignKey = {
  table: string;
  column: string;
  ref_table: string;
  ref_column: string;
};
export type SchemaMap = {
  tables: SchemaTable[];
  foreign_keys: SchemaForeignKey[];
  generated_at: string;
};

// ---------- moduły ----------

export type ModuleId = "wiedza" | "agenci" | "rynki" | "paliwa" | "praca" | "system";

export const MODULES: { id: ModuleId; label: string; color: string; dot: string }[] = [
  { id: "wiedza", label: "Wiedza", color: "var(--success)", dot: "bg-success" },
  { id: "agenci", label: "Agenci", color: "var(--primary)", dot: "bg-primary" },
  { id: "rynki", label: "Rynki", color: "var(--warning)", dot: "bg-warning" },
  { id: "paliwa", label: "Paliwa", color: "var(--destructive)", dot: "bg-destructive" },
  { id: "praca", label: "Zadania", color: "var(--accent)", dot: "bg-accent" },
  { id: "system", label: "System", color: "var(--muted-foreground)", dot: "bg-muted-foreground" },
];

const EXACT: Record<string, ModuleId> = {
  memories: "wiedza",
  notes: "wiedza",
  documents: "wiedza",
  document_chunks: "wiedza",
  generated_files: "wiedza",
  agents: "agenci",
  agent_runs: "agenci",
  agent_tools: "agenci",
  tools: "agenci",
  conversations: "agenci",
  messages: "agenci",
  document_jobs: "agenci",
  local_jobs: "agenci",
  tasks: "praca",
  projects: "praca",
  dev_sessions: "praca",
};

/** Do którego modułu aplikacji należy tabela — po nazwie, reszta to System. */
export function tableModule(name: string): ModuleId {
  if (EXACT[name]) return EXACT[name];
  if (name.startsWith("brain_")) return "wiedza";
  if (name.startsWith("market_")) return "rynki";
  if (name.startsWith("orlen_") || name.startsWith("fuel_")) return "paliwa";
  if (name.startsWith("agent")) return "agenci";
  return "system";
}

// ---------- sekrety ----------

/**
 * Tabele, z których podgląd danych nie pokazuje NICZEGO — tylko strukturę.
 * Klucze API, prywatny klucz VAPID, subskrypcje urządzeń: nawet własne nie
 * mają się pojawiać na ekranie telefonu.
 */
export const SENSITIVE_TABLES: ReadonlySet<string> = new Set([
  "user_secrets",
  "push_subscriptions",
]);

// „token” tylko jako końcówka w liczbie pojedynczej (github_token) — liczniki
// typu input_tokens / cache_read_tokens to zwykłe liczby i mają być widoczne.
const SECRET_COLUMN = /(api_?key|secret|password|private|vapid|credential|auth_?key|(^|_)token$)/i;

/** Kolumna, której wartość w podglądzie zamieniamy na kropki. */
export function isSecretColumn(name: string): boolean {
  return SECRET_COLUMN.test(name);
}

/** Kolumny pomijane w podglądzie: wektory i binaria to szum na ekranie. */
export function isPreviewableType(type: string): boolean {
  return !/^(extensions\.)?vector|bytea|tsvector/i.test(type);
}

const CELL_MAX = 140;

/** Wartość komórki jako krótki tekst do karty. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const s =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…` : s;
}

// ---------- planety ----------

/** Promień planety: logarytm liczby wierszy, żeby milion nie zasłonił reszty. */
export function planetRadius(rows: number): number {
  const r = Math.max(0, rows);
  return 0.18 + Math.min(0.5, Math.log10(1 + r) * 0.09);
}

/** Promień mapy tabel w jednostkach sceny (gwiazdy wiedzy mają 1). */
export const MAP_RADIUS = 0.65;
/** W środku mapy świeci słońce — żadna planeta bliżej niż tyle od środka. */
export const MIN_ORBIT = 0.24;

/**
 * Układ siłowy (Fruchterman–Reingold) w 3D, deterministyczny. Tabele
 * połączone kluczem obcym przyciągają się, wszystkie się odpychają, a każdy
 * moduł ma swoje „gniazdo” na sferze, żeby Rynki nie mieszały się z Agentami.
 * Wynik w promieniu ~1 (scena skaluje jak gwiazdy).
 */
export function layoutSchema(
  tables: { name: string; module: ModuleId }[],
  edges: { from: string; to: string }[],
  seed = 7,
  iterations = 400,
): Map<string, Vec3> {
  const n = tables.length;
  const out = new Map<string, Vec3>();
  if (n === 0) return out;
  const rng = seededRandom(seed);
  const index = new Map(tables.map((t, i) => [t.name, i]));

  // Gniazda modułów: równomiernie na sferze (spirala Fibonacciego).
  const moduleIds = MODULES.map((m) => m.id);
  const anchor = new Map<ModuleId, Vec3>(
    moduleIds.map((id, k) => {
      const y = 1 - (2 * (k + 0.5)) / moduleIds.length;
      const r = Math.sqrt(1 - y * y);
      const phi = k * Math.PI * (3 - Math.sqrt(5));
      return [id, [Math.cos(phi) * r * 0.7, y * 0.7, Math.sin(phi) * r * 0.7]];
    }),
  );

  const pos: Vec3[] = tables.map((t) => {
    const a = anchor.get(t.module)!;
    return [a[0] + (rng() - 0.5) * 0.3, a[1] + (rng() - 0.5) * 0.3, a[2] + (rng() - 0.5) * 0.3];
  });
  const links = edges
    .map((e) => [index.get(e.from), index.get(e.to)] as const)
    .filter(
      (l): l is readonly [number, number] =>
        l[0] !== undefined && l[1] !== undefined && l[0] !== l[1],
    );

  const k = 0.9 / Math.cbrt(n); // naturalna odległość
  let temp = 0.12;
  for (let it = 0; it < iterations; it++) {
    const disp: Vec3[] = pos.map(() => [0, 0, 0]);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d: Vec3 = [pos[i][0] - pos[j][0], pos[i][1] - pos[j][1], pos[i][2] - pos[j][2]];
        const dist = Math.max(1e-3, Math.hypot(d[0], d[1], d[2]));
        const f = (k * k) / dist; // odpychanie
        for (let c = 0; c < 3; c++) {
          disp[i][c] += (d[c] / dist) * f;
          disp[j][c] -= (d[c] / dist) * f;
        }
      }
    }
    for (const [a, b] of links) {
      const d: Vec3 = [pos[a][0] - pos[b][0], pos[a][1] - pos[b][1], pos[a][2] - pos[b][2]];
      const dist = Math.max(1e-3, Math.hypot(d[0], d[1], d[2]));
      const f = (dist * dist) / k; // przyciąganie wzdłuż klucza obcego
      for (let c = 0; c < 3; c++) {
        disp[a][c] -= (d[c] / dist) * f;
        disp[b][c] += (d[c] / dist) * f;
      }
    }
    tables.forEach((t, i) => {
      const a = anchor.get(t.module)!;
      for (let c = 0; c < 3; c++) disp[i][c] += (a[c] - pos[i][c]) * 0.6; // do gniazda modułu
      const len = Math.max(1e-6, Math.hypot(disp[i][0], disp[i][1], disp[i][2]));
      const step = Math.min(len, temp);
      for (let c = 0; c < 3; c++) pos[i][c] += (disp[i][c] / len) * step;
    });
    temp *= 0.99;
  }

  // Ta sama skala co galaktyka wiedzy (90% w promieniu 1), tylko ciaśniej —
  // planety są większe od gwiazd i na telefonie mają się mieścić w kadrze.
  const fitted = normalize(pos).map((p, i) => {
    const q = p.map((x) => x * MAP_RADIUS) as Vec3;
    const len = Math.hypot(q[0], q[1], q[2]);
    if (len >= MIN_ORBIT) return q;
    // Za blisko słońca — wypchnij na minimalną orbitę (kierunek: własny
    // albo, dla punktu w samym środku, gniazdo modułu).
    const dir = len > 1e-6 ? q : anchor.get(tables[i].module)!;
    const dl = Math.max(1e-6, Math.hypot(dir[0], dir[1], dir[2]));
    return dir.map((x) => (x / dl) * MIN_ORBIT) as Vec3;
  });
  tables.forEach((t, i) => out.set(t.name, fitted[i]));
  return out;
}
