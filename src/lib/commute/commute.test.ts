import { describe, expect, it } from "vitest";
import { bboxAreaKm2, distToPolylineM, incidentBoxes } from "./geo";
import {
  attachIncidents,
  incidentKind,
  incidentRuns,
  isRelevantIncident,
  parseIncidents,
  parseRoutes,
  pickDetour,
  viaStreets,
} from "./tomtom";
import {
  defaultDirection,
  delayMin,
  hm,
  isWorkday,
  leaveByMin,
  parseHm,
  planDeparture,
  warsawLocalToDate,
  warsawParts,
} from "./plan";
import type { CommuteIncident, CommuteRoute, LatLon } from "./types";

const line = (...pts: Array<[number, number]>): LatLon[] => pts.map(([lat, lon]) => ({ lat, lon }));

const route = (over: Partial<CommuteRoute>): CommuteRoute => ({
  points: line([52.0, 21.0], [52.05, 21.05], [52.1, 21.1]),
  distanceM: 10_000,
  durationSec: 1_800,
  typicalSec: 1_500,
  freeFlowSec: 1_400,
  departAt: null,
  arriveAt: null,
  streets: [],
  incidentIds: [],
  ...over,
});

const incident = (over: Partial<CommuteIncident>): CommuteIncident => ({
  id: "i1",
  kind: "accident",
  severity: 3,
  road: null,
  from: null,
  to: null,
  description: null,
  delaySec: 300,
  lengthM: 200,
  startTime: null,
  endTime: null,
  positions: line([52.05, 21.05]),
  at: { lat: 52.05, lon: 21.05 },
  ...over,
});

describe("geo", () => {
  it("odległość punktu od łamanej", () => {
    const l = line([52.0, 21.0], [52.0, 21.1]);
    // ~111 m na północ od linii
    expect(distToPolylineM({ lat: 52.001, lon: 21.05 }, l)).toBeGreaterThan(100);
    expect(distToPolylineM({ lat: 52.001, lon: 21.05 }, l)).toBeLessThan(120);
    expect(distToPolylineM({ lat: 52.0, lon: 21.05 }, l)).toBeLessThan(1);
  });

  it("krótka trasa dostaje jeden prostokąt, długa kilka", () => {
    expect(incidentBoxes(line([52.0, 21.0], [52.1, 21.1]))).toHaveLength(1);
    const far = incidentBoxes(line([50.0, 19.0], [52.0, 21.0], [54.0, 23.0]));
    expect(far.length).toBeGreaterThan(1);
    far.forEach((b) => expect(bboxAreaKm2(b)).toBeLessThan(10_000));
  });
});

describe("parseRoutes", () => {
  const raw = {
    routes: [
      {
        summary: {
          lengthInMeters: 24_600,
          travelTimeInSeconds: 2_280,
          noTrafficTravelTimeInSeconds: 1_500,
          historicTrafficTravelTimeInSeconds: 1_620,
          departureTime: "2026-11-10T06:00:00+01:00",
          arrivalTime: "2026-11-10T06:38:00+01:00",
        },
        legs: [
          {
            points: [
              { latitude: 52.0, longitude: 21.0 },
              { latitude: 52.1, longitude: 21.1 },
            ],
          },
        ],
        guidance: {
          instructions: [
            { routeOffsetInMeters: 0, street: "Domowa" },
            { routeOffsetInMeters: 500, street: "Grójecka" },
            { routeOffsetInMeters: 20_000, roadNumbers: ["S8"] },
          ],
        },
      },
      { summary: { lengthInMeters: 1 } }, // bez czasu — pomijamy
    ],
  };

  it("czyta czasy, typowy czas i ulice", () => {
    const [r] = parseRoutes(raw);
    expect(parseRoutes(raw)).toHaveLength(1);
    expect(r.durationSec).toBe(2_280);
    expect(r.typicalSec).toBe(1_620);
    expect(r.freeFlowSec).toBe(1_500);
    expect(r.streets[0]).toEqual({ name: "Grójecka", meters: 19_500 });
    expect(r.streets.map((s) => s.name)).toContain("S8");
  });

  it("śmieci dają pustą listę, nie wyjątek", () => {
    expect(parseRoutes(null)).toEqual([]);
    expect(parseRoutes({ routes: "x" })).toEqual([]);
  });
});

