import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COMMUTE_SETTINGS } from "@/lib/commute/types";
import type { ToolContext } from "./shared.server";

const computeCommute = vi.fn();
vi.mock("@/lib/commute/commute.server", () => ({
  computeCommute: (...a: unknown[]) => computeCommute(...a),
  loadCommuteSettings: async () => ({
    ...DEFAULT_COMMUTE_SETTINGS,
    home: { lat: 52.3, lon: 21, label: "Dom" },
    work: { lat: 52.2, lon: 20.9, label: "Praca" },
  }),
}));

const { checkCommuteTool } = await import("./commute.server");

const logEvent = vi.fn(async () => {});
const ctx = { supabase: {}, userId: "u1", logEvent } as unknown as ToolContext;

beforeEach(() => {
  computeCommute.mockReset();
  logEvent.mockClear();
});

describe("check_commute", () => {
  it("'home' = z pracy do domu, domyślnie żywy ruch teraz", async () => {
    computeCommute.mockResolvedValue({ ok: false, reason: "no_key" });
    await checkCommuteTool.execute({ direction: "home" }, ctx);
    const [, , direction, now, , plan] = computeCommute.mock.calls[0];
    expect(direction).toBe("back");
    expect(plan).toEqual({ at: now, live: true });
  });

  it("'planned' liczy według planu z ustawień", async () => {
    computeCommute.mockResolvedValue({ ok: false, reason: "no_key" });
    await checkCommuteTool.execute({ direction: "to_work", when: "planned" }, ctx);
    const [, , direction, , , plan] = computeCommute.mock.calls[0];
    expect(direction).toBe("to");
    expect(plan).toBeUndefined();
  });

  it("brak domu/pracy albo klucza → wskazówka, gdzie to ustawić (bez pytania o adres)", async () => {
    computeCommute.mockResolvedValue({ ok: false, reason: "no_places" });
    expect(await checkCommuteTool.execute({}, ctx)).toMatchObject({ error: "no_places" });
    computeCommute.mockResolvedValue({ ok: false, reason: "no_key" });
    expect(await checkCommuteTool.execute({}, ctx)).toMatchObject({ error: "no_key" });
  });

  it("błąd TomTom → czytelny błąd i wpis w logach, nie wyjątek", async () => {
    computeCommute.mockRejectedValue(new Error("TomTom 403"));
    expect(await checkCommuteTool.execute({ direction: "home" }, ctx)).toMatchObject({
      error: "tomtom_failed",
    });
    expect(logEvent).toHaveBeenCalledWith("error", "tool.check_commute", "TomTom 403", {
      direction: "back",
    });
  });
});
