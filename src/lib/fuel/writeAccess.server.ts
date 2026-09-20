// Czy aplikacja w ogóle może pisać do tabel cache modułu paliwowego.
//
// Zapis wymaga service_role, ale ten klucz jest w tym projekcie OPCJONALNY:
// właściwym pisarzem jest nocny job (.github/workflows/orlen-prices.yml),
// który bierze go z sekretów repozytorium, a nie ze środowiska aplikacji.
// Żadna inna funkcja w repo dotąd go nie potrzebowała, więc bardzo możliwe,
// że po prostu nie jest ustawiony — i moduł ma wtedy pokazać cache, a nie
// paść na starcie.
//
// Osobny plik zamiast prywatnej funkcji w fuel.functions.ts, bo tej gałęzi
// nie da się inaczej przetestować: `createServerFn` opakowuje handler
// w runtime TanStack Start, którego vitest tutaj nie uruchamia.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type WriteClient = SupabaseClient<Database>;

let probe: Promise<WriteClient | null> | null = null;

/**
 * Zwraca klienta service_role albo `null`, gdy konfiguracji brak.
 *
 * `supabaseAdmin` jest Proxy — samo `import` nie rzuca, brakujące zmienne
 * środowiskowe wychodzą dopiero przy pierwszym dostępie do właściwości.
 * Stąd `admin.from` wewnątrz `try`: bez tego dotknięcia sprawdzenie
 * przechodziłoby zawsze, a błąd wybuchał dopiero przy pierwszym zapytaniu.
 *
 * Wynik jest zapamiętywany na czas życia procesu — konfiguracja nie zmienia
 * się w trakcie, więc ponawianie próby przy każdym żądaniu byłoby czystym
 * kosztem.
 */
export async function resolveWriteClient(): Promise<WriteClient | null> {
  probe ??= (async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      void supabaseAdmin.from;
      return supabaseAdmin as WriteClient;
    } catch {
      return null;
    }
  })();
  return probe;
}

/** Wyłącznie dla testów — czyści zapamiętany wynik sprawdzenia. */
export function __resetWriteClientProbe(): void {
  probe = null;
}
