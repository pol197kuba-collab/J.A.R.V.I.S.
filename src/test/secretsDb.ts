// Atrapa bazy dla user_secrets w testach (src/test/setup.ts podmienia nią
// secretsDb.server.ts). makeDb z runtime.testkit ustawia ją automatycznie na
// ostatnio utworzoną atrapę — ten sam „świat” co reszta testu.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const testSecretsDb: { current: SupabaseClient<Database> | null } = { current: null };
