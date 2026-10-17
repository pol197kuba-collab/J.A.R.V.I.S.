/**
 * Mózg 3D — nocny pełny układ. Uruchamiany przez .github/workflows/brain-layout.yml
 * (i ręcznie: `npx tsx scripts/brain-layout.ts --dry-run`).
 *
 * Kolejno:
 * 1. Dogania embeddingi notatek i wspomnień, które ich nie mają (zapis przez
 *    MCP, stare wiersze, chwilowy brak klucza w chwili zapisu).
 * 2. Pobiera wszystkie źródła z embeddingiem (RPC brain_sources) i wczorajsze
 *    pozycje gwiazd.
 * 3. Liczy układ (src/lib/brain/layout.ts): UMAP → wyrównanie do wczoraj →
 *    gromady → nazwy ze słów; nazwy od modelu, gdy jest klucz Gemini.
 * 4. Zapisuje całość jednym wywołaniem brain_apply_layout (jedna transakcja).
 *
 * Poza aplikacją, bo UMAP na tysiącach wektorów to sekundy CPU, a serwer
 * aplikacji to Cloudflare Worker z limitem CPU. Między przebiegami nowe
 * gwiazdy dokłada sama baza (brain_place_new przez pg_cron).
 *
 * Skrypt jest CIENKI: logika w src/lib/brain/*, pokryta testami. Tutaj są
 * wyłącznie sekrety, uwierzytelnienie, odczyt/zapis i raport.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/integrations/supabase/types";
import {
  embedText,
  noteEmbeddingText,
  parseVectorLiteral,
  toVectorLiteral,
} from "../src/lib/ai/embed";
import { callGeminiText } from "../src/lib/agents/providers/geminiText";
import { DEFAULT_GEMINI_MODEL } from "../src/lib/agents/models";
import {
  applyModelNames,
  computeBrainLayout,
  sourceKey,
  type BrainSource,
  type BrainSourceType,
} from "../src/lib/brain/layout";
import {
  buildClusterNamingPrompt,
  CLUSTER_NAMING_SYSTEM,
  parseClusterNames,
} from "../src/lib/brain/labels";
import type { Vec3 } from "../src/lib/brain/projection";
import { computeInsights } from "../src/lib/brain/insights";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

/** Ile brakujących embeddingów dogonić w jednym przebiegu (na typ). */
const BACKFILL_LIMIT = 300;
const BACKFILL_CONCURRENCY = 4;
const PAGE = 250;
const NAMING_TIMEOUT_MS = 45_000;

type Db = SupabaseClient<Database>;

