// Klucze modeli dla jobów GitHub Actions — z tego samego miejsca co aplikacja.
//
// Do tej pory joby czytały ANTHROPIC_API_KEY / GEMINI_API_KEY z sekretów
// GitHuba, a aplikacja z Ustawień → Klucze API (user_secrets). Dwie kopie
// tego samego klucza rozjechały się: test w ustawieniach mówił „działa”,
// a prognozy z jobów od tygodni dostawały HTTP 401 i szły na zapasowy
// Gemini. Teraz pierwszeństwo ma klucz z bazy (ten, który testują
// ustawienia); sekret GitHuba zostaje tylko zapasem, gdy w bazie go brak
// albo odczyt się nie uda.

import { readOwnerSecrets } from "@/lib/secrets/ownerSecrets.server";

export type KeySource = "ustawienia" | "sekret GitHub" | null;

export type JobModelKeys = {
  anthropicApiKey: string | null;
  geminiApiKey: string | null;
  source: { anthropic: KeySource; gemini: KeySource };
  /** Odczyt bazy się nie udał (wtedy działa tylko zapas z sekretów). */
  readError: string | null;
};

type Reader = (
  ownerId: string,
) => Promise<{ anthropic_api_key?: string | null; gemini_api_key?: string | null } | null>;

const defaultReader: Reader = async (ownerId) => {
  const { data } = await readOwnerSecrets(ownerId, "anthropic_api_key, gemini_api_key");
  return data;
};

const clean = (v: string | null | undefined): string | null => v?.trim() || null;

export async function jobModelKeys(
  ownerId: string,
  env: Record<string, string | undefined> = process.env,
  read: Reader = defaultReader,
): Promise<JobModelKeys> {
  let stored: Awaited<ReturnType<Reader>> = null;
  let readError: string | null = null;
  try {
    stored = await read(ownerId);
  } catch (err) {
    readError = err instanceof Error ? err.message : String(err);
  }
  const pick = (fromDb: string | null | undefined, envName: string) => {
    const db = clean(fromDb);
    if (db) return { key: db, source: "ustawienia" as const };
    const sec = clean(env[envName]);
    return sec ? { key: sec, source: "sekret GitHub" as const } : { key: null, source: null };
  };
  const a = pick(stored?.anthropic_api_key, "ANTHROPIC_API_KEY");
  const g = pick(stored?.gemini_api_key, "GEMINI_API_KEY");
  return {
    anthropicApiKey: a.key,
    geminiApiKey: g.key,
    source: { anthropic: a.source, gemini: g.source },
    readError,
  };
}

/** Jedna linia do logu joba: skąd który klucz (bez samych kluczy). */
export function describeKeys(k: JobModelKeys): string {
  const one = (name: string, s: KeySource) => `${name}: ${s ?? "brak"}`;
  return (
    `klucze modeli — ${one("Claude", k.source.anthropic)}, ${one("Gemini", k.source.gemini)}` +
    (k.readError ? ` (odczyt ustawień nieudany: ${k.readError})` : "")
  );
}
