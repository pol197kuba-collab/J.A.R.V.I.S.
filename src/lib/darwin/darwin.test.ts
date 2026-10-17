import { describe, expect, it } from "vitest";
import { seededRandom } from "@/lib/brain/projection";
import { armPosterior, pickArm, sampleBeta, type Arm } from "./bandit";
import {
  lockedSections,
  MAX_PROMPT_CHARS,
  parsePrompt,
  stripMarkers,
  validateVariant,
} from "./prompt";

const PARENT = [
  "[[LOCK persona]]Jesteś J.A.R.V.I.S.[[/LOCK]]",
  "\nStrategia: odpowiadaj zwięźle.\n",
  "[[LOCK format]]Zwróć JSON.[[/LOCK]]",
].join("");

describe("prompt — sekcje zablokowane", () => {
  it("stripMarkers usuwa tylko znaczniki, treść zostaje słowo w słowo", () => {
    expect(stripMarkers(PARENT)).toBe(
      "Jesteś J.A.R.V.I.S.\nStrategia: odpowiadaj zwięźle.\nZwróć JSON.",
    );
  });

  it("parsePrompt rozpoznaje sekcje i błędy", () => {
    expect(lockedSections(PARENT).map((l) => l.name)).toEqual(["persona", "format"]);
    expect(parsePrompt("[[LOCK a]]x").errors).toHaveLength(1);
    expect(parsePrompt("x[[/LOCK]]").errors).toHaveLength(1);
    expect(parsePrompt("[[LOCK a]][[LOCK b]]x[[/LOCK]]").errors.length).toBeGreaterThan(0);
    expect(parsePrompt("[[LOCK a]]x[[/LOCK]][[LOCK a]]y[[/LOCK]]").errors).toHaveLength(1);
  });

  it("przepuszcza mutację części wolnej", () => {
    const child = PARENT.replace("odpowiadaj zwięźle", "najpierw sprawdź pamięć, potem odpowiedz");
    expect(validateVariant(PARENT, child)).toEqual([]);
  });

  it("odrzuca zmianę, usunięcie i dopisanie blokady", () => {
    expect(validateVariant(PARENT, PARENT.replace("Zwróć JSON.", "Zwróć tekst."))[0]).toMatch(
      /Zmieniona sekcja zablokowana „format”/,
    );
    expect(
      validateVariant(PARENT, PARENT.replace(/\[\[LOCK format\]\].*\[\[\/LOCK\]\]/, ""))[0],
    ).toMatch(/Usunięta/);
    expect(validateVariant(PARENT, `${PARENT}[[LOCK moja]]x[[/LOCK]]`)[0]).toMatch(/Nowa sekcja/);
  });

  it("odrzuca zamianę kolejności blokad", () => {
    const swapped =
      "[[LOCK format]]Zwróć JSON.[[/LOCK]]\nStrategia.\n[[LOCK persona]]Jesteś J.A.R.V.I.S.[[/LOCK]]";
    expect(validateVariant(PARENT, swapped)).toContain("Zmieniona kolejność sekcji zablokowanych.");
  });

  it("pilnuje długości", () => {
    const huge = PARENT.replace("odpowiadaj zwięźle", "x".repeat(MAX_PROMPT_CHARS));
    expect(validateVariant(PARENT, huge).join(" ")).toMatch(/limit/);
    const grown = PARENT.replace("odpowiadaj zwięźle", "y".repeat(600));
    expect(validateVariant(PARENT, grown).join(" ")).toMatch(/urósł/);
  });
});

describe("bandit — Thompson sampling", () => {
  it("Beta ma właściwą średnią", () => {
    const rng = seededRandom(5);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += sampleBeta(8, 2, rng);
    expect(sum / 4000).toBeCloseTo(0.8, 1);
  });

  it("posterior startuje płasko i jest przycinany", () => {
    expect(armPosterior({ n: 0, total: 0 })).toEqual({ a: 1, b: 1 });
    expect(armPosterior({ n: 10, total: 14 })).toEqual({ a: 11, b: 1 });
  });

  it("bez wariantów — null; sam champion — zawsze on", () => {
    const rng = seededRandom(1);
    expect(pickArm([], rng)).toBeNull();
    const champ: Arm = { id: "c", status: "champion", n: 0, total: 0 };
    for (let i = 0; i < 50; i++) expect(pickArm([champ], rng)).toBe("c");
  });

  it("champion dostaje ~80% ruchu, lepszy pretendent większość reszty", () => {
    const rng = seededRandom(42);
    const arms: Arm[] = [
      { id: "champ", status: "champion", n: 40, total: 20 },
      { id: "good", status: "active", n: 40, total: 32 },
      { id: "bad", status: "active", n: 40, total: 8 },
    ];
    const count: Record<string, number> = { champ: 0, good: 0, bad: 0 };
    for (let i = 0; i < 5000; i++) count[pickArm(arms, rng)!]++;
    expect(count.champ / 5000).toBeCloseTo(0.8, 1);
    expect(count.good).toBeGreaterThan(count.bad * 10);
  });

  it("nowy pretendent bez ocen też czasem gra", () => {
    const rng = seededRandom(7);
    const arms: Arm[] = [
      { id: "champ", status: "champion", n: 100, total: 60 },
      { id: "old", status: "active", n: 100, total: 60 },
      { id: "new", status: "active", n: 0, total: 0 },
    ];
    let fresh = 0;
    for (let i = 0; i < 3000; i++) if (pickArm(arms, rng) === "new") fresh++;
    expect(fresh).toBeGreaterThan(100);
  });

  it("bez championa wybiera spośród wszystkich", () => {
    const rng = seededRandom(3);
    const arms: Arm[] = [{ id: "a", status: "active", n: 5, total: 4 }];
    expect(pickArm(arms, rng)).toBe("a");
  });
});
