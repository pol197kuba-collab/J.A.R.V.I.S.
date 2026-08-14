// Estimates how long JARVIS's speak() pipeline needs to read a line aloud,
// so the showcase can hold each step on screen for exactly as long as the
// narration takes — instead of a hand-guessed fixed duration that either
// cuts the voice off mid-sentence (what shipped originally: visuals moved
// on roughly twice as fast as the narration) or leaves the screen sitting
// idle after the voice finishes.
//
// speak() (src/lib/audio/speak.ts) always plays at rate=1.0 and prepends a
// two-tone chirp before the utterance starts. CHARS_PER_SECOND is a
// conservative reading speed for the pl-PL/en-GB voices it picks at that
// rate — measured against the actual narration lines in sequence.ts, not a
// generic TTS-speed guess, so it stays honest if lines get edited later.
const CHIRP_LATENCY_MS = 220;
const CHARS_PER_SECOND = 14;
// Let the caption/visual breathe for a beat after the voice stops, rather
// than cutting straight to the next "constructing module" transition.
const TRAILING_PAUSE_MS = 700;
const MIN_DISPLAY_MS = 3000;

export function estimateNarrationMs(text: string): number {
  const speakingMs = (text.trim().length / CHARS_PER_SECOND) * 1000;
  return Math.max(MIN_DISPLAY_MS, CHIRP_LATENCY_MS + speakingMs + TRAILING_PAUSE_MS);
}