describe("utrudnienia", () => {
  it("rozpoznaje rodzaje", () => {
    expect(incidentKind(1)).toBe("accident");
    expect(incidentKind(8)).toBe("closure");
    expect(incidentKind(9)).toBe("roadworks");
    expect(incidentKind(null)).toBe("other");
  });

  it("parsuje Point i LineString", () => {
    const list = parseIncidents({
      incidents: [
        {
          geometry: { type: "Point", coordinates: [21.0, 52.0] },
          properties: { id: "a", iconCategory: 1, magnitudeOfDelay: 3, roadNumbers: ["S8"] },
        },
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [21.0, 52.0],
              [21.1, 52.1],
            ],
          },
          properties: {
            id: "b",
            iconCategory: 9,
            events: [{ description: "Roboty", iconCategory: 9 }],
          },
        },
      ],
    });
    expect(list.map((i) => i.kind)).toEqual(["accident", "roadworks"]);
    expect(list[0].at).toEqual({ lat: 52.0, lon: 21.0 });
    expect(list[1].description).toBe("Roboty");
  });

  it("drobny korek i pogoda nie są wiadomością", () => {
    expect(isRelevantIncident(incident({ kind: "jam", severity: 1 }))).toBe(false);
    expect(isRelevantIncident(incident({ kind: "jam", severity: 2 }))).toBe(true);
    expect(isRelevantIncident(incident({ kind: "hazard", severity: 1 }))).toBe(false);
    expect(isRelevantIncident(incident({ kind: "accident", severity: 0 }))).toBe(true);
  });

  it("przypisuje do trasy tylko to, co na niej leży", () => {
    const main = route({});
    const far = incident({ id: "far", positions: line([53.0, 22.0]) });
    const near = incident({ id: "near" });
    const shown = attachIncidents([main], [far, near]);
    expect(main.incidentIds).toEqual(["near"]);
    expect(shown.map((i) => i.id)).toEqual(["near"]);
  });
});

describe("pickDetour", () => {
  const main = route({
    durationSec: 2_280,
    streets: [{ name: "Grójecka", meters: 9_000 }],
    incidentIds: ["acc"],
  });
  const acc = incident({ id: "acc" });
  const altPoints = line([52.0, 21.0], [51.98, 21.06], [52.1, 21.1]);

  it("proponuje szybszy objazd z nazwami ulic", () => {
    const alt = route({
      points: altPoints,
      durationSec: 1_860,
      streets: [
        { name: "Rakowiecka", meters: 4_000 },
        { name: "Grójecka", meters: 500 },
      ],
    });
    const d = pickDetour(main, [alt], [acc]);
    expect(d?.reason).toBe("faster");
    expect(d?.savesSec).toBe(420);
    expect(d?.via).toEqual(["Rakowiecka"]);
  });

  it("omija poważne utrudnienie nawet będąc minimalnie dłuższym", () => {
    const calmMain = route({ durationSec: 1_800, incidentIds: ["acc"] });
    const alt = route({ points: altPoints, durationSec: 1_900 });
    const d = pickDetour(calmMain, [alt], [acc]);
    expect(d?.reason).toBe("avoids_incident");
  });

  it("nie proponuje niczego, gdy alternatywa jest tą samą trasą albo gorsza", () => {
    expect(pickDetour(main, [route({ durationSec: 1_000 })], [acc])).toBeNull();
    const slower = route({ points: altPoints, durationSec: 3_500 });
    expect(pickDetour(main, [slower], [acc])).toBeNull();
  });

  it("viaStreets pomija ulice wspólne i krótkie odcinki", () => {
    const alt = route({
      streets: [
        { name: "Grójecka", meters: 2_000 },
        { name: "Zaułek", meters: 100 },
        { name: "Puławska", meters: 3_000 },
      ],
    });
    expect(viaStreets(main, alt)).toEqual(["Puławska"]);
  });
});

describe("plan", () => {
  // 2026-11-10 to wtorek; zima, czyli UTC+1.
  const at = (iso: string) => new Date(iso);

  it("liczy czas warszawski", () => {
    expect(warsawParts(at("2026-11-10T05:00:00Z"))).toEqual({
      date: "2026-11-10",
      minutes: 360,
      weekday: 2,
    });
  });

  it("w oknie wokół wyjazdu liczy „teraz”", () => {
    const p = planDeparture(at("2026-11-10T05:10:00Z"), 360); // 06:10
    expect(p.live).toBe(true);
  });

  it("przed oknem planuje dzisiejszy wyjazd, po oknie — następny dzień roboczy", () => {
    const early = planDeparture(at("2026-11-10T02:00:00Z"), 360); // 03:00
    expect(early.live).toBe(false);
    expect(early.at.toISOString()).toBe("2026-11-10T05:00:00.000Z");
    const late = planDeparture(at("2026-11-10T12:00:00Z"), 360); // 13:00 wtorek
    expect(late.at.toISOString()).toBe("2026-11-11T05:00:00.000Z");
  });

  it("w piątek po oknie przeskakuje na poniedziałek", () => {
    const fri = planDeparture(at("2026-11-13T12:00:00Z"), 360);
    expect(fri.at.toISOString()).toBe("2026-11-16T05:00:00.000Z");
  });

  it("w weekend nie ma „teraz”", () => {
    const sat = planDeparture(at("2026-11-14T05:10:00Z"), 360);
    expect(sat.live).toBe(false);
    expect(sat.at.toISOString()).toBe("2026-11-16T05:00:00.000Z");
  });

  it("latem godzina lokalna to UTC+2", () => {
    expect(warsawLocalToDate("2026-07-01", 360).toISOString()).toBe("2026-07-01T04:00:00.000Z");
  });

  it("kierunek domyślny: rano do pracy, po południu powrót", () => {
    const s = { departToMin: 360, departBackMin: 890 };
    expect(defaultDirection(at("2026-11-10T05:30:00Z"), s)).toBe("to");
    expect(defaultDirection(at("2026-11-10T14:00:00Z"), s)).toBe("back");
  });

  it("godziny, opóźnienie i „wyjdź o”", () => {
    expect(hm(375)).toBe("06:15");
    expect(parseHm("6:05")).toBe(365);
    expect(parseHm("25:00")).toBeNull();
    expect(isWorkday(0)).toBe(false);
    expect(delayMin(2_280, 1_620)).toBe(11);
    expect(delayMin(2_280, null)).toBeNull();
    expect(leaveByMin(480, 2_280)).toBe(480 - 38);
    expect(leaveByMin(null, 2_280)).toBeNull();
  });
});

