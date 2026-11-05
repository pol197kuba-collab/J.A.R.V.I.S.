import { describe, expect, it } from "vitest";
import {
  DUR,
  FOV_CORE,
  FOV_LOGIN,
  P_LIVE,
  QUALITY_WINDOW,
  SKIP_MULT,
  bloomAt,
  cameraAt,
  coreCameraPosition,
  coreLook,
  ease,
  fitCamera,
  initialDpr,
  nodeProgress,
  overlayInteractive,
  overlayLook,
  overlayOpacity,
  pickMotionVariant,
  qualityVerdict,
  reactorLook,
  reactorOpacities,
  ringGrowth,
  seg,
  startTransition,
  stepTransition,
  viewBlend,
  viewOffsetFor,
} from "./loginSceneMath";

const base = {
  anchor: { x: 30, y: -20, z: 900 },
  lookAnchor: { x: 30, y: -20, z: 0 },
  endCam: { x: 0, y: 158, z: 612 },
  endLook: { x: 0, y: 0, z: 0 },
  boot: 1,
  reduced: false,
  pointer: { x: 0, y: 0 },
};

describe("constants", () => {
  it("match the prototype motion budget", () => {
    expect(DUR).toEqual({ full: 2.4, short: 0.9, min: 0.4 });
    expect(P_LIVE).toBe(0.58);
    expect(SKIP_MULT).toBe(6);
    expect(P_LIVE * DUR.full).toBeCloseTo(1.39, 2); // ≈ 1.4 s
  });
});

describe("camera Bézier", () => {
  it("starts on the login anchor and ends on the core frame", () => {
    const a = cameraAt(0, base);
    expect(a.position).toEqual(base.anchor);
    expect(a.lookAt).toEqual({ x: 30, y: -20, z: 0 });
    expect(a.fov).toBe(FOV_LOGIN);
    const b = cameraAt(1, base);
    expect(b.position.x).toBeCloseTo(base.endCam.x);
    expect(b.position.y).toBeCloseTo(base.endCam.y);
    expect(b.position.z).toBeCloseTo(base.endCam.z);
    expect(b.lookAt).toEqual(base.endLook);
    expect(b.fov).toBe(FOV_CORE);
  });

  it("flies monotonically from login to core", () => {
    let prevK = -1;
    let prevFov = 0;
    for (let i = 0; i <= 100; i++) {
      const r = cameraAt(i / 100, base);
      expect(r.k).toBeGreaterThanOrEqual(prevK);
      expect(r.fov).toBeGreaterThanOrEqual(prevFov);
      prevK = r.k;
      prevFov = r.fov;
    }
  });

  it("dives through the mid control point (z drops below both ends)", () => {
    const mid = cameraAt(0.4, base).position.z;
    expect(mid).toBeLessThan(base.anchor.z);
  });

  it("boot intro pulls the camera back (z × 1.5 at boot 0)", () => {
    expect(cameraAt(0, { ...base, boot: 0 }).position.z).toBeCloseTo(base.anchor.z * 1.5);
  });

  it("parallax fades out by p = .25 and is off when reduced", () => {
    const ptr = { x: 1, y: 1 };
    expect(cameraAt(0, { ...base, pointer: ptr }).position.x).toBeCloseTo(base.anchor.x + 16);
    expect(cameraAt(0.25, { ...base, pointer: ptr }).position.x).toBeCloseTo(
      cameraAt(0.25, base).position.x,
    );
    expect(cameraAt(0, { ...base, pointer: ptr, reduced: true }).position).toEqual(base.anchor);
  });

  it("reduced motion cuts instead of flying", () => {
    const r = { ...base, reduced: true };
    expect(cameraAt(0.49, r).k).toBe(0);
    expect(cameraAt(0.51, r).k).toBe(1);
  });
});

