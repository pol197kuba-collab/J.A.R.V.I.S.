// Darwin — sekcje zablokowane w promptach wariantów. Czysta logika.
//
// Fragment w [[LOCK nazwa]] … [[/LOCK]] jest poza mutacją: persona,
// kontrakty narzędzi / formatu odpowiedzi, zasady bezpieczeństwa. Mutacja
// (S2.3) może przepisać wszystko POZA nimi; validateVariant odrzuca
// potomka, który ruszył choćby znak w zablokowanej sekcji, dodał własną
// blokadę albo urósł ponad limit. Do modelu idzie stripMarkers(prompt) —
// treść bez znaczników, słowo w słowo.

/** Twardy limit długości promptu (bez znaczników). */
export const MAX_PROMPT_CHARS = 8000;
/** Potomek może urosnąć najwyżej o tyle względem rodzica… */
export const MAX_GROWTH_RATIO = 1.5;
/** …plus tyle znaków zapasu (krótkie prompty mogą dostać nowy akapit). */
export const GROWTH_SLACK_CHARS = 400;

const TOKEN = /\[\[LOCK ([a-z0-9_-]{1,40})\]\]|\[\[\/LOCK\]\]/g;

export type PromptSegment =
  | { locked: false; text: string }
  | { locked: true; name: string; text: string };

export type ParsedPrompt = { segments: PromptSegment[]; errors: string[] };

export function parsePrompt(prompt: string): ParsedPrompt {
  const segments: PromptSegment[] = [];
  const errors: string[] = [];
  const names = new Set<string>();
  let open: { name: string; start: number } | null = null;
  let cursor = 0;

  for (const m of prompt.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    const name = m[1];
    if (name !== undefined) {
      if (open) {
        errors.push(`Zagnieżdżona blokada „${name}” wewnątrz „${open.name}”.`);
        continue;
      }
      if (at > cursor) segments.push({ locked: false, text: prompt.slice(cursor, at) });
      if (names.has(name)) errors.push(`Blokada „${name}” występuje dwa razy.`);
      names.add(name);
      open = { name, start: at + m[0].length };
    } else {
      if (!open) {
        errors.push("Zamknięcie [[/LOCK]] bez otwarcia.");
        continue;
      }
      segments.push({ locked: true, name: open.name, text: prompt.slice(open.start, at) });
      open = null;
    }
    cursor = at + m[0].length;
  }
  if (open) {
    errors.push(`Niezamknięta blokada „${open.name}”.`);
    segments.push({ locked: true, name: open.name, text: prompt.slice(open.start) });
  } else if (cursor < prompt.length) {
    segments.push({ locked: false, text: prompt.slice(cursor) });
  }
  return { segments, errors };
}

/** Treść dla modelu: same teksty, bez znaczników (nic poza nimi nie znika). */
export function stripMarkers(prompt: string): string {
  return prompt.replace(TOKEN, "");
}

/** Zablokowane sekcje w kolejności występowania. */
export function lockedSections(prompt: string): { name: string; text: string }[] {
  return parsePrompt(prompt).segments.flatMap((s) =>
    s.locked ? [{ name: s.name, text: s.text }] : [],
  );
}

/**
 * Czy potomek może zostać wariantem rodzica. Pusta lista = tak; inaczej
 * opisy problemów po polsku (trafiają do mutation_note / logu).
 */
export function validateVariant(parent: string, child: string): string[] {
  const problems: string[] = [];
  const parsed = parsePrompt(child);
  problems.push(...parsed.errors);

  const parentLocks = lockedSections(parent);
  const childLocks = lockedSections(child);
  const childByName = new Map(childLocks.map((l) => [l.name, l.text]));
  for (const lock of parentLocks) {
    const text = childByName.get(lock.name);
    if (text === undefined) problems.push(`Usunięta sekcja zablokowana „${lock.name}”.`);
    else if (text !== lock.text) problems.push(`Zmieniona sekcja zablokowana „${lock.name}”.`);
  }
  const parentNames = new Set(parentLocks.map((l) => l.name));
  for (const lock of childLocks) {
    if (!parentNames.has(lock.name)) {
      problems.push(`Nowa sekcja zablokowana „${lock.name}” — blokady ustala człowiek.`);
    }
  }
  const kept = childLocks.filter((l) => parentNames.has(l.name)).map((l) => l.name);
  const expected = parentLocks.map((l) => l.name).filter((n) => childByName.has(n));
  if (kept.join("|") !== expected.join("|")) {
    problems.push("Zmieniona kolejność sekcji zablokowanych.");
  }

  const length = stripMarkers(child).length;
  const parentLength = stripMarkers(parent).length;
  if (length > MAX_PROMPT_CHARS) {
    problems.push(`Prompt ma ${length} znaków — limit to ${MAX_PROMPT_CHARS}.`);
  } else if (length > parentLength * MAX_GROWTH_RATIO + GROWTH_SLACK_CHARS) {
    problems.push(
      `Prompt urósł z ${parentLength} do ${length} znaków — za dużo jak na jedną mutację.`,
    );
  }
  if (stripMarkers(child).trim().length === 0) problems.push("Pusty prompt.");
  return problems;
}
