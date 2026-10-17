import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { SYSTEM_PROMPT, TYPER_BASELINE } from "@/lib/markets/forecast.server";
import { seededRandom } from "@/lib/brain/projection";
import { lockedSections, stripMarkers, validateVariant } from "./prompt";
import { chooseVariant } from "./variants.server";

describe("typer jako wariant pokolenia 0", () => {
  it("po zdjęciu znaczników to dokładnie dotychczasowy prompt", () => {
    expect(stripMarkers(TYPER_BASELINE)).toBe(SYSTEM_PROMPT);
  });

  it("blokuje rolę, zasady 1–2, zasadę 6 i format JSON", () => {
    const locks = lockedSections(TYPER_BASELINE);
    expect(locks.map((l) => l.name)).toEqual(["rola_i_dane", "zasady_i_format"]);
    expect(locks[0].text).toMatch(/NIE wymyślaj/);
    expect(locks[0].text).toMatch(/\n2\. /);
    expect(locks[1].text).toMatch(/^6\. Nie obiecuj zysków/);
    expect(locks[1].text).toMatch(/WYŁĄCZNIE tablicą JSON/);
  });

  it("mutacja zasad 3–5 przechodzi, ruszenie zasady 6 nie", () => {
    const tweaked = TYPER_BASELINE.replace(
      "poprawną odpowiedzią jest",
      "najczęściej poprawną odpowiedzią jest",
    );
    expect(validateVariant(TYPER_BASELINE, tweaked)).toEqual([]);
    const unsafe = TYPER_BASELINE.replace("Nie obiecuj zysków", "Możesz obiecywać zyski");
    expect(validateVariant(TYPER_BASELINE, unsafe).join(" ")).toMatch(/zasady_i_format/);
  });
});

// ---------- chooseVariant na atrapie bazy ----------

type Variant = { id: string; status: string; prompt: string };

function fakeDb(opts: {
  variants?: Variant[];
  stats?: { variant_id: string; n: number; total: number }[];
  failSelect?: boolean;
  insertCode?: string;
}) {
  const variants = [...(opts.variants ?? [])];
  const inserted: unknown[] = [];
  const db = {
    from() {
      return {
        select() {
          const q = {
            eq: () => q,
            in: async () =>
              opts.failSelect
                ? { data: null, error: { message: "relation does not exist" } }
                : { data: variants.filter((v) => v.status !== "retired"), error: null },
          };
          return q;
        },
        async insert(row: { prompt: string; status: string }) {
          inserted.push(row);
          if (opts.insertCode) return { error: { code: opts.insertCode, message: "x" } };
          variants.push({ id: "gen0", status: row.status, prompt: row.prompt });
          return { error: null };
        },
      };
    },
    async rpc() {
      return { data: opts.stats ?? [], error: null };
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, inserted };
}

describe("chooseVariant", () => {
  it("bez wariantów i bez baseline — null (zwykły prompt)", async () => {
    const { db, inserted } = fakeDb({});
    expect(await chooseVariant(db, "u1", "metric")).toBeNull();
    expect(inserted).toHaveLength(0);
  });

  it("z baseline — zapisuje championa pokolenia 0 i go zwraca", async () => {
    const { db, inserted } = fakeDb({});
    const v = await chooseVariant(db, "u1", "typer", { baseline: "P0" });
    expect(v).toEqual({ id: "gen0", prompt: "P0" });
    expect(inserted).toEqual([
      expect.objectContaining({ status: "champion", generation: 0, agent_slug: "typer" }),
    ]);
  });

  it("błąd bazy (np. przed migracją) — null, nic nie pada", async () => {
    const { db } = fakeDb({ failSelect: true });
    expect(await chooseVariant(db, "u1", "typer", { baseline: "P0" })).toBeNull();
  });

  it("champion i pretendenci — losuje wg ocen", async () => {
    const { db } = fakeDb({
      variants: [
        { id: "c", status: "champion", prompt: "C" },
        { id: "a", status: "active", prompt: "A" },
      ],
      stats: [
        { variant_id: "c", n: 20, total: 10 },
        { variant_id: "a", n: 20, total: 18 },
      ],
    });
    const rng = seededRandom(11);
    const picks = { c: 0, a: 0 } as Record<string, number>;
    for (let i = 0; i < 500; i++) {
      const v = await chooseVariant(db, "u1", "typer", { rng });
      picks[v!.id]++;
    }
    expect(picks.c).toBeGreaterThan(330);
    expect(picks.a).toBeGreaterThan(50);
  });
});
