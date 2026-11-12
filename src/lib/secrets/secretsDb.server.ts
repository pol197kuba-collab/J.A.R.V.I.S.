// Klient bazy dla tabeli user_secrets — WYŁĄCZNIE service role (plan
// naprawczy, etap 5, A5). Osobny moduł, żeby testy mogły go podmienić jednym
// miejscem (src/test/setup.ts), a reszta kodu nie wiedziała, skąd klient.
//
// Na hostingu: JARVIS_SUPABASE_SERVICE_ROLE_KEY (sekret Lovable); w skryptach
// GitHub Actions: SUPABASE_SERVICE_ROLE_KEY. Brak klucza = błąd przy pierwszym
// użyciu (supabaseAdmin rzuca z nazwą brakującej zmiennej).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export async function secretsDb(): Promise<SupabaseClient<Database>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
