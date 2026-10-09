// The companion's mood (0-5 hearts) and today's counters, kept per device.
// Pure functions + a tiny localStorage wrapper, so the rules are testable.

import type { DogAction } from "./townDog";

export type DogMood = {
  hearts: number;
  /** local calendar day the counters belong to, YYYY-MM-DD */
  day: string;
  pets: number;
  fetches: number;
  treats: number;
  /** when `hearts` was last brought up to date (ms) */
  at: number;
};

const KEY = "jarvis.town.dogMood";
const NAME_KEY = "jarvis.town.dogName";
export const DEFAULT_DOG_NAME = "Marvel";
export const MAX_HEARTS = 5;
/** One heart fades every six hours without attention — but never below one:
 *  he is always at least a bit glad to see you. */
const DECAY_MS = 6 * 60 * 60 * 1000;
const FLOOR = 1;
const GAIN: Record<DogAction, number> = { pet: 1, fetch: 1, treat: 0.5, call: 0.25, sleep: 0 };

export const dayOf = (now: number) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function freshMood(now: number): DogMood {
  return { hearts: 3, day: dayOf(now), pets: 0, fetches: 0, treats: 0, at: now };
}

/** Bring a stored mood up to `now`: hearts fade with time, counters reset daily. */
export function settle(m: DogMood, now: number): DogMood {
  const faded = m.hearts - Math.max(0, now - m.at) / DECAY_MS;
  const hearts = Math.min(MAX_HEARTS, Math.max(Math.min(FLOOR, m.hearts), faded));
  const day = dayOf(now);
  return day === m.day
    ? { ...m, hearts, at: now }
    : { ...m, hearts, at: now, day, pets: 0, fetches: 0, treats: 0 };
}

export function applyAction(m: DogMood, action: DogAction, now: number): DogMood {
  const s = settle(m, now);
  return {
    ...s,
    hearts: Math.min(MAX_HEARTS, s.hearts + GAIN[action]),
    pets: s.pets + (action === "pet" ? 1 : 0),
    fetches: s.fetches + (action === "fetch" ? 1 : 0),
    treats: s.treats + (action === "treat" ? 1 : 0),
  };
}

export function loadMood(now: number): DogMood {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const m = JSON.parse(raw) as DogMood;
      if (typeof m.hearts === "number" && typeof m.at === "number") return settle(m, now);
    }
  } catch {
    /* storage unavailable or corrupt — start fresh */
  }
  return freshMood(now);
}
export function saveMood(m: DogMood) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}
export function loadDogName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY)?.trim() || DEFAULT_DOG_NAME;
  } catch {
    return DEFAULT_DOG_NAME;
  }
}
export function saveDogName(name: string) {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}
