import { describe, expect, it } from "vitest";
import {
  DUR,
  FOV_CORE,
  FOV_LOGIN,
  JUMP_MAX_MS,
  JUMP_MIN_MS,
  JUMP_PX_PER_MS,
  LOGIN_ENTER_MS,
  P_LIVE,
  QUALITY_WINDOW,
  SKIP_MULT,
  TUNNEL,
  arkFlash,
  boardOpacity,
  boardPlacement,
  buildStops,
  coreCameraPosition,
  ease,
  easeInOut,
  energyDecay,
  energyKick,
  fitCamera,
  igniteLook,
  initialDpr,
  jumpMs,
  jumpPosition,
  labelPlacement,
  loginCamera,
  loginLook,
  loginProgress,
  moduleIndexAt,
  nodeProgress,
  overlayInteractive,
  overlayOpacity,
  pickMotionVariant,
  portalScale,
  qualityVerdict,
  reactorOpacities,
  scanPercent,
  scrollState,
  seg,
  shakeAt,
  spinBoost,
  startTransition,
  stepTransition,
  stopAt,
  viewBlend,
  viewOffsetFor,
} from "./loginSceneMath";

const VP = { width: 1440, height: 810 };
const homes = [0, 1, 2, 3, 4].map((i) => {
  const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(a) * 216, y: (i % 2 === 0 ? 1 : -1) * 25, z: Math.sin(a) * 216 };
});
const sections = [
  { id: "hero", top: 0, height: 1.6 * 810 },
  { id: "jarvis", top: 1296, height: 2.1 * 810 },
  ...homes.map((_, i) => ({ id: `a${i}`, top: 1296 + (i + 1) * 1701, height: 2.1 * 810 })),
  { id: "modules", top: 1296 + 6 * 1701, height: 5.2 * 810 },
  { id: "engage", top: 1296 + 6 * 1701 + 4212, height: 1.6 * 810 },
];
const engageFit = { x: 0, y: -20, z: 700 };
const stops = () => buildStops({ sections, viewport: VP, engageFit, homes });

describe("constants match the v2 prototype", () => {
  it("ignition 2.6 s, P_LIVE .58, login flight 1100 ms, skip x6", () => {
    expect(DUR).toEqual({ full: 2.6, short: 0.9, min: 0.4 });
    expect(P_LIVE).toBe(0.58);
    expect(LOGIN_ENTER_MS).toBe(1100);
    expect(SKIP_MULT).toBe(6);
    expect(P_LIVE * DUR.full).toBeCloseTo(1.51, 2);
  });
  it("jump constants and tunnel layout", () => {
    expect([JUMP_PX_PER_MS, JUMP_MIN_MS, JUMP_MAX_MS]).toEqual([5.5, 900, 3000]);
    expect(TUNNEL).toEqual({ start: 420, end: -2880, first: -300, step: 205 });
  });
});

describe("jump time and easing", () => {
  it("clamps px / 5.5 to 900..3000 ms", () => {
    expect(jumpMs(100)).toBe(JUMP_MIN_MS);
    expect(jumpMs(5.5 * 2000)).toBeCloseTo(2000);
    expect(jumpMs(-5.5 * 2000)).toBeCloseTo(2000);
    expect(jumpMs(1e6)).toBe(JUMP_MAX_MS);
  });
  it("cubic in-out: endpoints, midpoint, monotonic", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    let prev = 0;
    for (let i = 0; i <= 100; i++) {
      expect(easeInOut(i / 100)).toBeGreaterThanOrEqual(prev);
      prev = easeInOut(i / 100);
    }
  });
  it("jumpPosition runs from → to over jumpMs", () => {
    expect(jumpPosition(0, 11000, 0)).toBe(0);
    expect(jumpPosition(0, 11000, jumpMs(11000))).toBe(11000);
    expect(jumpPosition(0, 11000, 1e9)).toBe(11000);
    expect(jumpPosition(5000, 0, jumpMs(5000) / 2)).toBeCloseTo(2500);
  });
});