function notice(message: string) {
  console.log(`::notice::${message}`);
}
function warn(message: string) {
  console.log(`::warning::${message}`);
}
function fail(message: string) {
  console.log(`::error::${message}`);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`Brak wymaganego sekretu ${name}. Ustaw go w Settings → Secrets → Actions.`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  const email = process.env.JARVIS_EMAIL?.trim();
  const password = process.env.JARVIS_PASSWORD;

  // Dwie drogi uwierzytelnienia, identycznie jak w pozostałych jobach.
  let db: Db;
  let ownerId: string;
  let asServiceRole = false;
  if (serviceRoleKey) {
    db = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    ownerId = requireEnv("JARVIS_OWNER_ID");
    asServiceRole = true;
    notice("Uwierzytelnienie: service_role.");
  } else if (anonKey && email && password) {
    const client = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: session, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !session.user) {
      fail(`Logowanie kontem ${email} nie powiodło się: ${error?.message ?? "brak użytkownika"}`);
      process.exit(1);
    }
    db = client;
    ownerId = session.user.id;
    notice(`Uwierzytelnienie: konto ${email}.`);
  } else {
    fail(
      "Brak danych uwierzytelniających. Ustaw SUPABASE_SERVICE_ROLE_KEY + JARVIS_OWNER_ID albo " +
        "SUPABASE_PUBLISHABLE_KEY + JARVIS_EMAIL + JARVIS_PASSWORD w Settings → Secrets → Actions.",
    );
    process.exit(1);
  }

  /** Awaria widoczna i w Actions, i w /system-logs (Strażnik ją zobaczy). */
  async function report(step: string, message: string, meta: Json = {}) {
    fail(`${step}: ${message}`);
    if (DRY_RUN) return;
    try {
      await db.from("system_events").insert({
        owner_id: ownerId,
        level: "error",
        source: "brain-layout",
        message: `[cron] ${step}: ${message}`,
        meta,
      });
    } catch {
      // Jeśli nawet log nie przechodzi, zostaje ::error:: powyżej.
    }
  }

  // Klucz Gemini: sekret joba albo klucz użytkownika z aplikacji.
  let geminiKey = process.env.GEMINI_API_KEY?.trim() || null;
  if (!geminiKey) {
    const { data } = await db
      .from("user_secrets")
      .select("gemini_api_key")
      .eq("owner_id", ownerId)
      .maybeSingle();
    geminiKey = data?.gemini_api_key?.trim() || null;
  }
  if (!geminiKey) {
    warn("Brak klucza Gemini — bez dogonienia embeddingów i z nazwami gromad ze słów kluczowych.");
  }

  // ---------- 1. Dogonienie embeddingów ----------
  if (geminiKey && !DRY_RUN) {
    try {
      const notes = await backfillNotes(db, ownerId, geminiKey);
      const memories = await backfillMemories(db, ownerId, geminiKey);
      if (notes.done + memories.done + notes.failed + memories.failed > 0) {
        notice(
          `embeddingi: notatki ${notes.done} (+${notes.failed} nieudanych), ` +
            `wspomnienia ${memories.done} (+${memories.failed} nieudanych)`,
        );
      }
    } catch (err) {
      await report("embeddingi", err instanceof Error ? err.message : String(err));
    }
  }

  // ---------- 2. Źródła i wczorajszy układ ----------
  let sources: BrainSource[];
  let previous: Map<string, Vec3>;
  try {
    sources = await loadSources(db, ownerId, asServiceRole);
    previous = await loadPrevious(db, ownerId);
  } catch (err) {
    await report("odczyt", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  notice(`źródła: ${sources.length} gwiazd, wczorajszy układ: ${previous.size}`);

  // ---------- 3. Układ ----------
  const started = Date.now();
  const layout = computeBrainLayout(sources, previous);
  // Wnioski (duplikaty, samotne gwiazdy, gromady bez notatki) — tu, bo tylko
  // ten job ma embeddingi w pamięci; strona dostaje gotowe listy.
  const insights = computeInsights(
    sources,
    layout.points.map((p) => p.cluster_id),
  );
  let clusters = layout.clusters;
  let modelNamed = 0;
  if (geminiKey && !DRY_RUN && clusters.length > 0) {
    const result = await callGeminiText({
      apiKey: geminiKey,
      model: DEFAULT_GEMINI_MODEL,
      system: CLUSTER_NAMING_SYSTEM,
      user: buildClusterNamingPrompt(layout.labelsByCluster),
      temperature: 0.3,
      maxOutputTokens: 2048,
      timeoutMs: NAMING_TIMEOUT_MS,
    });
    if (result.ok) {
      const names = parseClusterNames(result.text, clusters.length);
      clusters = applyModelNames(clusters, names);
      modelNamed = names.filter(Boolean).length;
    } else {
      warn(`nazwy gromad: ${result.reason} — zostają słowa kluczowe`);
    }
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  notice(
    `układ: ${layout.points.length} gwiazd, ${clusters.length} gromad ` +
      `(${modelNamed} nazwanych przez model), ${seconds} s, ` +
      (layout.meta.aligned
        ? `wyrównany do wczoraj (rms ${layout.meta.alignRms}${layout.meta.mirrored ? ", odbity" : ""})`
        : "bez wyrównania (pierwszy układ albo za mało wspólnych gwiazd)"),
  );
  notice(
    `wnioski: ${insights.duplicates.length} par do scalenia, ` +
      `${insights.orphans.length} samotnych gwiazd, ` +
      `${insights.clustersWithoutNote.length} gromad bez notatki`,
  );
  for (const c of clusters) {
    const size = layout.points.filter((p) => p.cluster_id === c.cluster_id).length;
    console.log(`  • ${c.name} — ${size}`);
  }

  if (DRY_RUN) {
    notice("Tryb dry-run — nic nie zostało zapisane i nie wołano modelu.");
    return;
  }

  // ---------- 4. Zapis ----------
  const { error } = await db.rpc("brain_apply_layout", {
    p_owner: ownerId,
    p_points: layout.points as unknown as Json,
    p_clusters: clusters as unknown as Json,
    p_method: sources.length >= 8 ? "umap-cosine" : "pca",
    p_meta: {
      ...layout.meta,
      modelNamed,
      seconds: Number(seconds),
      insights,
    } as unknown as Json,
  });
  if (error) {
    await report("zapis", error.message);
    process.exit(1);
  }
  notice("Układ zapisany.");
}

async function loadSources(db: Db, ownerId: string, asServiceRole: boolean) {
  const out: BrainSource[] = [];
  let skipped = 0;
  for (let from = 0; ; from += PAGE) {
    const query = asServiceRole
      ? db.rpc("brain_source_rows", { p_owner: ownerId })
      : db.rpc("brain_sources");
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`brain_sources: ${error.message}`);
    for (const row of data ?? []) {
      const embedding = parseVectorLiteral(row.embedding);
      if (!embedding) {
        skipped++;
        continue;
      }
      out.push({
        sourceType: row.source_type as BrainSourceType,
        sourceId: row.source_id,
        label: row.label,
        embedding,
        weight: row.weight,
        sourceCreatedAt: row.source_created_at,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  if (skipped > 0) warn(`źródła: pominięto ${skipped} wierszy z nieczytelnym wektorem`);
  return out;
}

async function loadPrevious(db: Db, ownerId: string) {
  const out = new Map<string, Vec3>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("brain_points")
      .select("source_type, source_id, x, y, z")
      .eq("owner_id", ownerId)
      .order("source_id")
      .range(from, from + 999);
    if (error) throw new Error(`brain_points: ${error.message}`);
    for (const p of data ?? []) out.set(sourceKey(p.source_type, p.source_id), [p.x, p.y, p.z]);
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Wykonuje zadania po kilka naraz — Gemini nie lubi setek równoległych żądań. */
async function inBatches<T>(items: T[], fn: (item: T) => Promise<boolean>) {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += BACKFILL_CONCURRENCY) {
    const results = await Promise.all(items.slice(i, i + BACKFILL_CONCURRENCY).map(fn));
    for (const ok of results) {
      if (ok) done++;
      else failed++;
    }
  }
  return { done, failed };
}

async function backfillNotes(db: Db, ownerId: string, apiKey: string) {
  const { data, error } = await db
    .from("notes")
    .select("id, title, body")
    .eq("owner_id", ownerId)
    .is("embedding", null)
    .limit(BACKFILL_LIMIT);
  if (error) throw new Error(`notatki: ${error.message}`);
  return inBatches(data ?? [], async (n) => {
    const v = await embedText(noteEmbeddingText(n.title, n.body), apiKey, "RETRIEVAL_DOCUMENT");
    if (!v) return false;
    const { error: upd } = await db
      .from("notes")
      .update({ embedding: toVectorLiteral(v) })
      .eq("owner_id", ownerId)
      .eq("id", n.id);
    return !upd;
  });
}

async function backfillMemories(db: Db, ownerId: string, apiKey: string) {
  const { data, error } = await db
    .from("memories")
    .select("id, value")
    .eq("user_id", ownerId)
    .is("embedding", null)
    .limit(BACKFILL_LIMIT);
  if (error) throw new Error(`wspomnienia: ${error.message}`);
  // Ten sam tekst co w narzędziu `remember` — wartość wspomnienia.
  return inBatches(data ?? [], async (m) => {
    const v = await embedText(m.value, apiKey, "RETRIEVAL_DOCUMENT");
    if (!v) return false;
    const { error: upd } = await db
      .from("memories")
      .update({ embedding: toVectorLiteral(v) })
      .eq("user_id", ownerId)
      .eq("id", m.id);
    return !upd;
  });
}

main().catch((err) => {
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
