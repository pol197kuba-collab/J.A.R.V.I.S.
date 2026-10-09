// Agent Town — what happens when you use a prop in walk mode. Builds the
// dialog content (title, line, ▶ options) for each prop; options act on the
// world (your character, Marvel) or navigate. Anything that states a fact
// (documents, run statistics) comes from real data — nothing is invented.

import type { FlowRun } from "@/lib/agents/flow.functions";
import type { DocumentSummary } from "@/lib/documents/documents.functions";
import type { PropContent } from "./TownDialog";
import type { TownWorld } from "./townWorld";
import { isTownAgent, type TownSlug } from "./townMap";
import { propById } from "./townProps";

// ── pure helpers (tested) ──────────────────────────────────────────────────

/** Polish plural: 1 przebieg, 2-4 przebiegi, 5+ przebiegów (12-14 too). */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

const sameDay = (iso: string, now: number) =>
  new Date(iso).toDateString() === new Date(now).toDateString();

/** The lab whiteboard: today's numbers from the run feed (its latest 40 runs). */
export function dailyStats(
  runs: readonly FlowRun[],
  now: number,
  name: (slug: TownSlug) => string,
): string {
  const today = runs.filter((r) => sameDay(r.createdAt, now));
  if (!today.length) return "Dziś jeszcze żadnych przebiegów. Tablica czeka na pierwsze zadanie.";
  const errors = today.filter((r) => r.status === "error").length;
  const per = new Map<string, number>();
  for (const r of today) per.set(r.agentSlug, (per.get(r.agentSlug) ?? 0) + 1);
  const [topSlug, topCount] = [...per.entries()].sort((a, b) => b[1] - a[1])[0];
  const topName = isTownAgent(topSlug) ? name(topSlug) : topSlug;
  const finished = today.filter((r) => r.finishedAt);
  const avg = finished.length
    ? Math.round(
        finished.reduce((s, r) => s + (Date.parse(r.finishedAt!) - Date.parse(r.createdAt)), 0) /
          finished.length /
          1000,
      )
    : null;
  return [
    `Ostatnie przebiegi z dziś: ${today.length} ${plural(today.length, "przebieg", "przebiegi", "przebiegów")}, ${errors} ${plural(errors, "błąd", "błędy", "błędów")}.`,
    `Najaktywniejszy: ${topName} (${topCount}).`,
    avg != null ? `Średni czas zadania: ${avg} s.` : "Nic jeszcze się nie skończyło.",
  ].join("\n");
}

export const GLOBE_SPOTS = [
  "Reykjavík — gorące źródła w środku zimy.",
  "Kioto — tysiąc bram torii na jednym zboczu.",
  "Lizbona — tramwaj 28 i najlepsze pastéis de nata.",
  "Patagonia — wiatr, lodowce i zero zasięgu.",
  "Nowy Jork — tu Tony Stark postawił swoją wieżę.",
  "Zakopane — Giewont w chmurach i oscypek z grilla.",
  "Kapsztad — Góra Stołowa nad oceanem.",
  "Tromsø — zorza polarna nad fiordem.",
];

/** Width of the green "bug" zone (fraction of the bar) at a given score. */
export const zoneWidth = (score: number) => Math.max(0.08, 0.26 - score * 0.018);
/** Marker speed (bar widths per second) at a given score. */
export const markerSpeed = (score: number) => 0.55 + score * 0.09;