describe("stops from DOM sections", () => {
  it("one stop per section, hero starts at 0, engage is open-ended", () => {
    const s = stops();
    expect(s.map((x) => x.id)).toEqual([
      "hero",
      "jarvis",
      "a0",
      "a1",
      "a2",
      "a3",
      "a4",
      "modules",
      "engage",
    ]);
    expect(s[0].a).toBe(0);
    expect(s[s.length - 1].b).toBe(Infinity);
    expect(s[1].b - s[1].a).toBeCloseTo(sections[1].height - VP.height);
  });
  it("hero camera differs between landscape and portrait", () => {
    const land = stops()[0];
    const port = buildStops({
      sections,
      viewport: { width: 390, height: 844 },
      engageFit,
      homes,
    })[0];
    expect(land.look.x).toBe(-235);
    expect(port.look).toEqual({ x: 0, y: -40, z: 0 });
    expect(port.cam.z).toBeGreaterThan(land.cam.z);
  });
  it("agent stops frame their node from outside, alternating sides", () => {
    const s = stops();
    expect(Math.hypot(s[2].cam.x, s[2].cam.z)).toBeGreaterThan(Math.hypot(homes[0].x, homes[0].z));
    expect(Math.sign(s[2].look.x - homes[0].x * 0.7)).toBe(1);
    expect(Math.sign(s[3].look.x - homes[1].x * 0.7)).toBe(-1);
  });
  it("engage stop sits exactly on the fitted reactor", () => {
    const e = stops()[8];
    expect(e.cam).toEqual(engageFit);
    expect(e.look).toEqual({ x: 0, y: -20, z: 0 });
    expect(e.hull).toBe(0);
    expect(e.bloom).toBe(0.26);
  });
  it("modules stop: tunnel on, tight fog, 0.4 hull", () => {
    const m = stops()[7];
    expect([m.tun, m.fogNear, m.fogFar, m.hull, m.bloom]).toEqual([1, 240, 1250, 0.4, 0.45]);
    expect(m.cam).toEqual({ x: 0, y: 0, z: TUNNEL.start });
  });
});

describe("stopAt", () => {
  it("inside a stop range returns that stop (A = B)", () => {
    const r = stopAt(stops(), 100);
    expect(r.same).toBe(true);
    expect(r.A.id).toBe("hero");
  });
  it("between stops interpolates from the previous to the next", () => {
    const s = stops();
    const r = stopAt(s, (s[0].b + s[1].a) / 2);
    expect(r.same).toBe(false);
    expect([r.A.id, r.B.id]).toEqual(["hero", "jarvis"]);
    expect(r.t).toBeCloseTo(0.5);
  });
  it("before the first and after the last stop clamps", () => {
    const s = stops();
    expect(stopAt(s, -50).A.id).toBe("hero");
    const end = stopAt(s, 1e7);
    expect(end.A.id).toBe("engage");
    expect(end.raw).toBe(1);
  });
});

describe("scroll → camera state", () => {
  it("hero: camera on the hero stop, full hull, grid .55, no align", () => {
    const st = scrollState(0, stops());
    expect(st.cam).toEqual(stops()[0].cam);
    expect(st.align).toBe(0);
    expect(st.grid).toBeCloseTo(0.55);
    expect(st.hull).toBe(1);
    expect(st.nodesVisible).toBe(true);
    expect(st.engaged).toBe(0);
  });
  it("is continuous between hero and jarvis", () => {
    const s = stops();
    let prev = scrollState(s[0].b, s).cam;
    for (let y = s[0].b; y <= s[1].a; y += (s[1].a - s[0].b) / 40) {
      const c = scrollState(y, s).cam;
      expect(Math.hypot(c.x - prev.x, c.y - prev.y, c.z - prev.z)).toBeLessThan(80);
      prev = c;
    }
  });
  it("tunnel: camera flies from start to end along z", () => {
    const s = stops();
    const a = scrollState(s[7].a, s);
    const b = scrollState(s[7].b, s);
    expect(a.tunVis).toBe(1);
    expect(a.cam.z).toBeCloseTo(TUNNEL.start);
    expect(b.cam.z).toBeCloseTo(TUNNEL.end);
    expect(a.hudMod).toBe(1);
    expect(a.fogNear).toBe(240);
  });
  it("match cut: white flash peaks at the end of the tunnel, then the reactor aligns", () => {
    const s = stops();
    const gap = s[8].a - s[7].b;
    expect(scrollState(s[7].b + gap * 0.28, s).flash).toBeCloseTo(1);
    const later = scrollState(s[7].b + gap * 0.6, s);
    expect(later.align).toBe(1);
    expect(later.flash).toBe(0);
    expect(later.tunVis).toBe(0);
    expect(later.hull).toBe(0);
    expect(later.nodesVisible).toBe(false);
    expect(later.dustVisible).toBe(false);
  });
  it("engage: aligned on the home rect, UI fully shown, bloom .26", () => {
    const s = stops();
    const e = scrollState(s[8].a + 5, s);
    expect(e.align).toBe(1);
    expect(e.engaged).toBe(1);
    expect(e.bloom).toBe(0.26);
    expect(e.cam).toEqual(engageFit);
    expect(e.grid).toBe(1);
  });
  it("engaged UI fades in only at the end of the approach", () => {
    const s = stops();
    const gap = s[8].a - s[7].b;
    expect(scrollState(s[7].b + gap * 0.5, s).engaged).toBe(0);
    expect(scrollState(s[7].b + gap * 0.99, s).engaged).toBeGreaterThan(0.9);
  });
  it("scan readout", () => {
    expect(scanPercent(0, 10000, 800)).toBe(0);
    expect(scanPercent(9200, 10000, 800)).toBe(100);
    expect(scanPercent(0, 100, 100)).toBe(0); // no scrollable height: prototype clamps the divisor to 1
  });
});

