// JARVIS voice synthesis helper.
// Plays a short HUD activation tone, then speaks via SpeechSynthesis,
// preferring a male British voice (en-GB) and falling back to en-US.
import { audio } from "./AudioEngine";

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesReady = false;

const MALE_HINTS = [
  "daniel",
  "google uk english male",
  "microsoft george",
  "microsoft ryan",
  "oliver",
  "arthur",
  "fred",
  "alex",
  "male",
];

function pickVoice(): SpeechSynthesisVoice | null {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return null;
    const voices = synth.getVoices();
    if (!voices.length) return null;
    const score = (v: SpeechSynthesisVoice) => {
      let s = 0;
      const lang = (v.lang || "").toLowerCase();
      const name = (v.name || "").toLowerCase();
      if (lang.startsWith("en-gb")) s += 50;
      else if (lang.startsWith("en")) s += 20;
      if (MALE_HINTS.some((h) => name.includes(h))) s += 30;
      if (name.includes("female") || name.includes("zira") || name.includes("samantha"))
        s -= 40;
      return s;
    };
    return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
  } catch {
    return null;
  }
}

function ensureVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined") return null;
  if (cachedVoice) return cachedVoice;
  cachedVoice = pickVoice();
  if (!voicesReady) {
    voicesReady = true;
    try {
      window.speechSynthesis?.addEventListener?.("voiceschanged", () => {
        cachedVoice = pickVoice();
      });
    } catch {}
  }
  return cachedVoice;
}

/** Play a short HUD chirp then speak the phrase as JARVIS. */
export function speak(text: string, opts?: { skipChirp?: boolean }) {
  try {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (!opts?.skipChirp) {
      // Cinematic HUD activation tone
      audio.playBeep(1760, 0.05, 0.18);
      setTimeout(() => audio.playBeep(2200, 0.04, 0.14), 55);
    }
    const delay = opts?.skipChirp ? 0 : 140;
    setTimeout(() => {
      try {
        synth.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        const v = ensureVoice();
        if (v) utter.voice = v;
        utter.lang = v?.lang || "en-GB";
        utter.pitch = 0.85;
        utter.rate = 0.95;
        utter.volume = 1.0;
        synth.speak(utter);
      } catch {
        /* speech unsupported — non-blocking */
      }
    }, delay);
  } catch {
    /* total failure — never block UI */
  }
}

/** Stop any current speech (e.g. on shutdown). */
export function speakCancel() {
  try {
    window.speechSynthesis?.cancel();
  } catch {}
}

// Pre-warm voice list on first import (browsers populate it async).
if (typeof window !== "undefined") {
  try {
    window.speechSynthesis?.getVoices();
    setTimeout(() => ensureVoice(), 250);
  } catch {}
}