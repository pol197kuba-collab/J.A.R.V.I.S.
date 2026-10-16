// Jedno źródło prawdy: z którą bazą Supabase rozmawia aplikacja.
//
// Hosting zostaje na Lovable, a Lovable Cloud wstrzykuje na serwer własne
// SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY —
// wskazujące na STARĄ, wbudowaną bazę. Dlatego:
//   1. Przeglądarka i SSR biorą adres + klucz publiczny z wartości wpisanych
//      w buildzie (vite.config.ts → import.meta.env.VITE_SUPABASE_*).
//   2. Serwer najpierw szuka sekretów JARVIS_SUPABASE_*, które ustawiamy sami
//      i których Lovable nie nadpisze; SUPABASE_* to tylko zapas (GitHub
//      Actions, lokalny dev).
//   3. Jeśli serwer i przeglądarka wskazują na różne projekty, rzucamy
//      błędem — ciche pisanie do starej bazy jest gorsze niż awaria.

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim() !== "" ? value.trim() : undefined;
}

/** Adres projektu wpisany w buildzie (pusty w testach i skryptach node). */
function buildTimeUrl(): string | undefined {
  return nonEmpty(import.meta.env?.VITE_SUPABASE_URL);
}

function buildTimePublishableKey(): string | undefined {
  return nonEmpty(import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY);
}

function processEnv(name: string): string | undefined {
  return typeof process === "undefined" ? undefined : nonEmpty(process.env[name]);
}

export function supabaseUrl(): string | undefined {
  const server = processEnv("JARVIS_SUPABASE_URL") ?? processEnv("SUPABASE_URL");
  const built = buildTimeUrl();
  if (server && built && server.replace(/\/+$/, "") !== built.replace(/\/+$/, "")) {
    const message =
      `[Supabase] Serwer wskazuje na ${server}, a aplikacja na ${built}. ` +
      "Ustaw sekret JARVIS_SUPABASE_URL na adres nowego projektu.";
    console.error(message);
    throw new Error(message);
  }
  return built ?? server;
}

export function supabasePublishableKey(): string | undefined {
  return (
    buildTimePublishableKey() ??
    processEnv("JARVIS_SUPABASE_PUBLISHABLE_KEY") ??
    processEnv("SUPABASE_PUBLISHABLE_KEY")
  );
}

/** Tylko serwer. Klucz service_role omija RLS — nigdy nie trafia do przeglądarki. */
export function supabaseServiceRoleKey(): string | undefined {
  return processEnv("JARVIS_SUPABASE_SERVICE_ROLE_KEY") ?? processEnv("SUPABASE_SERVICE_ROLE_KEY");
}