describe("fitCamera / coreCameraPosition", () => {
  it("centres a centred slot on the axis", () => {
    const f = fitCamera(
      { left: 620, top: 100, width: 200, height: 200 },
      { width: 1440, height: 810 },
    );
    expect(f.x).toBeCloseTo(0);
    expect(f.z).toBeGreaterThan(0);
  });

  it("a bigger slot means a closer camera", () => {
    const vp = { width: 1440, height: 810 };
    const small = fitCamera({ left: 670, top: 100, width: 100, height: 100 }, vp);
    const big = fitCamera({ left: 620, top: 100, width: 200, height: 200 }, vp);
    expect(big.z).toBeLessThan(small.z);
  });

  it("core camera widens on tall viewports, stays put on wide ones", () => {
    const wide = coreCameraPosition(72, 16 / 9);
    expect(wide).toEqual({ x: 0, y: 2.2 * 72, z: 8.5 * 72 });
    const tall = coreCameraPosition(72, 390 / 844);
    expect(tall.z).toBeGreaterThan(wide.z);
    expect(tall.z / wide.z).toBeLessThanOrEqual(2.3);
  });
});

describe("p mapping", () => {
  it("reactor is whole at p=0 once booted, gone by p=.5", () => {
    const l0 = reactorLook(0, 1);
    expect(l0.fade).toBe(1);
    expect(l0.a).toBeCloseTo(0.6);
    expect(l0.visible).toBe(true);
    expect(reactorLook(0.5, 1).fade).toBe(0);
    expect(reactorLook(0.55, 1).visible).toBe(false);
    expect(reactorLook(0, 0).fade).toBe(0); // invisible until the boot intro starts
  });

  it("core ignites between .12 and .5", () => {
    expect(coreLook(0.12).visible).toBe(false);
    expect(coreLook(0.5).g).toBe(1);
    expect(coreLook(0.5).lightIntensity).toBe(70000);
    expect(coreLook(0.32).heat).toBe(1);
  });

  it("rings and agents are monotonic 0 → 1, agents staggered", () => {
    let pr = 0;
    let pn = 0;
    for (let i = 0; i <= 100; i++) {
      const p = i / 100;
      expect(ringGrowth(p)).toBeGreaterThanOrEqual(pr);
      expect(nodeProgress(p, 2)).toBeGreaterThanOrEqual(pn);
      pr = ringGrowth(p);
      pn = nodeProgress(p, 2);
    }
    expect(ringGrowth(1)).toBe(1);
    expect(nodeProgress(1, 4)).toBe(1);
    expect(nodeProgress(0.5, 4)).toBeLessThan(nodeProgress(0.5, 0));
  });

  it("bloom goes .3 → .62, threshold .5 → .55, radius .55", () => {
    expect(bloomAt(0)).toEqual({ strength: 0.3, threshold: 0.5, radius: 0.55 });
    expect(bloomAt(1).strength).toBeCloseTo(0.62);
    expect(bloomAt(1).threshold).toBeCloseTo(0.55);
  });

  it("reactor opacities hit their prototype maxima", () => {
    const o = reactorOpacities(1, 1);
    expect(o.line).toBe(1);
    expect(o.lineSoft).toBeCloseTo(0.6);
    expect(o.lineFaint).toBeCloseTo(0.42);
    expect(o.disc).toBe(1);
    expect(reactorOpacities(0.6, 0).line).toBe(0);
  });
});

