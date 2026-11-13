import { describe, expect, it } from "vitest";
import { commuteToolReply } from "./agentReply";
import {
  DEFAULT_COMMUTE_SETTINGS,
  type CommuteIncident,
  type CommuteResult,
  type CommuteRoute,
} from "./types";

const route = (over: Partial<CommuteRoute> = {}): CommuteRoute => ({
  points: [],
  distanceM: 18_400,
  durationSec: 1_980,
  typicalSec: 1_500,
  freeFlowSec: 1_400,
  departAt: "2026-11-13T15:43:00Z",
  arriveAt: "2026-11-13T16:16:00Z",
  streets: [],
  incidentIds: [],
  ...over,
});

const jam: CommuteIncident = {
  id: "i1",
  kind: "jam",
  severity: 2,
  road: "S8",
  from: "Konotopa",
  to: "Prymasa Tysiąclecia",
  description: null,
  delaySec: 420,
  lengthM: 2_000,
  startTime: null,
  endTime: null,
  positions: [],
  at: { lat: 52.2, lon: 20.9 },
};

const result = (over: Partial<CommuteResult> = {}): CommuteResult => {
  const main = route({ incidentIds: ["i1"] });
  return {
    direction: "back",
    origin: { lat: 52.2, lon: 20.9, label: "Praca" },
    destination: { lat: 52.3, lon: 21.0, label: "Dom" },
    main,
    alternatives: [],
    options: [
      { id: "auto:0", kind: "auto", name: "Najszybsza", isDefault: true, route: main },
      {
        id: "auto:1",
        kind: "auto",
        name: "Alternatywa",
        isDefault: false,
        route: route({ durationSec: 2_220, distanceM: 21_050 }),
      },
    ],
    defaultId: "auto:0",
    incidents: [jam],
    detour: null,
    live: true,
    fetchedAt: "2026-11-13T15:43:00Z",
    ...over,
  };
};

describe("commuteToolReply", () => {
  it("droga do domu teraz: czas, opóźnienie, przyjazd i utrudnienie", () => {
    const r = commuteToolReply(result(), DEFAULT_COMMUTE_SETTINGS);
    expect(r.direction).toBe("home");
    expect(r.live).toBe(true);
    expect(r.from).toBe("Praca");
    expect(r.to).toBe("Dom");
    expect(r.summary[0]).toBe(
      "Droga do domu teraz: 33 min (typowo 25, o 8 min dłużej), na miejscu około 17:16.",
    );
    expect(r.summary[1]).toBe(
      "Utrudnienie: korek, S8, Konotopa → Prymasa Tysiąclecia, około 7 min straty.",
    );
  });

  it("trasy do wyboru: domyślna pierwsza, km z jednym miejscem po przecinku", () => {
    const r = commuteToolReply(result(), DEFAULT_COMMUTE_SETTINGS);
    expect(r.routes).toEqual([
      { name: "Najszybsza", isDefault: true, durationMin: 33, distanceKm: 18.4 },
      { name: "Alternatywa", isDefault: false, durationMin: 37, distanceKm: 21.1 },
    ]);
  });

  it("prognoza na planowany wyjazd do pracy, bez utrudnień, z godziną „najpóźniej”", () => {
    const main = route({ departAt: "2026-11-16T05:00:00Z", arriveAt: "2026-11-16T05:33:00Z" });
    const r = commuteToolReply(
      result({
        direction: "to",
        live: false,
        main,
        incidents: [],
        options: [{ id: "auto:0", kind: "auto", name: "Najszybsza", isDefault: true, route: main }],
      }),
      { ...DEFAULT_COMMUTE_SETTINGS, arriveByMin: 7 * 60 },
    );
    expect(r.direction).toBe("to_work");
    expect(r.summary).toEqual([
      "Droga do pracy przy wyjeździe o 06:00: 33 min (typowo 25, o 8 min dłużej), na miejscu około 06:33.",
      "Na trasie nie ma zgłoszonych utrudnień.",
      "Żeby być na 07:00, trzeba wyjechać najpóźniej o 06:27.",
    ]);
  });
});
