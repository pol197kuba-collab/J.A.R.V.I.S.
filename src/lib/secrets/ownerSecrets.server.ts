// Klucze API właściciela (tabela user_secrets) — jedyna droga odczytu
// i zapisu (plan naprawczy, etap 5, A5).
//
// Do tej pory kod czytał user_secrets klientem użytkownika (rola
// `authenticated`), więc tabela musiała być dla tej roli czytelna — a z nią
// każdy klucz w jawnej postaci, dla każdego, kto ma ważny token sesji. Teraz
// czyta i zapisuje tylko serwer, kluczem service role, po weryfikacji tokenu
// (userId pochodzi z middleware requireSupabaseAuth albo z konfiguracji joba,
// nigdy z danych od przeglądarki). Po wdrożeniu migracja odbiera roli
// `authenticated` dostęp do tabeli (PR 5b).
//
// Kształt wyniku jak w supabase-js ({ data, error }), żeby wywołujący nie
// zmieniali logiki wokół odczytu.
import type { Database } from "@/integrations/supabase/types";
import { secretsDb } from "./secretsDb.server";

type SecretsRow = Database["public"]["Tables"]["user_secrets"]["Row"];
export type SecretColumn = Exclude<keyof SecretsRow, "owner_id" | "created_at" | "updated_at">;
export type SecretsPatch = Partial<Pick<SecretsRow, SecretColumn>>;

type ReadResult<Q extends string> = Awaited<ReturnType<typeof readWith<Q>>>;

async function readWith<Q extends string>(ownerId: string, columns: Q) {
  const db = await secretsDb();
  return db.from("user_secrets").select(columns).eq("owner_id", ownerId).maybeSingle();
}

/** Wybrane kolumny user_secrets właściciela (np. "gemini_api_key, groq_api_key"). */
export async function readOwnerSecrets<Q extends string>(
  ownerId: string,
  columns: Q,
): Promise<ReadResult<Q>> {
  try {
    return await readWith(ownerId, columns);
  } catch (err) {
    // Brak klucza service role w środowisku — zwracamy błąd w tym samym
    // kształcie co supabase-js zamiast przerywać wywołującego wyjątkiem.
    const message = err instanceof Error ? err.message : String(err);
    return { data: null, error: { message } } as unknown as ReadResult<Q>;
  }
}

/** Zapisuje (upsert) podane klucze właściciela; reszta wiersza bez zmian. */
export async function writeOwnerSecrets(
  ownerId: string,
  patch: SecretsPatch,
): Promise<{ error: { message: string } | null }> {
  try {
    const db = await secretsDb();
    const { error } = await db
      .from("user_secrets")
      .upsert({ owner_id: ownerId, ...patch }, { onConflict: "owner_id" });
    return { error };
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : String(err) } };
  }
}

/** Czyści wybrane klucze (null), nie cały wiersz — tabela trzyma ich kilka. */
export async function clearOwnerSecrets(
  ownerId: string,
  columns: readonly SecretColumn[],
): Promise<{ error: { message: string } | null }> {
  try {
    const db = await secretsDb();
    const patch = Object.fromEntries(columns.map((c) => [c, null])) as SecretsPatch;
    const { error } = await db.from("user_secrets").update(patch).eq("owner_id", ownerId);
    return { error };
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : String(err) } };
  }
}
