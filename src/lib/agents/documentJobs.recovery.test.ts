// Testy napisane pod KONKRETNĄ awarię: prezentacja zamówiona na telefonie,
// aplikacja zminimalizowana, zadanie stoi w `running` i nic się nie dzieje.
import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  QUEUED_GRACE_MS,
  STALE_AFTER_MS,
  classifyJob,
  exhaustedReason,
} from "./documentJobs.recovery";

const NOW = new Date("2026-09-23T12:00:00Z");
const agoMs = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("classifyJob", () => {
  it("nie rusza zadania, które właśnie pracuje", () => {
    expect(classifyJob({ status: "running", updatedAt: agoMs(60_000), attempts: 1 }, NOW)).toBe(
      "healthy",
    );
  });

  it("uznaje za porzucone zadanie milczące dłużej niż próg", () => {
    // Dokładnie objaw z produkcji: karta uśpiona, żądanie zerwane, wiersz
    // został w `running` i nikt już nigdy nic do niego nie zapisze.
    expect(
      classifyJob({ status: "running", updatedAt: agoMs(STALE_AFTER_MS + 1000), attempts: 1 }, NOW),
    ).toBe("resumable");
  });

  it("podnosi też zadanie, którego nikt nigdy nie odpalił", () => {
    // `queued` bez ruchu znaczy, że kliknięcie klienta w ogóle nie doszło.
    expect(
      classifyJob({ status: "queued", updatedAt: agoMs(STALE_AFTER_MS + 1000), attempts: 0 }, NOW),
    ).toBe("resumable");
  });

  it("po wyczerpaniu podejść zamyka zadanie zamiast wskrzeszać je w kółko", () => {
    expect(
      classifyJob(
        { status: "running", updatedAt: agoMs(STALE_AFTER_MS + 1000), attempts: MAX_ATTEMPTS },
        NOW,
      ),
    ).toBe("exhausted");
  });

  it("nie dotyka zadań zakończonych", () => {
    for (const status of ["done", "error"]) {
      expect(classifyJob({ status, updatedAt: agoMs(86_400_000), attempts: 9 }, NOW)).toBe(
        "healthy",
      );
    }
  });

  it("nie wywraca się na zepsutym znaczniku czasu", () => {
    // Lepiej zostawić zadanie w spokoju niż zrestartować je na podstawie NaN.
    expect(classifyJob({ status: "running", updatedAt: "nie-data", attempts: 0 }, NOW)).toBe(
      "healthy",
    );
  });
});

describe("exhaustedReason", () => {
  it("mówi wprost, co się stało i co z tym zrobić", () => {
    const reason = exhaustedReason(3);
    expect(reason).toContain("3 razy");
    expect(reason).toContain("uśpienie aplikacji");
  });
});

describe("classifyJob — kolejka w tle (etap 6)", () => {
  it("podejmuje zadanie `queued`, którego nikt nie ruszył dłużej niż 90 s", () => {
    // Przeglądarka nie wysłała startu (uśpiona karta) — nie czekamy 15 min.
    expect(
      classifyJob({ status: "queued", updatedAt: agoMs(QUEUED_GRACE_MS + 1000), attempts: 0 }, NOW),
    ).toBe("resumable");
  });

  it("zostawia świeże `queued` przeglądarce, która właśnie je startuje", () => {
    expect(classifyJob({ status: "queued", updatedAt: agoMs(30_000), attempts: 0 }, NOW)).toBe(
      "healthy",
    );
  });

  it("`running` dalej dostaje pełne 15 minut — potok trwa kilka minut", () => {
    expect(
      classifyJob(
        { status: "running", updatedAt: agoMs(QUEUED_GRACE_MS + 1000), attempts: 1 },
        NOW,
      ),
    ).toBe("healthy");
  });
});
