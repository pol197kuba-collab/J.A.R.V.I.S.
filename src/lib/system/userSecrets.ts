// Jedyna droga serwera do tabeli `user_secrets` (klucze API, token GitHub,
// klucze VAPID).
//
// Przeglądarka nie ma do tej tabeli żadnego dostępu: migracja
// 20261107120000_lock_secrets_and_shared_writes.sql odbiera rolom `anon` i
// `authenticated` wszystkie uprawnienia. Kod serwera czyta i zapisuje ją więc
// kluczem service_role (omija RLS), a to oznacza, że KAŻDE zapytanie musi samo
// zawęzić się do właściciela — `.eq("owner_id", userId)` albo `owner_id` w
// upsercie, gdzie `userId` pochodzi z zweryfikowanego tokenu
// (`requireSupabaseAuth`), nigdy z danych wejściowych klienta.
//
// Gdy service_role nie jest skonfigurowany (testy, lokalny dev bez sekretu),
// helper oddaje przekazanego klienta — tak działało wszystko do tej migracji.
// Po migracji taki fallback zakończy się błędem uprawnień, i dobrze: to
// głośny sygnał, że brakuje sekretu JARVIS_SUPABASE_SERVICE_ROLE_KEY.
//
// Użycie: `(await secretsClient(supabase)).from("user_secrets")`.
//
// Plik jest celowo bez przyrostka `.server`: importują go także pliki
// `*.functions.ts`, których import `.server` blokuje. Dostęp do klienta
// service_role jest ładowany dynamicznie, wewnątrz funkcji.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type FromCapable = Pick<SupabaseClient<Database>, "from">;

/**
 * Klient, którym serwer sięga do `user_secrets`: service_role, a gdy go brak —
 * przekazany `fallback`. Zwraca klienta, a nie samo zapytanie, bo obiekt
 * zwrócony z funkcji `async` jest rozwiązywany jak obietnica.
 */
export async function secretsClient(fallback: FromCapable): Promise<FromCapable> {
  const { resolveWriteClient } = await import("@/lib/fuel/writeAccess.server");
  const admin = (await resolveWriteClient()) as FromCapable | null;
  return admin ?? fallback;
}