describe("tunnel helpers", () => {
  it("module index runs -1 → count-1 along the tunnel", () => {
    expect(moduleIndexAt(TUNNEL.start, 12)).toBe(-1);
    expect(moduleIndexAt(TUNNEL.end, 12)).toBe(11);
    let prev = -1;
    for (let z = TUNNEL.start; z >= TUNNEL.end; z -= 20) {
      const i = moduleIndexAt(z, 12);
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
  });
  it("boards alternate sides and sit closer to the axis on portrait", () => {
    const l = boardPlacement(0, false);
    const r = boardPlacement(1, false);
    expect(Math.sign(l.x)).toBe(-1);
    expect(Math.sign(r.x)).toBe(1);
    expect(Math.abs(boardPlacement(1, true).x)).toBeLessThan(Math.abs(r.x));
    expect(boardPlacement(3, false).z).toBeLessThan(boardPlacement(2, false).z);
  });
  it("board opacity: 0 far, >0 in range, 0 once passed", () => {
    const z = boardPlacement(0, false).z;
    expect(boardOpacity(z + 900, z)).toBe(0);
    expect(boardOpacity(z + 300, z)).toBeGreaterThan(0.9);
    expect(boardOpacity(z + 10, z)).toBe(0);
  });
  it("portal grows as the camera nears the end", () => {
    expect(portalScale(-1000)).toBeCloseTo(0.12);
    expect(portalScale(TUNNEL.end)).toBeCloseTo(1);
  });
});

describe("login camera and look", () => {
  const from = { cam: { x: 0, y: 0, z: 700 }, look: { x: 0, y: -20, z: 0 } };
  const pose = { x: -120, y: 10, z: 900 };
  it("flies from the engage pose to the login pose", () => {
    const a = loginCamera({ lg: 0, from, pose, pointer: { x: 0, y: 0 }, reduced: false });
    expect(a.cam).toEqual(from.cam);
    const b = loginCamera({ lg: 1, from, pose, pointer: { x: 0, y: 0 }, reduced: false });
    expect(b.cam).toEqual({ x: -120, y: 10, z: 900 });
    expect(b.look).toEqual({ x: -120, y: 10, z: 0 });
  });
  it("parallax ±22 / ±14, scaled by k, off when reduced", () => {
    const base = { lg: 1, from, pose, reduced: false };
    const c = loginCamera({ ...base, pointer: { x: 1, y: 1 } });
    expect(c.cam.x).toBeCloseTo(pose.x + 22);
    expect(c.cam.y).toBeCloseTo(pose.y - 14);
    expect(loginCamera({ ...base, pointer: { x: 1, y: 1 }, reduced: true }).cam.x).toBe(pose.x);
    expect(loginCamera({ ...base, lg: 0, pointer: { x: 1, y: 1 } }).cam.x).toBe(from.cam.x);
  });
  it("progress is time-based and instant when reduced", () => {
    expect(loginProgress(0, false)).toBe(0);
    expect(loginProgress(550, false)).toBeCloseTo(0.5);
    expect(loginProgress(5000, false)).toBe(1);
    expect(loginProgress(0, true)).toBe(1);
  });
  it("hull grows in after 15%, typing energy swells hull and bloom", () => {
    expect(loginLook(0.1, 0, 0).hull).toBe(0);
    const idle = loginLook(1, 0, 0);
    expect(idle.hull).toBeCloseTo(0.6);
    expect(idle.a).toBeCloseTo(0.5);
    const hot = loginLook(1, 1, 0);
    expect(hot.hull).toBeCloseTo(0.6 * 1.25);
    expect(hot.bloom.strength).toBeCloseTo(0.38);
    expect(hot.discScale).toBeCloseTo(1.1);
    expect(loginLook(1, 0, 0.5).bloom.strength).toBeCloseTo(0.24);
    expect(idle.bloom).toEqual({ strength: 0.3, threshold: 0.5, radius: 0.45 });
  });
  it("shake tint clamp(shake·1.8)·.95 and shake² motion", () => {
    expect(shakeAt(1, 0).tint).toBeCloseTo(0.95);
    expect(shakeAt(0.5, 0).tint).toBeCloseTo(0.855);
    expect(shakeAt(0.2, 0).tint).toBeCloseTo(0.342);
    expect(shakeAt(0, 1).x).toBe(0);
    expect(Math.abs(shakeAt(1, 0.1).x)).toBeLessThanOrEqual(5);
  });
  it("energy decays and is kicked, capped at 1", () => {
    expect(energyDecay(1, 0)).toBe(1);
    expect(energyDecay(1, 1)).toBeLessThan(0.12);
    expect(energyKick(0.9, 0.3)).toBe(1);
    expect(energyKick(0, 0.22)).toBeCloseTo(0.22);
  });
  it("spin boost: sine bump during ignition, energy x5 otherwise", () => {
    expect(spinBoost("ignite", 0, 0)).toBe(0);
    expect(spinBoost("ignite", 1 / 3.2, 0)).toBeCloseTo(4);
    expect(spinBoost("other", 0, 0.4)).toBeCloseTo(2);
    expect(spinBoost("other", 0, 3)).toBe(5);
  });
});

describe("ignition mapping p → state", () => {
  it("starts as the login reactor (hull .6, a .5) and the core is cold", () => {
    const l = igniteLook(0);
    expect(l.hull).toBeCloseTo(0.6);
    expect(l.a).toBeCloseTo(0.5);
    expect(l.fade).toBe(1);
    expect(l.g).toBe(0);
    expect(l.coreLight).toBe(0);
    expect(l.extrasVisible).toBe(false);
    expect(l.fov).toBe(FOV_LOGIN);
  });
  it("hull is gone in the first 25% of p", () => {
    expect(igniteLook(0.25).hull).toBe(0);
    expect(igniteLook(0.12).hull).toBeGreaterThan(0);
  });
  it("reactor fades out by .5, core is lit by .5", () => {
    expect(igniteLook(0.5).fade).toBe(0);
    expect(igniteLook(0.5).reactorVisible).toBe(false);
    expect(igniteLook(0.5).g).toBe(1);
    expect(igniteLook(0.5).coreLight).toBe(70000);
    expect(igniteLook(0.32).heat).toBe(1);
  });
  it("ends on the Arc Core frame: fov 45, bloom .62 / .55 / .55, all layers on", () => {
    const e = igniteLook(1);
    expect(e.fov).toBe(FOV_CORE);
    expect(e.k).toBe(1);
    expect(e.bloom.strength).toBeCloseTo(0.62);
    expect(e.bloom.threshold).toBeCloseTo(0.55);
    expect(e.bloom.radius).toBe(0.55);
    expect(e.dustOpacity).toBeCloseTo(0.55);
    expect(e.coronaOpacity).toBeCloseTo(0.55);
    expect(e.shellOpacity).toBeCloseTo(0.17);
    expect(e.floorOpacity).toBeCloseTo(0.15);
    expect(e.orbitOpacity).toBeCloseTo(0.22);
    expect(e.ringDecoOpacity).toBeCloseTo(0.85);
    expect(e.packets).toBe(1);
    expect(e.labels).toBe(1);
    expect([e.fogNear, e.fogFar]).toEqual([1500, 3200]);
  });
  it("bloom starts at .26 (engage level)", () => {
    expect(igniteLook(0).bloom.strength).toBeCloseTo(0.26);
  });
  it("beads from .45, packets only after .7", () => {
    expect(igniteLook(0.44).beadsVisible).toBe(false);
    expect(igniteLook(0.46).beadsVisible).toBe(true);
    expect(igniteLook(0.69).packets).toBe(0);
    expect(igniteLook(0.8).packets).toBeGreaterThan(0);
  });
  it("monotonic: ring growth, status colour, node flight, camera", () => {
    let pr = 0;
    let ps = 0;
    let pn = 0;
    let pk = 0;
    for (let i = 0; i <= 100; i++) {
      const l = igniteLook(i / 100);
      expect(l.ringU).toBeGreaterThanOrEqual(pr);
      expect(l.statusK).toBeGreaterThanOrEqual(ps);
      expect(l.k).toBeGreaterThanOrEqual(pk);
      expect(nodeProgress(i / 100, 2)).toBeGreaterThanOrEqual(pn);
      pr = l.ringU;
      ps = l.statusK;
      pk = l.k;
      pn = nodeProgress(i / 100, 2);
    }
    expect(nodeProgress(0.5, 4)).toBeLessThan(nodeProgress(0.5, 0));
    expect(nodeProgress(1, 5)).toBe(1);
  });
  it("reduced motion cuts the camera at .5 instead of flying", () => {
    expect(igniteLook(0.49, true).k).toBe(0);
    expect(igniteLook(0.51, true).k).toBe(1);
    expect(igniteLook(0.3, false).k).toBeGreaterThan(0);
    expect(igniteLook(0.3, false).k).toBeLessThan(1);
  });
  it("is continuous with the login look at p = 0", () => {
    const l = loginLook(1, 0, 0);
    const i = igniteLook(0);
    expect(i.a).toBeCloseTo(l.a);
    expect(i.hull).toBeCloseTo(l.hull);
  });
});

describe("ignition flash", () => {
  it("none before 0.4 s, white .55 at the start, hot 35 % at 1.0 s, gone by 1.9 s", () => {
    expect(arkFlash(0.1 / 2.6, false).alpha).toBe(0);
    const start = arkFlash(0.4 / 2.6, false);
    expect(start.alpha).toBeCloseTo(0.55);
    expect(start.hotMix).toBe(0);
    const mid = arkFlash(1.0 / 2.6, false);
    expect(mid.alpha).toBeCloseTo(0.245);
    expect(mid.hotMix).toBe(1);
    expect(arkFlash(1.9 / 2.6, false).alpha).toBe(0);
    expect(arkFlash(1, false).alpha).toBe(0);
  });
  it("never exceeds .55 and decreases after the start", () => {
    let prev = 1;
    for (let i = 0; i <= 200; i++) {
      const a = arkFlash(i / 200, false).alpha;
      expect(a).toBeLessThanOrEqual(0.55 + 1e-9);
      if (i / 200 >= 0.4 / 2.6) {
        expect(a).toBeLessThanOrEqual(prev + 1e-9);
        prev = a;
      }
    }
  });
  it("reduced motion: black fade, peak mid-cut, no colour flash", () => {
    const m = arkFlash(0.5, true);
    expect(m.black).toBe(true);
    expect(m.alpha).toBeCloseTo(1);
    expect(arkFlash(0, true).alpha).toBeCloseTo(0);
    expect(arkFlash(1, true).alpha).toBeCloseTo(0);
  });
});

describe("transition driver", () => {
  it("runs 0 → 1 in DUR.full and reports P_LIVE once", () => {
    const t = startTransition("full");
    let live = 0;
    let p = 0;
    let done = false;
    for (let i = 0; i < 400 && !done; i++) {
      const r = stepTransition(t, 1 / 60);
      if (r.justLive) live++;
      p = r.p;
      done = r.done;
    }
    expect(done).toBe(true);
    expect(p).toBe(1);
    expect(live).toBe(1);
    expect(t.liveAt).toBeCloseTo(P_LIVE * DUR.full, 1);
    expect(t.elapsed).toBeCloseTo(DUR.full, 1);
  });
  it("skip is 6× faster", () => {
    const a = startTransition("full");
    const b = startTransition("full");
    b.skip = true;
    stepTransition(a, 0.1);
    stepTransition(b, 0.1);
    expect(b.elapsed).toBeCloseTo(a.elapsed * 6);
  });
  it("min variant is 0.4 s", () => {
    expect(startTransition("min").dur).toBe(0.4);
  });
});

describe("motion variant", () => {
  it("reduce → min, otherwise full", () => {
    expect(pickMotionVariant(true)).toBe("min");
    expect(pickMotionVariant(false)).toBe("full");
  });
});

describe("camera framing", () => {
  it("fitCamera centres a centred slot and scales with span", () => {
    const rect = { left: 620, top: 100, width: 200, height: 200 };
    const f = fitCamera(rect, VP);
    expect(f.x).toBeCloseTo(0);
    expect(f.z).toBeGreaterThan(0);
    const wide = fitCamera(rect, VP, 32, 380);
    expect(wide.z / f.z).toBeCloseTo(380 / 200);
  });
  it("a slot left of centre pushes the camera x positive", () => {
    const f = fitCamera({ left: 100, top: 205, width: 400, height: 400 }, VP, 32, 380);
    expect(f.x).toBeGreaterThan(0);
  });
  it("core camera widens on tall viewports (1.35 / aspect, max 2.5)", () => {
    const wide = coreCameraPosition(72, 16 / 9);
    expect(wide).toEqual({ x: 0, y: 2.7 * 72, z: 9.8 * 72 });
    expect(coreCameraPosition(72, 390 / 844).z / wide.z).toBeCloseTo(2.5);
  });
});

describe("overlay", () => {
  it("fades out only after P_LIVE and stops catching input there", () => {
    expect(overlayOpacity(0)).toBe(1);
    expect(overlayOpacity(P_LIVE)).toBe(1);
    expect(overlayOpacity(1)).toBe(0);
    expect(overlayInteractive(P_LIVE - 0.001)).toBe(true);
    expect(overlayInteractive(P_LIVE)).toBe(false);
  });
});

describe("reactor opacities", () => {
  it("hit their prototype maxima", () => {
    const o = reactorOpacities(1, 1);
    expect(o.line).toBe(1);
    expect(o.lineSoft).toBeCloseTo(0.6);
    expect(o.lineFaint).toBeCloseTo(0.42);
    expect(reactorOpacities(0.6, 0).line).toBe(0);
  });
});

describe("adaptive quality", () => {
  it("waits for the 120th frame and needs MORE than half slow", () => {
    expect(qualityVerdict(60, 60, 2, 2)).toBeNull();
    expect(qualityVerdict(QUALITY_WINDOW, 60, 2, 2)).toBeNull();
    expect(qualityVerdict(QUALITY_WINDOW, 61, 2, 2)).toBe(1.25);
  });
  it("floors at min(devicePixelRatio, 1.25), never below", () => {
    expect(qualityVerdict(QUALITY_WINDOW, 120, 1.75, 2)).toBe(1.25);
    expect(qualityVerdict(QUALITY_WINDOW, 120, 1, 1)).toBeNull();
    expect(qualityVerdict(QUALITY_WINDOW, 120, 1.5, 1.5)).toBe(1.25);
  });
  it("initial DPR caps at 1.75 (1.5 on narrow screens)", () => {
    expect(initialDpr(3, 1440)).toBe(1.75);
    expect(initialDpr(3, 390)).toBe(1.5);
    expect(initialDpr(1, 1440)).toBe(1);
  });
});

describe("end-frame alignment with the /jarvis canvas", () => {
  const rect = { left: 40, top: 48, width: 1400, height: 440 };
  it("blend is 0 until P_LIVE and 1 at the end", () => {
    expect(viewBlend(P_LIVE)).toBe(0);
    expect(viewBlend(1)).toBe(1);
  });
  it("no offset before the blend starts or without a rect; exact at w = 1", () => {
    expect(viewOffsetFor(0, VP, rect)).toBeNull();
    expect(viewOffsetFor(1, VP, null)).toBeNull();
    const o = viewOffsetFor(1, VP, rect)!;
    expect(o.aspect).toBeCloseTo(rect.width / rect.height);
    expect([o.fullWidth, o.fullHeight, o.x, o.y]).toEqual([1400, 440, -40, -48]);
  });
});

describe("helpers", () => {
  it("ease and seg are bounded", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(seg(-1, 0, 1)).toBe(0);
    expect(seg(2, 0, 1)).toBe(1);
  });
});

describe("label placement", () => {
  it("right-hand nodes get left-aligned labels pushed outward", () => {
    const p = labelPlacement(300, 10, false);
    expect(p.align).toBe("left");
    expect(p.ax).toBe("0%");
    expect(p.ox).toBeGreaterThan(46);
  });
  it("left-hand nodes get right-aligned labels pushed left", () => {
    const p = labelPlacement(-300, -10, false);
    expect(p.align).toBe("right");
    expect(p.ax).toBe("-100%");
    expect(p.ox).toBeLessThan(-46);
  });
  it("nodes above/below the core put the label further up/down, centred", () => {
    expect(labelPlacement(0, -200, false)).toMatchObject({ align: "center", oy: -40 });
    expect(labelPlacement(10, 200, false)).toMatchObject({ align: "center", oy: 40 });
  });
  it("narrow screens: centred, no offset", () => {
    expect(labelPlacement(300, 50, true)).toEqual({ ox: 0, oy: 0, ax: "-50%", align: "center" });
  });
});
