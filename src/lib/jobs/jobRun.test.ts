import { describe, it, expect } from "vitest";
import { JobConfigError, JobRun, jobConfig } from "./jobRun";
import { makeDb, firstArg } from "@/lib/agents/runtime.testkit";

// Etap 6b: job bez wymaganego sekretu ma być czerwony, awaria głównej pracy
// — widoczna w system_events, a każdy przebieg kończy się jednym zdaniem.

describe("jobConfig", () => {
  it("wymaga service role i właściciela — bez zapasowego logowania hasłem", () => {
    expect(() =>
      jobConfig({ SUPABASE_URL: "https://x", JARVIS_EMAIL: "a@b", JARVIS_PASSWORD: "p" }),
    ).toThrow(JobConfigError);
    expect(() => jobConfig({ SUPABASE_URL: "https://x" })).toThrow(
      "SUPABASE_SERVICE_ROLE_KEY, JARVIS_OWNER_ID",
    );
  });

  it("komplet sekretów → konfiguracja", () => {
    expect(
      jobConfig({
        SUPABASE_URL: " https://x ",
        SUPABASE_SERVICE_ROLE_KEY: "k",
        JARVIS_OWNER_ID: "o",
      }),
    ).toEqual({ url: "https://x", serviceRoleKey: "k", ownerId: "o" });
  });
});

describe("JobRun", () => {
  it("awaria: ::error::, wpis error w system_events, kod wyjścia 1", async () => {
    const { db, calls } = makeDb(() => undefined);
    const lines: string[] = [];
    const job = new JobRun("commute-watch", db, "owner-1", (l) => lines.push(l));
    await job.fail("dojazd", "brak klucza TomTom");
    expect(job.finish("Sprawdzono dojazd")).toBe(1);
    const insert = calls.find((c) => c.table === "system_events");
    expect(firstArg(insert!.ops, "insert")).toMatchObject({
      owner_id: "owner-1",
      level: "error",
      source: "commute-watch",
      message: "[cron] dojazd: brak klucza TomTom",
    });
    expect(lines[0]).toBe("::error::dojazd: brak klucza TomTom");
    expect(lines.at(-1)).toMatch(/^::error::Sprawdzono dojazd — z awariami \(1\)/);
  });

  it("bez awarii: jedno zdanie ::notice:: na koniec i kod 0", () => {
    const { db } = makeDb(() => undefined);
    const lines: string[] = [];
    const job = new JobRun("x", db, "o", (l) => lines.push(l));
    expect(job.finish("Poza oknem dojazdu — nic do sprawdzenia.")).toBe(0);
    expect(lines).toEqual(["::notice::Poza oknem dojazdu — nic do sprawdzenia."]);
  });
});
