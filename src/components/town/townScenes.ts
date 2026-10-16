// Agent Town — pacing. The director turns real agent_runs into *scenes* that
// play strictly one after another, so a hand-off reads as a story (you walk
// up, J.A.R.V.I.S. takes the task, walks over, the colleague works, brings
// the result back, the answer reaches you) instead of everyone moving at once.
// Pure and tested: the queue and the timing rules, not the characters.

/** Fixed pacing (ms). Tune here — nothing else in Town hard-codes a beat. */
export const PACE = {
  /** A line of dialogue stays up this long (plus the reading pause below). */
  say: 2800,
  /** Pause after a line, before the next thing happens. */
  beat: 1500,
  /** A short pause (acknowledgement, "thanks"). */
  tick: 900,
  /** A tool bubble gets this long on screen before the next scene. */
  tool: 1100,
  /**
   * Even a run that took 0.4 s is shown working at its desk at least this
   * long between the hand-off and the walk back with the result.
   */
  workMin: 2600,
  /** More scenes than this waiting → shed load: shorter beats, no tool bubbles. */
  crowd: 10,
  /** Beat multiplier while crowded. */
  crowdScale: 0.4,
} as const;

/** How much longer a character must keep "working" before returning, in ms. */
export function workHold(handoffAt: number | undefined, now: number, minMs: number): number {
  if (handoffAt === undefined) return 0;
  return Math.max(0, handoffAt + minMs - now);
}

/**
 * Runs scenes one at a time, in the order they were pushed. A scene that
 * throws never stalls the ones behind it. `depth` counts scenes that are
 * running or waiting — the director's load-shedding signal.
 */
export class SceneQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  get depth() {
    return this.pending;
  }

  push(scene: () => Promise<void>): Promise<void> {
    this.pending++;
    const run = async () => {
      try {
        await scene();
      } catch {
        /* a broken scene must not freeze the town */
      } finally {
        this.pending--;
      }
    };
    this.tail = this.tail.then(run, run);
    return this.tail;
  }
}
