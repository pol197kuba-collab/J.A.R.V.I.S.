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
//
// Etap 6b: „nie ma klucza” (data: null) i „nie udało się odczytać” to dwie
// różne rzeczy. Nieudany odczyt rzuca SecretsReadError — wcześniej wyglądał
// jak brak klucza, więc joby po etapie 5 (bez klucza service role) kończyły
// się na zielono, nie robiąc swojej pracy. Tam, gdzie klucz jest tylko
// dodatkiem (embedding notatki, newsy), wywołujący łapie wyjątek jawnie.
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

/** Odczyt user_secrets się nie udał — to NIE to samo co brak klucza. */
export class SecretsReadError extends Error {
  constructor(message: string) {
    super(`Nie udało się odczytać kluczy (user_secrets): ${message}`);
    this.name = "SecretsReadError";
  }
}

/**
 * Wybrane kolumny user_secrets właściciela (np. "gemini_api_key, groq_api_key").
 * Brak wiersza → data: null. Nieudany odczyt (brak klucza service role,
 * błąd bazy) → wyjątek SecretsReadError.
 */
export async function readOwnerSecrets<Q extends string>(
  ownerId: string,
  columns: Q,
): Promise<ReadResult<Q>> {
  let result: ReadResult<Q>;
  try {
    result = await readWith(ownerId, columns);
  } catch (err) {
    throw new SecretsReadError(err instanceof Error ? err.message : String(err));
  }
  if (result.error) throw new SecretsReadError(result.error.message);
  return result;
}

/** Odczyt dla miejsc, gdzie klucz jest dodatkiem: błąd → brak klucza + log. */
export async function readOwnerSecretsOrNone<Q extends string>(
  ownerId: string,
  columns: Q,
  where: string,
): Promise<ReadResult<Q>["data"]> {
  try {
    return (await readOwnerSecrets(ownerId, columns)).data;
  } catch (err) {
    console.warn(
      `[${where}] ${err instanceof Error ? err.message : String(err)} — działam bez klucza`,
    );
    return null;
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