const ARCADE_BEST_KEY = "jarvis.town.arcadeBest";
export function readArcadeBest(): number {
  try {
    return Number(window.localStorage.getItem(ARCADE_BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
export function writeArcadeBest(n: number) {
  try {
    window.localStorage.setItem(ARCADE_BEST_KEY, String(n));
  } catch {
    /* ignore */
  }
}

const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

// ── dialog content per prop ─────────────────────────────────────────────────

export type PropDeps = {
  world: TownWorld;
  dogName: string;
  runs: readonly FlowRun[];
  name: (slug: TownSlug) => string;
  documents: readonly DocumentSummary[] | undefined;
  documentsLoading: boolean;
  documentsError: boolean;
  navigate: (to: string) => void;
  log: (slug: TownSlug, text: string) => void;
};

export function propContent(id: string, d: PropDeps): PropContent {
  const prop = propById(id);
  const w = d.world;
  const dog = d.dogName;
  const base = { title: prop?.name ?? "Przedmiot", portrait: "user" as TownSlug | "dog" };

  switch (prop?.kind) {
    case "coffee":
      return {
        ...base,
        line: "Ekspres mruczy cicho. Co podać?",
        options: ["Espresso", "Latte", "Herbata"].map((drink) => ({
          label: drink,
          run: (ui) => {
            w.say("user", drink.toLowerCase(), 2200, "coffee");
            w.dog.say("*niuch niuch*", 1400);
            d.log("user", `Robisz sobie: ${drink.toLowerCase()}.`);
            ui.say(
              `${drink} gotowe. ${pick(["Aromat roznosi się po całym piętrze.", `${dog} z nadzieją patrzy na kubek.`, "Dokładnie tego było trzeba."])}`,
            );
          },
        })),
      };
    case "vending":
      return {
        ...base,
        line: "Automat brzęczy. Co bierzesz?",
        options: [
          ...["Batonik", "Jabłko", "Chipsy"].map((snack) => ({
            label: snack,
            run: (ui: Parameters<PropContent["options"][number]["run"]>[0]) => {
              w.say("user", snack.toLowerCase(), 1800, null);
              w.dog.say("Hau?", 1400);
              ui.say(`Bierzesz: ${snack.toLowerCase()}. ${dog} patrzy bardzo wymownie.`);
            },
          })),
          {
            label: `Podziel się z: ${dog}`,
            run: (ui) => {
              void w.dog.interact("treat");
              ui.say(`${dog} dostaje kawałek i merda ogonem.`);
            },
          },
        ],
      };
    case "shelf": {
      const docs = d.documents ?? [];
      const line = d.documentsLoading
        ? "Przeglądasz grzbiety segregatorów…"
        : d.documentsError
          ? "Nie udało się wczytać listy dokumentów. Spróbuj w module Dokumenty."
          : docs.length
            ? `Na półkach: ${docs.length} ${plural(docs.length, "dokument", "dokumenty", "dokumentów")}. Najnowsze:`
            : "Półki są puste. Dokumenty dodasz w module Dokumenty.";
      return {
        ...base,
        line,
        options: [
          ...docs.slice(0, 5).map((doc) => ({
            label: doc.filename,
            run: (ui: Parameters<PropContent["options"][number]["run"]>[0]) =>
              ui.say(
                [
                  doc.filename,
                  `Status: ${doc.status}${doc.chunk_count ? ` · ${doc.chunk_count} ${plural(doc.chunk_count, "fragment", "fragmenty", "fragmentów")}` : ""}`,
                  `Dodany: ${new Date(doc.created_at).toLocaleDateString("pl-PL")}`,
                  doc.error_message ? `Błąd: ${doc.error_message}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
              ),
          })),
          { label: "Otwórz moduł Dokumenty", run: () => d.navigate("/documents") },
        ],
      };
    }
    case "arcade":
      return {
        ...base,
        line: `Ekran mruga: „ZŁAP BUGA”. Twój rekord: ${readArcadeBest()}.`,
        options: [{ label: "Zagraj", run: (ui) => ui.game() }],
      };
    case "pc":
      return {
        ...base,
        line: "Pulpit świeci. Co otwieramy?",
        options: [
          { label: "Zadania", to: "/tasks" },
          { label: "Notatki", to: "/notes" },
          { label: "Feed", to: "/feed" },
          { label: "Agent Hub", to: "/agent-hub" },
        ].map((l) => ({ label: l.label, run: () => d.navigate(l.to) })),
      };
    case "sofa":
      return {
        ...base,
        line: "Miękka i wygodna. Chwila przerwy?",
        options: [
          {
            label: "Odpocznij chwilę",
            run: (ui) => {
              w.say("user", "ahh…", 2000, "zz");
              void w.dog.interact("call");
              d.log("user", `Krótka przerwa na kanapie. ${dog} dotrzymuje towarzystwa.`);
              ui.say(`Siadasz na chwilę. ${dog} przybiega i kładzie łeb na Twoich kolanach.`);
            },
          },
        ],
      };
    case "dogbed":
      return {
        title: `Posłanie: ${dog}`,
        portrait: "dog",
        line: "Miękka poduszka, trochę sierści i jedna zgubiona piłka.",
        options: [
          {
            label: `${dog}, na miejsce!`,
            run: (ui) => {
              void w.dog.interact("sleep");
              ui.say(`${dog} zwija się w kłębek.`);
            },
          },
          {
            label: "Pogłaszcz",
            run: (ui) => {
              void w.dog.interact("pet");
              ui.close();
            },
          },
        ],
      };
    case "pingpong":
      return {
        ...base,
        line: "Stół czeka na rywala. Piłeczka leży na siatce.",
        options: [
          {
            label: `Rzuć piłkę: ${dog} aportuje`,
            run: (ui) => {
              void w.dog.interact("fetch");
              ui.close();
            },
          },
          {
            label: "Odbijaj o ścianę",
            run: (ui) => {
              const n = 3 + Math.floor(Math.random() * 40);
              ui.say(
                `Odbijasz piłeczkę ${n} ${plural(n, "raz", "razy", "razy")} z rzędu.${n > 30 ? " Forma życia!" : ""}`,
              );
            },
          },
        ],
      };
    case "globe":
      return {
        ...base,
        line: "Stary globus z Archiwum. Gdzie wylądujesz?",
        options: [
          { label: "Zakręć", run: (ui) => ui.say(`Palec zatrzymuje się na: ${pick(GLOBE_SPOTS)}`) },
        ],
      };
    case "whiteboard":
      return {
        ...base,
        line: dailyStats(d.runs, Date.now(), d.name),
        options: [
          { label: "Odśwież", run: (ui) => ui.say(dailyStats(d.runs, Date.now(), d.name)) },
        ],
      };
    default:
      return { ...base, line: "Nic tu nie ma.", options: [] };
  }
}