describe("overlay", () => {
  it("flash peaks at 30% (reactor colour) and is black-fade when reduced", () => {
    const peak = overlayLook((0.18 + 0.55) / 2, false);
    expect(peak.flash).toBeCloseTo(0.3, 3);
    expect(peak.flashBlack).toBe(false);
    expect(overlayLook(0, false).flash).toBe(0);
    expect(overlayLook(1, false).flash).toBeCloseTo(0);
    const r = overlayLook(0.5, true);
    expect(r.flashBlack).toBe(true);
    expect(r.flash).toBeCloseTo(1); // fully black mid-cut, no flicker colours
    for (let i = 0; i <= 100; i++)
      expect(overlayLook(i / 100, false).flash).toBeLessThanOrEqual(0.3 + 1e-9);
  });

  it("fades out only after P_LIVE and stops catching input there", () => {
    expect(overlayOpacity(0)).toBe(1);
    expect(overlayOpacity(P_LIVE)).toBe(1);
    expect(overlayOpacity(1)).toBe(0);
    let prev = 1;
    for (let i = 0; i <= 100; i++) {
      const v = overlayOpacity(i / 100);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
    expect(overlayInteractive(P_LIVE - 0.001)).toBe(true);
    expect(overlayInteractive(P_LIVE)).toBe(false);
  });

  it("grid fades out, vignette lifts", () => {
    expect(overlayLook(0, false).grid).toBeCloseTo(0.55);
    expect(overlayLook(1, false).grid).toBe(0);
    expect(overlayLook(1, false).vignette).toBeCloseTo(0.35);
  });
});

describe("transition driver", () => {
  it("runs 0 → 1 in DUR.full and reports P_LIVE once", () => {
    const t = startTransition("full");
    let live = 0;
    let p = 0;
    let done = false;
    let liveAtP = -1;
    for (let i = 0; i < 400 && !done; i++) {
      const r = stepTransition(t, 1 / 60);
      if (r.justLive) {
        live++;
        liveAtP = r.p;
      }
      p = r.p;
      done = r.done;
    }
    expect(done).toBe(true);
    expect(p).toBe(1);
    expect(live).toBe(1);
    expect(liveAtP).toBeGreaterThanOrEqual(P_LIVE);
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

describe("adaptive quality", () => {
  it("waits for the 120th frame", () => {
    expect(qualityVerdict(60, 60, 2, 2)).toBeNull();
  });
  it("needs MORE than half slow", () => {
    expect(qualityVerdict(QUALITY_WINDOW, 60, 2, 2)).toBeNull();
    expect(qualityVerdict(QUALITY_WINDOW, 61, 2, 2)).toBe(1.25);
  });
  it("floors at min(devicePixelRatio, 1.25), never below", () => {
    expect(qualityVerdict(QUALITY_WINDOW, 120, 1.75, 2)).toBe(1.25);
    expect(qualityVerdict(QUALITY_WINDOW, 120, 1, 1)).toBeNull();
    expect(qualityVerdict(QUALITY_WINDOW, 120, 1.0, 1.0)).toBeNull();
    expect(qualityVerdict(QUALITY_WINDOW, 120, 1.5, 1.5)).toBe(1.25);
  });
  it("initial DPR caps at 1.75 (1.5 on narrow screens)", () => {
    expect(initialDpr(3, 1440)).toBe(1.75);
    expect(initialDpr(3, 390)).toBe(1.5);
    expect(initialDpr(1, 1440)).toBe(1);
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

describe("end-frame alignment with the /jarvis canvas", () => {
  const vp = { width: 1440, height: 810 };
  const rect = { left: 40, top: 48, width: 1400, height: 440 };

  it("blend is 0 until P_LIVE and 1 at the end, monotonic", () => {
    expect(viewBlend(0)).toBe(0);
    expect(viewBlend(P_LIVE)).toBe(0);
    expect(viewBlend(1)).toBe(1);
    let prev = 0;
    for (let i = 0; i <= 100; i++) {
      expect(viewBlend(i / 100)).toBeGreaterThanOrEqual(prev);
      prev = viewBlend(i / 100);
    }
  });

  it("no offset before the blend starts or without a rect", () => {
    expect(viewOffsetFor(0, vp, rect)).toBeNull();
    expect(viewOffsetFor(1, vp, null)).toBeNull();
  });

  it("at w = 1 the frustum maps exactly onto the rect", () => {
    const o = viewOffsetFor(1, vp, rect)!;
    expect(o.aspect).toBeCloseTo(rect.width / rect.height);
    expect(o.fullWidth).toBe(rect.width);
    expect(o.fullHeight).toBe(rect.height);
    expect(o.x).toBe(-rect.left);
    expect(o.y).toBe(-rect.top);
    expect(o.width).toBe(vp.width);
  });

  it("w = 0.5 sits halfway between the full frame and the rect", () => {
    const o = viewOffsetFor(0.5, vp, rect)!;
    expect(o.fullWidth).toBeCloseTo((vp.width + rect.width) / 2);
    expect(o.x).toBeCloseTo(-rect.left / 2);
  });
});
