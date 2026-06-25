// JARVIS voice synthesis helper.
// Restored to the original stable configuration from the first
// "Welcome back, Mr. Slawinsky" personalization: a short HUD chirp
// followed by SpeechSynthesis with a gentle pitch/rate drop, and
// NO experimental male-voice filtering (which was blocking playback
// on some systems).
import { audio } from "./AudioEngine";

// FIFO queue so back-to-back speak() calls (e.g. greeting + module-load
// confirmation) play sequentially instead of cancelling each other.
type QueueItem = { text: string; skipChirp?: boolean };
const queue: QueueItem[] = [];
let pumping = false;

function pump() {
  if (pumping) return;
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  const next = queue.shift();
  if (!next) return;
  pumping = true;

  const startUtter = () => {
    try {
      const utter = new SpeechSynthesisUtterance(next.text);
      utter.lang = "en-GB";
      utter.pitch = 0.85;
      utter.rate = 1.0;
      utter.volume = 1.0;
      const release = () => {
        pumping = false;
        // small gap between phrases
        setTimeout(pump, 60);
      };
      utter.onend = release;
      utter.onerror = release;
      synth.speak(utter);
    } catch {
      pumping = false;
      setTimeout(pump, 60);
    }
  };

  if (!next.skipChirp) {
    audio.playBeep(1760, 0.05, 0.18);
    setTimeout(() => audio.playBeep(2200, 0.04, 0.14), 55);
    setTimeout(startUtter, 140);
  } else {
    startUtter();
  }
}

/** Enqueue a phrase. Plays after any in-flight speech finishes. */
export function speak(text: string, opts?: { skipChirp?: boolean }) {
  try {
    if (typeof window === "undefined") return;
    if (!window.speechSynthesis) return;
    queue.push({ text, skipChirp: opts?.skipChirp });
    // If synth is already busy from a previous call, just queue and wait.
    if (window.speechSynthesis.speaking || pumping) return;
    pump();
  } catch {
    /* never block UI */
  }
}

/** Drain queue and stop any current speech (e.g. on shutdown). */
export function speakCancel() {
  try {
    queue.length = 0;
    pumping = false;
    window.speechSynthesis?.cancel();
  } catch {}
}