// Agent Town — "animalese": instead of a synthetic voice, a speech bubble
// plays a few short, quiet pixel blips (Undertale / Animal Crossing style).
// Each character has their own pitch; the blip for a letter is a pure
// function of the text, so it is deterministic and unit-tested. The sound
// itself is AudioEngine.playBlip — this file only plans it.

import type { TownSlug } from "./townMap";

/** Base pitch per character, Hz — low butler, bright presenter. */
export const BLIP_BASE: Record<TownSlug, number> = {
  jarvis: 330,
  insight: 262,
  metric: 392,
  forge: 196,
  shield: 294,
  herald: 440,
  user: 349,
};

/** Semitone offsets a letter can land on — a pentatonic scale never sounds sour. */
const SCALE = [0, 2, 4, 7, 9];
/** Never chatter on a long answer: past this many blips the rest is silence. */
export const MAX_BLIPS = 16;
/** Gap between two letters, ms. */
export const BLIP_GAP = 62;

export type Blip = { at: number; freq: number };

/** When (ms from now) and at what pitch each blip of `text` plays. */
export function blipPlan(text: string, slug: TownSlug): Blip[] {
  const base = BLIP_BASE[slug] ?? 330;
  const plan: Blip[] = [];
  let t = 0;
  for (const ch of text) {
    if (plan.length >= MAX_BLIPS) break;
    if (!/[\p{L}\p{N}]/u.test(ch)) {
      // space / punctuation: a short rest, no sound
      t += BLIP_GAP * 0.7;
      continue;
    }
    const semitone = SCALE[ch.toLowerCase().charCodeAt(0) % SCALE.length];
    plan.push({ at: Math.round(t), freq: Math.round(base * 2 ** (semitone / 12)) });
    t += BLIP_GAP;
  }
  return plan;
}
