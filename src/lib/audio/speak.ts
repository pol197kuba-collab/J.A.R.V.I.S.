// JARVIS voice synthesis helper.
// Restored to the original stable configuration from the first
// "Welcome back, Mr. Slawinsky" personalization: a short HUD chirp
// followed by SpeechSynthesis with a gentle pitch/rate drop, and
// NO experimental male-voice filtering (which was blocking playback
// on some systems).
import { audio } from "./AudioEngine";

const SPEAK_EVENT = "jarvis:speaking";
let speakingCount = 0;
function setSpeaking(on: boolean) {
  if (typeof window === "undefined") return;
  speakingCount = Math.max(0, speakingCount + (on ? 1 : -1));
  const active = speakingCount > 0;
  window.dispatchEvent(new CustomEvent(SPEAK_EVENT, { detail: active }));
}

export function onSpeaking(handler: (active: boolean) => void) {
  if (typeof window === "undefined") return () => {};
  const fn = (e: Event) => handler((e as CustomEvent<boolean>).detail);
  window.addEventListener(SPEAK_EVENT, fn as EventListener);
  return () => window.removeEventListener(SPEAK_EVENT, fn as EventListener);
}

export function isSpeakingNow() {
  return speakingCount > 0;
}

// FIFO queue so back-to-back speak() calls (e.g. greeting + module-load
// confirmation) play sequentially instead of cancelling each other.
type SpeakLang = "auto" | "en" | "pl";
type QueueItem = { text: string; skipChirp?: boolean; lang?: SpeakLang };
const queue: QueueItem[] = [];
let pumping = false;

// Very small heuristic — enough to distinguish Polish from English replies.
// Looks for Polish diacritics, common Polish stopwords, or the honorific we use.
const PL_DIACRITICS = /[ąćęłńóśźż]/i;
const PL_STOPWORDS = /\b(jestem|jest|nie|tak|proszę|dzień|dobry|panie|slawinsky|sławinsky|dla|to|się|witam|dobrze|teraz|właśnie|wszystko|systemy|operacyjne|panu|pana|panią|ładuję|uruchamiam|otwieram|przyjąłem|wyłączam|zamykam|rdzeń|ustawienia|dziennik|podsystemy|agent|hub|jarvis|panie|sir)\b/i;
// Heuristic bias: default to Polish (the app's primary language) unless the
// text looks clearly English (ASCII-only + no Polish stopwords + at least one
// obvious English function word).
const EN_MARKERS = /\b(the|and|you|are|is|of|to|for|with|please|welcome|sir|mister|system|status)\b/i;
function detectLang(text: string): "en" | "pl" {
  if (PL_DIACRITICS.test(text)) return "pl";
  if (PL_STOPWORDS.test(text)) return "pl";
  if (EN_MARKERS.test(text)) return "en";
  return "pl";
}

function pickVoice(lang: "en" | "pl"): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;
    const wanted = lang === "pl" ? /^pl(-|_|$)/i : /^en(-|_|$)/i;
    // Prefer a Google / natural voice when available, otherwise first match.
    const matches = voices.filter((v) => wanted.test(v.lang));
    if (matches.length === 0) return null;
    return (
      matches.find((v) => /google/i.test(v.name)) ??
      matches.find((v) => /natural|neural|enhanced|premium/i.test(v.name)) ??
      matches[0]
    );
  } catch {
    return null;
  }
}

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
      const requested: SpeakLang = next.lang ?? "auto";
      const lang = requested === "auto" ? detectLang(next.text) : requested;
      utter.lang = lang === "pl" ? "pl-PL" : "en-GB";
      const voice = pickVoice(lang);
      if (voice) utter.voice = voice;
      utter.pitch = 0.85;
      utter.rate = 1.0;
      utter.volume = 1.0;
      let started = false;
      setSpeaking(true);
      started = true;
      const release = () => {
        if (started) {
          started = false;
          setSpeaking(false);
        }
        pumping = false;
        // small gap between phrases
        setTimeout(pump, 60);
      };
      utter.onend = release;
      utter.onerror = release;
      synth.speak(utter);
    } catch {
      setSpeaking(false);
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
export function speak(text: string, opts?: { skipChirp?: boolean; lang?: SpeakLang }) {
  try {
    if (typeof window === "undefined") return;
    if (!window.speechSynthesis) return;
    queue.push({ text, skipChirp: opts?.skipChirp, lang: opts?.lang });
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
    if (speakingCount > 0) {
      speakingCount = 0;
      window.dispatchEvent(new CustomEvent(SPEAK_EVENT, { detail: false }));
    }
    window.speechSynthesis?.cancel();
  } catch {}
}
