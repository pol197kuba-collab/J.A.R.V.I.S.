// Wspólny szkielet jobów z scripts/ (plan naprawczy, etap 6b).
//
// CO SIĘ STAŁO. Od etapu 5 klucze z user_secrets czyta tylko service role,
// a joby logowały się kontem właściciela (e-mail i hasło), bo sekrety
// SUPABASE_SERVICE_ROLE_KEY i JARVIS_OWNER_ID były w GitHubie puste. Commute
// Watch nie miał klucza TomTom, push nie miał kluczy VAPID — a przebiegi były
// ZIELONE. Ten moduł usuwa obie przyczyny:
//   1. jedna droga uwierzytelnienia: service role + JARVIS_OWNER_ID, bez
//      zapasowego logowania hasłem, które ukryło usterkę;
//   2. błąd głównej pracy joba to ::error::, wpis `error` w system_events
//      (S.H.I.E.L.D. go widzi) i kod wyjścia 1 — nie ostrzeżenie;
//   3. każdy przebieg kończy się jednym zdaniem o tym, co zrobił.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export type JobDb = SupabaseClient<Database>;

/** Sekrety GitHub Actions, bez których żaden job nie ruszy. */
export const REQUIRED_JOB_SECRETS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JARVIS_OWNER_ID",
] as const;

export class JobConfigError extends Error {
  constructor(missing: readonly string[]) {
    super(
      `Brak wymaganych sekretów: ${missing.join(", ")}. Ustaw je w GitHub → Settings → ` +
        "Secrets and variables → Actions (README, „Sekrety GitHub Actions”).",
    );
    this.name = "JobConfigError";
  }
}

export type JobConfig = { url: string; serviceRoleKey: string; ownerId: string };

/** Konfiguracja joba ze zmiennych środowiska; brak któregokolwiek → JobConfigError. */
export function jobConfig(env: Record<string, string | undefined> = process.env): JobConfig {
  const missing = REQUIRED_JOB_SECRETS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new JobConfigError(missing);
  return {
    url: env.SUPABASE_URL!.trim(),
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    ownerId: env.JARVIS_OWNER_ID!.trim(),
  };
}

type Out = (line: string) => void;

export class JobRun {
  readonly failures: string[] = [];

  constructor(
    /** Nazwa joba — trafia do system_events.source. */
    readonly name: string,
    readonly db: JobDb,
    readonly ownerId: string,
    private readonly out: Out = (line) => console.log(line),
  ) {}

  notice(message: string): void {
    this.out(`::notice::${message}`);
  }

  warn(message: string): void {
    this.out(`::warning::${message}`);
  }

  /**
   * Awaria głównej pracy joba: ::error:: w Actions i `error` w system_events.
   * Przebieg dalej idzie (inne kroki mogą się udać), ale skończy się kodem 1.
   */
  async fail(step: string, message: string, meta: Json = {}): Promise<void> {
    this.failures.push(`${step}: ${message}`);
    this.out(`::error::${step}: ${message}`);
    try {
      await this.db.from("system_events").insert({
        owner_id: this.ownerId,
        level: "error",
        source: this.name,
        message: `[cron] ${step}: ${message}`,
        meta,
      });
    } catch {
      // Zostaje ::error:: powyżej.
    }
  }

  /**
   * Ostatnia linia przebiegu: jedno zdanie o tym, co zrobił. Zwraca kod
   * wyjścia — 1, gdy po drodze była awaria (wtedy przebieg jest czerwony).
   */
  finish(summary: string): number {
    if (this.failures.length > 0) {
      this.out(
        `::error::${summary} — z awariami (${this.failures.length}): ${this.failures.join("; ")}`,
      );
      return 1;
    }
    this.out(`::notice::${summary}`);
    return 0;
  }
}

/** Start joba: konfiguracja + klient service role. Brak sekretu → ::error:: i kod 1. */
export function startJob(
  name: string,
  env: Record<string, string | undefined> = process.env,
): JobRun {
  let config: JobConfig;
  try {
    config = jobConfig(env);
  } catch (err) {
    console.log(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const db = createClient<Database>(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return new JobRun(name, db, config.ownerId);
}
