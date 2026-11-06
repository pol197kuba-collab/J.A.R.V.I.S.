import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "./engine";
import {
  DEFAULT_FUND_SETTINGS,
  describeSettings,
  liveRunDue,
  parseFundSettings,
  rulesForPlayer,
  rulesFromSettings,
} from "./settings";

describe("fund settings", () => {
  it("level 3 with 2× leverage is exactly today's rules", () => {
    const r = rulesFromSettings(DEFAULT_FUND_SETTINGS.global);
    expect(r.maxWeight).toBe(DEFAULT_RULES.maxWeight);
    expect(r.maxLeverage).toBe(DEFAULT_RULES.maxLeverage);
    expect(r.leverageFromConfidence).toBe(DEFAULT_RULES.leverageFromConfidence);
    expect(r.stopSigma).toBe(DEFAULT_RULES.stopSigma);
    expect(r.takeSigma).toBe(DEFAULT_RULES.takeSigma);
    expect(r.allowShort).toBe(DEFAULT_RULES.allowShort);
  });

  it("more aggressive = bigger positions; risk exits can be switched off", () => {
    const calm = rulesFromSettings({ ...DEFAULT_FUND_SETTINGS.global, aggressiveness: 1 });
    const bold = rulesFromSettings({ ...DEFAULT_FUND_SETTINGS.global, aggressiveness: 5 });
    expect(bold.maxWeight!).toBeGreaterThan(calm.maxWeight!);
    const noStops = rulesFromSettings({ ...DEFAULT_FUND_SETTINGS.global, riskExits: false });
    expect(noStops.stopSigma).toBeNull();
    expect(noStops.takeSigma).toBeNull();
  });

  it("benchmarks always play the default rules; AI may override", () => {
    const s = {
      ...DEFAULT_FUND_SETTINGS,
      global: { ...DEFAULT_FUND_SETTINGS.global, leverage: 1 as const },
      overrides: { ai: { ...DEFAULT_FUND_SETTINGS.global, leverage: 3 as const } },
    };
    expect(rulesForPlayer(s, { key: "basket", kind: "benchmark" })).toEqual({});
    expect(rulesForPlayer(s, { key: "monkey", kind: "monkey" })).toEqual({});
    expect(rulesForPlayer(s, { key: "signals", kind: "source" }).maxLeverage).toBe(1);
    expect(rulesForPlayer(s, { key: "ai", kind: "source" }).maxLeverage).toBe(3);
  });

  it("parses anything into valid settings, defaults for gaps", () => {
    expect(parseFundSettings(null)).toEqual(DEFAULT_FUND_SETTINGS);
    const p = parseFundSettings({
      startOn: "2026-11-02",
      global: { aggressiveness: 9, leverage: 1.5, allowShort: false },
      overrides: { ai_learned: { aggressiveness: 5 }, basket: { aggressiveness: 1 } },
      liveEveryMin: 7,
    });
    expect(p.startOn).toBe("2026-11-02");
    expect(p.global).toEqual({
      aggressiveness: 3,
      leverage: 1.5,
      allowShort: false,
      riskExits: true,
    });
    expect(p.overrides).toEqual({
      ai_learned: { aggressiveness: 5, leverage: 1.5, allowShort: false, riskExits: true },
    });
    expect(p.liveEveryMin).toBe(15);
    expect(parseFundSettings({ startOn: "nope" }).startOn).toBe("2026-10-31");
  });

  it("describes the knobs in words", () => {
    expect(describeSettings(DEFAULT_FUND_SETTINGS.global)).toBe(
      "do 20% portfela w jednej pozycji · dźwignia do 2× · gra też na spadki · z stop-lossem i take-profitem",
    );
  });

  it("decides whether the live run is due", () => {
    const now = new Date("2026-11-06T10:30:00Z");
    expect(liveRunDue(null, now, 15)).toBe(true);
    expect(liveRunDue("2026-11-06T10:16:00Z", now, 15)).toBe(true);
    expect(liveRunDue("2026-11-06T10:16:00Z", now, 30)).toBe(false);
    expect(liveRunDue("2026-11-06T09:59:00Z", now, 30)).toBe(true);
    expect(liveRunDue(null, now, 0)).toBe(false);
  });
});
