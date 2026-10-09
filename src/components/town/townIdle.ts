// Agent Town — what an agent with nothing to do does next. Pure (tested):
// the world rolls the dice, this decides.
//
// Agents are "on call" whenever any task is running anywhere: they go back
// to their desks and wait there, so a hand-off (J.A.R.V.I.S. walking over
// with a delegated task) always finds them in. When the office is quiet they
// mostly stay at their desk, sometimes stretch their legs inside their own
// room (and come back), and rarely go for coffee.

export type IdlePlan = "home" | "stay" | "stroll" | "coffee";

/** Chance of a stroll / a coffee run on a quiet idle tick. */
export const STROLL_CHANCE = 0.3;
export const COFFEE_CHANCE = 0.08;

export function idlePlan(roll: number, onCall: boolean, atHome: boolean): IdlePlan {
  if (onCall || !atHome) return atHome ? "stay" : "home";
  if (roll < COFFEE_CHANCE) return "coffee";
  if (roll < COFFEE_CHANCE + STROLL_CHANCE) return "stroll";
  return "stay";
}

/** Milliseconds until the next idle decision (a calm rhythm, not a jitter). */
export const idleDelay = (roll: number) => 9000 + roll * 9000;
