import { describe, it, expect } from "vitest";
import { matchesReboot } from "./rebootPhrases";

// These tests pin the CURRENT behaviour of the local reboot matcher. The
// regex is intentionally broad (bare "reboot"/"restart"/"reset" anywhere in
// the utterance triggers Ark Reboot without asking Gemini), so some of the
// "matches" below are arguably false positives — they are asserted as-is to
// make any future tightening of the regex a conscious, reviewed change.
describe("matchesReboot", () => {
  it("matches explicit English reboot commands", () => {
    expect(matchesReboot("initiate ark reboot")).toBe(true);
    expect(matchesReboot("reboot system")).toBe(true);
    expect(matchesReboot("restart system now")).toBe(true);
  });

  it("matches explicit Polish reboot commands", () => {
    expect(matchesReboot("zrestartuj system")).toBe(true);
    expect(matchesReboot("zresetuj system proszę")).toBe(true);
  });

  it("matches bare keywords regardless of case and padding", () => {
    expect(matchesReboot("REBOOT")).toBe(true);
    expect(matchesReboot("  Restart!  ")).toBe(true);
    expect(matchesReboot("reset")).toBe(true);
  });

  it("returns false for empty or unrelated input", () => {
    expect(matchesReboot("")).toBe(false);
    expect(matchesReboot("   ")).toBe(false);
    expect(matchesReboot("co słychać, Jarvis?")).toBe(false);
    expect(matchesReboot("open the task queue")).toBe(false);
  });

  it("does not fire on Polish words that merely contain the keywords", () => {
    // "zresetuj"/"zrestartuj" alone (without "system") contain "reset"/"restart"
    // but not on a word boundary — must NOT hijack the utterance.
    expect(matchesReboot("zresetuj mi hasło do poczty")).toBe(false);
    expect(matchesReboot("zrestartuj mi playlistę")).toBe(false);
  });

  it("KNOWN-BROAD: bare keyword inside an unrelated English sentence still fires", () => {
    // Documented current behaviour, not necessarily desired: tightening the
    // regex to require a "system"-ish object would flip these to false.
    expect(matchesReboot("please reset my password")).toBe(true);
    expect(matchesReboot("restart the song")).toBe(true);
  });
});
