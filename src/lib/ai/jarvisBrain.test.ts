import { describe, it, expect } from "vitest";
import { tryParseJson, fallbackFor, JARVIS_ACTIONS, type JarvisAction } from "./jarvisBrain";

// tryParseJson is the tolerance layer between Gemini's (frequently
// malformed) output and the UI action pipeline. Every shape below has been
// observed or is explicitly warned about in the system prompt — each one is
// pinned so a "cleanup" of the parser can't silently drop a tolerance.
describe("tryParseJson", () => {
  it("parses the canonical shape", () => {
    expect(tryParseJson('{"action":"open_fuel","speech":"Ładuję."}')).toEqual({
      action: "open_fuel",
      speech: "Ładuję.",
    });
  });

  it("strips markdown code fences around the JSON", () => {
    const fenced = '```json\n{"action":"none","speech":"Dzień dobry."}\n```';
    expect(tryParseJson(fenced)).toEqual({ action: "none", speech: "Dzień dobry." });
  });

  it("extracts the JSON object out of surrounding prose", () => {
    const noisy = 'Oto odpowiedź: {"action":"none","speech":"Tak jest."} — koniec.';
    expect(tryParseJson(noisy)).toEqual({ action: "none", speech: "Tak jest." });
  });

  it("tolerates uppercase key variants", () => {
    expect(tryParseJson('{"Action":"open_menu","Speech":"Otwieram."}')).toEqual({
      action: "open_menu",
      speech: "Otwieram.",
    });
    expect(tryParseJson('{"ACTION":"sleep","SPEECH":"Dobranoc."}')).toEqual({
      action: "sleep",
      speech: "Dobranoc.",
    });
  });

  it("tolerates speech-key synonyms (reply/text/response)", () => {
    expect(tryParseJson('{"reply":"Cześć."}')).toEqual({ action: "none", speech: "Cześć." });
    expect(tryParseJson('{"text":"Cześć."}')).toEqual({ action: "none", speech: "Cześć." });
    expect(tryParseJson('{"response":"Cześć."}')).toEqual({ action: "none", speech: "Cześć." });
  });

  it("lowercases the action value", () => {
    expect(tryParseJson('{"action":"REBOOT","speech":"Restartuję."}')).toEqual({
      action: "reboot",
      speech: "Restartuję.",
    });
  });

  it("defaults a missing action to none", () => {
    expect(tryParseJson('{"speech":"Sama mowa."}')).toEqual({
      action: "none",
      speech: "Sama mowa.",
    });
  });

  it("returns null when there is no usable speech string", () => {
    expect(tryParseJson('{"action":"none"}')).toBeNull();
    expect(tryParseJson('{"action":"none","speech":42}')).toBeNull();
  });

  it("returns null for non-JSON and malformed input", () => {
    expect(tryParseJson("Zwykły tekst bez JSON-a.")).toBeNull();
    expect(tryParseJson("")).toBeNull();
    expect(tryParseJson('{"action":"none","speech":"unterminated')).toBeNull();
  });
});

describe("fallbackFor", () => {
  const isAction = (a: string): a is JarvisAction =>
    (JARVIS_ACTIONS as readonly string[]).includes(a);

  it("greeting → spoken greeting with no UI action", () => {
    const r = fallbackFor("greeting");
    expect(r.action).toBe("none");
    expect(r.speech.length).toBeGreaterThan(0);
  });

  it("module + known hint → canned module line", () => {
    const r = fallbackFor("module", "fuel");
    expect(r.action).toBe("none");
    expect(r.speech.length).toBeGreaterThan(0);
  });

  it("module + unknown hint falls through to generic", () => {
    const r = fallbackFor("module", "nonexistent-module");
    expect(r.action).toBe("none");
    expect(r.speech.length).toBeGreaterThan(0);
  });

  it("system_check / shutdown / sleep keep their action so the UI still reacts offline", () => {
    expect(fallbackFor("system_check").action).toBe("system_check");
    expect(fallbackFor("shutdown").action).toBe("shutdown");
    expect(fallbackFor("sleep").action).toBe("sleep");
  });

  it("every fallback yields a valid JarvisAction and non-empty speech (never goes mute)", () => {
    for (const kind of [
      "greeting",
      "module",
      "system_check",
      "shutdown",
      "sleep",
      "generic",
      "??",
    ]) {
      const r = fallbackFor(kind);
      expect(isAction(r.action)).toBe(true);
      expect(r.speech.trim().length).toBeGreaterThan(0);
    }
  });
});