describe("incidentRuns", () => {
  it("zaznacza fragment trasy przy wypadku, z zapasem po bokach", () => {
    const r = route({
      points: line([52.0, 21.0], [52.01, 21.0], [52.02, 21.0], [52.03, 21.0], [52.04, 21.0]),
      incidentIds: ["acc"],
    });
    const acc = incident({ id: "acc", positions: line([52.02, 21.0]) });
    const runs = incidentRuns(r, [acc]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(line([52.01, 21.0], [52.02, 21.0], [52.03, 21.0]));
  });

  it("pomija drobne utrudnienia i te spoza trasy", () => {
    const r = route({ incidentIds: ["j"] });
    expect(incidentRuns(r, [incident({ id: "j", kind: "roadworks", severity: 1 })])).toEqual([]);
    expect(incidentRuns(r, [incident({ id: "other" })])).toEqual([]);
  });
});

import { decideAlert, inWatchWindow, RE_ALERT_GROWTH_MIN } from "./alert";
import type { CommuteFacts } from "./brief";

describe("alert o opóźnieniu", () => {
  const facts = (over: Partial<CommuteFacts> = {}): CommuteFacts => ({
    departHm: "06:00",
    arriveHm: "06:38",
    durationMin: 38,
    typicalMin: 27,
    delayMin: 11,
    leaveByHm: null,
    arriveByHm: null,
    incidents: [],
    detour: null,
    ...over,
  });
  const cfg = { alertEnabled: true, alertDelayMin: 10 };
  const now = new Date("2026-11-10T04:50:00Z"); // 05:50 wtorek

  it("okno sprawdzania: tylko dni robocze, wokół wyjazdu", () => {
    const s = { departToMin: 360, departBackMin: 890 };
    expect(inWatchWindow(now, "to", s)).toBe(true);
    expect(inWatchWindow(new Date("2026-11-10T07:00:00Z"), "to", s)).toBe(false);
    expect(inWatchWindow(new Date("2026-11-14T04:50:00Z"), "to", s)).toBe(false); // sobota
  });

  it("wysyła, gdy opóźnienie przekracza próg, i zapamiętuje to", () => {
    const d = decideAlert("to", facts(), cfg, {}, now);
    expect(d.send).toBe(true);
    if (d.send) {
      expect(d.title).toBe("Dojazd do pracy: +11 min");
      expect(d.body).toContain("38 min (typowo 27)");
    }
    expect(d.state.to?.delayMin).toBe(11);
    expect(d.state.day).toBe("2026-11-10");
  });

  it("nie powtarza się przy tym samym korku, ale mówi, gdy zrobiło się wyraźnie gorzej", () => {
    const first = decideAlert("to", facts(), cfg, {}, now);
    expect(decideAlert("to", facts({ delayMin: 14 }), cfg, first.state, now).send).toBe(false);
    const worse = decideAlert(
      "to",
      facts({ delayMin: 11 + RE_ALERT_GROWTH_MIN }),
      cfg,
      first.state,
      now,
    );
    expect(worse.send).toBe(true);
  });

  it("nowa doba zaczyna od zera; wyłączony alert milczy; mały korek nie budzi", () => {
    const old = { day: "2026-11-09", to: { delayMin: 30 } };
    expect(decideAlert("to", facts(), cfg, old, now).send).toBe(true);
    expect(decideAlert("to", facts(), { ...cfg, alertEnabled: false }, {}, now).send).toBe(false);
    expect(decideAlert("to", facts({ delayMin: 4 }), cfg, {}, now).send).toBe(false);
  });

  it("poważne utrudnienie z objazdem budzi nawet bez dużego opóźnienia", () => {
    const f = facts({
      delayMin: 3,
      incidents: [{ label: "wypadek", where: "Grójecka", delayMin: 3 }],
      detour: { via: ["Puławska"], durationMin: 30, savesMin: 2, avoidsIncident: true },
    });
    const d = decideAlert("to", f, cfg, {}, now);
    expect(d.send).toBe(true);
    if (d.send) expect(d.body).toContain("objazd przez Puławska: 30 min");
  });
});
