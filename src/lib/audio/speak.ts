// JARVIS voice synthesis helper.
// Restored to the original stable configuration from the first
// "Welcome back, Mr. Slawinsky" personalization: a short HUD chirp
// followed by SpeechSynthesis with a gentle pitch/rate drop, and
// NO experimental male-voice filtering (which was blocking playback
// on some systems).
import { audio } from "./AudioEngine";

/** Play a short HUD chirp then speak the phrase as JARVIS. */
export function speak(text: string, opts?: { skipChirp?: boolean }) {
  try {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (!opts?.skipChirp) {
      audio.playBeep(1760, 0.05, 0.18);
      setTimeout(() => audio.playBeep(2200, 0.04, 0.14), 55);
    }
    const delay = opts?.skipChirp ? 0 : 140;
    setTimeout(() => {
      try {
        synth.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = "en-GB";
        utter.pitch = 0.85;
        utter.rate = 1.0;
        utter.volume = 1.0;
        synth.speak(utter);
      } catch {
        /* speech unsupported — non-blocking */
      }
    }, delay);
  } catch {
    /* never block UI */
  }
}

/** Stop any current speech (e.g. on shutdown). */
export function speakCancel() {
  try {
    window.speechSynthesis?.cancel();
  } catch {}
}