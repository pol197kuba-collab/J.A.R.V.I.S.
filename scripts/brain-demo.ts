/**
 * Mózg 3D — dane demonstracyjne. Uruchamiany przez .github/workflows/brain-demo.yml
 * (i ręcznie: `npx tsx scripts/brain-demo.ts seed|remove`).
 *
 * seed   — wgrywa notatki i wspomnienia z src/lib/brain/demoSeed.ts (tylko
 *          raz: drugi seed nic nie robi, dopóki demo nie zostanie usunięte);
 * remove — usuwa dokładnie te wiersze (po tagu DEMO_TAG), nic innego.
 *
 * Embeddingi i układ policzy zaraz potem scripts/brain-layout.ts (ten sam
 * job) — tutaj wyłącznie zapis.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";
import {
  DEMO_MEMORIES,
  DEMO_NOTES,
  DEMO_SOURCE,
  DEMO_TAG,
  demoCreatedAt,
} from "../src/lib/brain/demoSeed";

type Db = SupabaseClient<Database>;

const mode = process.argv[2];

function notice(message: string) {
  console.log(`::notice::${message}`);
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

async function connect(): Promise<{ db: Db; ownerId: string }> {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anonKey =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  const email = process.env.JARVIS_EMAIL?.trim();
  const password = process.env.JARVIS_PASSWORD;

  // Dwie drogi uwierzytelnienia, identycznie jak w pozostałych jobach.
  if (serviceRoleKey) {
    const db = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return { db, ownerId: requireEnv("JARVIS_OWNER_ID") };
  }
  if (anonKey && email && password) {
    const db = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      fail(`Logowanie kontem ${email} nie powiodło się: ${error?.message ?? "brak użytkownika"}`);
      process.exit(1);
    }
    return { db, ownerId: data.user.id };
  }
  fail(
    "Brak danych uwierzytelniających. Ustaw SUPABASE_SERVICE_ROLE_KEY + JARVIS_OWNER_ID albo " +
      "SUPABASE_PUBLISHABLE_KEY + JARVIS_EMAIL + JARVIS_PASSWORD w Settings → Secrets → Actions.",
  );
  process.exit(1);
}

/** Kolejność po temacie (drugi tag) na przemian: A1, B1, C1, A2, B2, … */
function interleave<T extends { tags: string[] }>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const key = it.tags[1] ?? "";
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const lists = [...groups.values()];
  const out: T[] = [];
  for (let round = 0; out.length < items.length; round++) {
    for (const list of lists) if (list[round]) out.push(list[round]);
  }
  return out;
}

/** Daty istniejących wierszy demo ustawione tak, jak ustawiłby je świeży seed. */
async function respreadDates(db: Db, ownerId: string): Promise<number> {
  const order = interleave(DEMO_NOTES);
  const noteDate = new Map(order.map((n, i) => [n.title, demoCreatedAt(i, order.length)]));
  const memoryDate = new Map(
    DEMO_MEMORIES.map((m, i) => [m.key, demoCreatedAt(i, DEMO_MEMORIES.length)]),
  );
  let updated = 0;
  for (const [title, at] of noteDate) {
    const { error } = await db
      .from("notes")
      .update({ created_at: at, updated_at: at })
      .eq("owner_id", ownerId)
      .eq("title", title)
      .contains("tags", [DEMO_TAG]);
    if (error) throw new Error(`notatki: ${error.message}`);
    updated++;
  }
  for (const [key, at] of memoryDate) {
    const { error } = await db
      .from("memories")
      .update({ created_at: at, updated_at: at })
      .eq("user_id", ownerId)
      .eq("key", key)
      .contains("tags", [DEMO_TAG]);
    if (error) throw new Error(`wspomnienia: ${error.message}`);
    updated++;
  }
  return updated;
}

async function seed(db: Db, ownerId: string) {
  const { count, error: countError } = await db
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .contains("tags", [DEMO_TAG]);
  if (countError) throw new Error(`notatki: ${countError.message}`);
  if ((count ?? 0) > 0) {
    // Demo z pierwszej wersji miało jedną datę dla wszystkiego — rozkładamy
    // daty istniejących wierszy zamiast dublować dane.
    const spread = await respreadDates(db, ownerId);
    notice(
      `Demo już jest (${count} notatek z tagiem ${DEMO_TAG}) — nic nie dodaję, ` +
        `daty rozłożone na nowo (${spread} wierszy).`,
    );
    return;
  }

  const { error: notesError } = await db.from("notes").insert(
    // Notatki przeplatane tematami po osi czasu (i % liczba tematów), żeby
    // suwak pokazywał, jak rośnie kilka gromad naraz, a nie jedną po drugiej.
    interleave(DEMO_NOTES).map((n, i, all) => {
      const at = demoCreatedAt(i, all.length);
      return {
        owner_id: ownerId,
        title: n.title,
        body: n.body,
        tags: n.tags,
        source: DEMO_SOURCE,
        created_at: at,
        updated_at: at,
      };
    }),
  );
  if (notesError) throw new Error(`notatki: ${notesError.message}`);

  const { error: memoriesError } = await db.from("memories").insert(
    DEMO_MEMORIES.map((m, i) => ({
      created_at: demoCreatedAt(i, DEMO_MEMORIES.length),
      updated_at: demoCreatedAt(i, DEMO_MEMORIES.length),
      user_id: ownerId,
      kind: "fact",
      key: m.key,
      value: m.value,
      tags: m.tags,
      importance: m.importance,
      source: DEMO_SOURCE,
    })),
  );
  if (memoriesError) throw new Error(`wspomnienia: ${memoriesError.message}`);

  notice(
    `Dodano ${DEMO_NOTES.length} notatek i ${DEMO_MEMORIES.length} wspomnień (tag ${DEMO_TAG}).`,
  );
}

async function remove(db: Db, ownerId: string) {
  const { count: notes, error: notesError } = await db
    .from("notes")
    .delete({ count: "exact" })
    .eq("owner_id", ownerId)
    .contains("tags", [DEMO_TAG]);
  if (notesError) throw new Error(`notatki: ${notesError.message}`);
  const { count: memories, error: memoriesError } = await db
    .from("memories")
    .delete({ count: "exact" })
    .eq("user_id", ownerId)
    .contains("tags", [DEMO_TAG]);
  if (memoriesError) throw new Error(`wspomnienia: ${memoriesError.message}`);
  notice(`Usunięto ${notes ?? 0} notatek i ${memories ?? 0} wspomnień demo.`);
}

async function main() {
  if (mode !== "seed" && mode !== "remove") {
    fail("Użycie: brain-demo.ts seed|remove");
    process.exit(2);
  }
  const { db, ownerId } = await connect();
  if (mode === "seed") await seed(db, ownerId);
  else await remove(db, ownerId);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
