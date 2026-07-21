import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useServerFn } from "@tanstack/react-start";
import { HudPanel } from "./HudPanel";
import { useHudNavigate } from "./TransitionContext";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { emitChat } from "@/lib/ai/chatBus";
import { analyzeScan } from "@/lib/vision/vision.functions";
import {
  Aperture,
  Camera,
  MessageSquare,
  ShieldAlert,
  VideoOff,
  Loader2,
  SwitchCamera,
  Minus,
  Plus,
  X,
} from "lucide-react";

// Set by VoiceCommandContext before it navigates here ("Jarvis, co widzisz?"),
// consumed once on mount so the scan fires as soon as the camera is ready.
const PENDING_SCAN_KEY = "jarvis_pending_scan";

type CamState = "loading" | "ready" | "denied" | "unavailable";

type ExtendedCapabilities = MediaTrackCapabilities & {
  zoom?: { min: number; max: number; step?: number };
  focusMode?: string[];
  pointsOfInterest?: unknown;
};

type ExtendedConstraint = MediaTrackConstraintSet & {
  zoom?: number;
  focusMode?: string;
  pointsOfInterest?: Array<{ x: number; y: number }>;
};

type FocusPulse = { id: number; x: number; y: number };

function getViewportOrientation() {
  if (typeof window === "undefined") return "landscape";
  return window.matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape";
}

function getCameraAspectRatio() {
  return getViewportOrientation() === "portrait" ? 9 / 16 : 16 / 9;
}

export function VisionScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);
  const orientationRef = useRef<"portrait" | "landscape">(getViewportOrientation());
  const longPressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const [state, setState] = useState<CamState>("loading");
  const [flashing, setFlashing] = useState(false);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [zoomCaps, setZoomCaps] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoomFraction, setZoomFraction] = useState(0);
  const [baselineFraction, setBaselineFraction] = useState(0);
  const [focusPulses, setFocusPulses] = useState<FocusPulse[]>([]);
  const [afLocked, setAfLocked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastTapAt, setLastTapAt] = useState(0);
  const [lensPopoverOpen, setLensPopoverOpen] = useState(false);
  const lensPopoverRef = useRef<HTMLDivElement | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const runScanAnalysis = useServerFn(analyzeScan);
  const { go } = useHudNavigate();
  // Voice-command bridge: scan queued before the camera finished booting.
  const wantScanRef = useRef(false);

  const stopStream = useCallback(() => {
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, []);

  const start = useCallback(
    async (opts?: { deviceId?: string | null; facingMode?: "environment" | "user" }) => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      if (startingRef.current) return;
      startingRef.current = true;
      setState("loading");
      stopStream();

      const videoConstraints: MediaTrackConstraints = opts?.deviceId
        ? {
            deviceId: { exact: opts.deviceId },
            aspectRatio: { ideal: getCameraAspectRatio() },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          }
        : {
            facingMode: { ideal: opts?.facingMode ?? "environment" },
            aspectRatio: { ideal: getCameraAspectRatio() },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          };

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: videoConstraints,
      };
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }

        // Enumerate lenses (labels only populate after grant).
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          const vids = all.filter((d) => d.kind === "videoinput");
          setDevices(vids);
        } catch {
          // ignore
        }

        // Track the active device id from the running track.
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings?.() ?? {};
        if (settings.deviceId) setActiveDeviceId(settings.deviceId);

        // Zoom capabilities
        try {
          const caps = (track?.getCapabilities?.() ?? {}) as ExtendedCapabilities;
          if (caps.zoom && caps.zoom.max > caps.zoom.min) {
            const min = caps.zoom.min;
            const max = caps.zoom.max;
            setZoomCaps({
              min,
              max,
              step: caps.zoom.step && caps.zoom.step > 0 ? caps.zoom.step : 0.1,
            });
            const rawCur = (track?.getSettings?.() as { zoom?: number } | undefined)?.zoom;
            const cur = typeof rawCur === "number" && rawCur >= min && rawCur <= max ? rawCur : min;
            // Inverted mapping: fraction 0 → max (widest), 1 → min (tightest).
            const frac = (max - cur) / (max - min);
            setBaselineFraction(frac);
            setZoomFraction(frac);
          } else {
            setZoomCaps(null);
            setBaselineFraction(0);
            setZoomFraction(0);
          }
        } catch {
          setZoomCaps(null);
        }

        setAfLocked(false);
        setState("ready");
      } catch (err: unknown) {
        const name = (err as { name?: string })?.name ?? "";
        if (
          name === "NotAllowedError" ||
          name === "SecurityError" ||
          name === "PermissionDeniedError"
        ) {
          setState("denied");
        } else if (
          name === "NotFoundError" ||
          name === "OverconstrainedError" ||
          name === "DevicesNotFoundError"
        ) {
          setState("unavailable");
        } else {
          setState("unavailable");
        }
      } finally {
        startingRef.current = false;
      }
    },
    [stopStream],
  );

  // Initial mount
  useEffect(() => {
    void start({ facingMode: "environment" });
    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause on hidden / restart on visible (iOS)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        stopStream();
      } else if (document.visibilityState === "visible" && !streamRef.current) {
        void start(activeDeviceId ? { deviceId: activeDeviceId } : { facingMode });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [activeDeviceId, facingMode, start, stopStream]);

  // Mobile Chrome can keep the old landscape camera track after rotation.
  // Restart only when the actual viewport orientation flips, so portrait uses
  // a portrait capture surface like the native camera app.
  useEffect(() => {
    if (typeof window === "undefined") return;
    orientationRef.current = getViewportOrientation();
    let restartTimer: number | null = null;

    const restartForOrientation = () => {
      const next = getViewportOrientation();
      if (next === orientationRef.current) return;
      orientationRef.current = next;
      if (document.visibilityState === "hidden") return;
      if (!streamRef.current || startingRef.current) return;

      if (restartTimer) window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(() => {
        void start(activeDeviceId ? { deviceId: activeDeviceId } : { facingMode });
      }, 220);
    };

    const media = window.matchMedia("(orientation: portrait)");
    window.addEventListener("orientationchange", restartForOrientation);
    window.addEventListener("resize", restartForOrientation);
    media.addEventListener?.("change", restartForOrientation);

    return () => {
      if (restartTimer) window.clearTimeout(restartTimer);
      window.removeEventListener("orientationchange", restartForOrientation);
      window.removeEventListener("resize", restartForOrientation);
      media.removeEventListener?.("change", restartForOrientation);
    };
  }, [activeDeviceId, facingMode, start]);

  // Apply hardware zoom from zoomFraction (inverted: 0 → max, 1 → min).
  useEffect(() => {
    if (!zoomCaps) return;
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    const raw = zoomCaps.max + (zoomCaps.min - zoomCaps.max) * zoomFraction;
    const c: ExtendedConstraint = { zoom: raw };
    track.applyConstraints({ advanced: [c] } as MediaTrackConstraints).catch(() => undefined);
  }, [zoomFraction, zoomCaps]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1400);
  }, []);

  const flipFacing = useCallback(() => {
    audio.playClick();
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    setActiveDeviceId(null);
    setLensPopoverOpen(false);
    void start({ facingMode: next });
  }, [facingMode, start]);

  // Rear/front device split — case-insensitive via lowercased label.
  const { rearDevices, rearLabels } = useMemo(() => {
    const rear: MediaDeviceInfo[] = [];
    for (const d of devices) {
      const l = (d.label ?? "").toLowerCase();
      if (!/front|user/.test(l)) rear.push(d);
    }
    const labels = rear.map((d, i) => {
      const l = (d.label ?? "").toLowerCase();
      if (/ultra/.test(l)) return "ULT";
      if (/wide/.test(l)) return "WID";
      if (/tele/.test(l)) return "TEL";
      if (/macro/.test(l)) return "MAC";
      return `L${i + 1}`;
    });
    return { rearDevices: rear, rearLabels: labels };
  }, [devices]);

  const showLensesButton = facingMode === "environment" && rearDevices.length > 1;

  const pickLens = useCallback(
    (deviceId: string) => {
      audio.playClick();
      setLensPopoverOpen(false);
      setActiveDeviceId(deviceId);
      void start({ deviceId });
    },
    [start],
  );

  // Close popover on outside click.
  useEffect(() => {
    if (!lensPopoverOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!lensPopoverRef.current) return;
      if (!lensPopoverRef.current.contains(e.target as Node)) {
        setLensPopoverOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [lensPopoverOpen]);

  const clampFrac = (f: number) => Math.min(1, Math.max(0, f));

  const bumpZoom = (delta: number) => {
    // delta +1 → user-side closer (fraction up), −1 → wider (fraction down)
    setZoomFraction((f) => clampFrac(f + delta * 0.1));
  };

  const resetZoom = () => {
    setZoomFraction(baselineFraction);
  };

  const tryTapFocus = useCallback(async (nx: number, ny: number) => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      const caps = (track.getCapabilities?.() ?? {}) as ExtendedCapabilities;
      const modes = caps.focusMode ?? [];
      const wantsMode = modes.includes("single-shot")
        ? "single-shot"
        : modes.includes("manual")
          ? "manual"
          : null;
      if (wantsMode && caps.pointsOfInterest !== undefined) {
        const c: ExtendedConstraint = {
          focusMode: wantsMode,
          pointsOfInterest: [{ x: nx, y: ny }],
        };
        await track.applyConstraints({ advanced: [c] } as MediaTrackConstraints);
      }
    } catch {
      // ignore — visual pulse still shown
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (state !== "ready") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    pressStart.current = { x, y, t: Date.now() };
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(async () => {
      const track = streamRef.current?.getVideoTracks?.()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as ExtendedCapabilities;
      const modes = caps.focusMode ?? [];
      if (track && modes.includes("manual")) {
        try {
          const c: ExtendedConstraint = { focusMode: "manual" };
          await track.applyConstraints({ advanced: [c] } as MediaTrackConstraints);
          setAfLocked(true);
          showToast("AF LOCKED");
        } catch {
          showToast("AF LOCK N/A");
        }
      } else {
        showToast("AF LOCK N/A");
      }
      pressStart.current = null;
    }, 600);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    const start = pressStart.current;
    pressStart.current = null;
    if (!start || state !== "ready") return;
    const dt = Date.now() - start.t;
    if (dt > 550) return; // long-press handled
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = Math.abs(x - start.x);
    const dy = Math.abs(y - start.y);
    if (dx > 12 || dy > 12) return;

    // Double-tap → reset zoom
    const now = Date.now();
    if (now - lastTapAt < 320) {
      resetZoom();
      setLastTapAt(0);
      return;
    }
    setLastTapAt(now);

    // Focus pulse
    const id = now;
    setFocusPulses((p) => [...p, { id, x, y }]);
    window.setTimeout(() => setFocusPulses((p) => p.filter((f) => f.id !== id)), 700);

    const nx = Math.min(1, Math.max(0, x / rect.width));
    const ny = Math.min(1, Math.max(0, y / rect.height));
    void tryTapFocus(nx, ny);
  };

  const handleScan = async () => {
    if (state !== "ready" || analyzing) return;
    audio.playClick();
    const video = videoRef.current;
    const canvas = canvasRef.current;
    let frameBase64: string | null = null;
    if (video && canvas && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          setLastCapture(canvas.toDataURL("image/jpeg", 0.85));
          // Downscaled copy for analysis — Gemini doesn't need full res, and
          // a ~1024px frame keeps the POST payload small and fast on mobile.
          const MAX_SIDE = 1024;
          const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
          const small = document.createElement("canvas");
          small.width = Math.round(video.videoWidth * scale);
          small.height = Math.round(video.videoHeight * scale);
          const smallCtx = small.getContext("2d");
          if (smallCtx) {
            smallCtx.drawImage(video, 0, 0, small.width, small.height);
            frameBase64 = small.toDataURL("image/jpeg", 0.8).split(",")[1] ?? null;
          }
        } catch {
          // taint / decoder errors — fall through with no frame
        }
      }
    }
    setFlashing(true);
    window.setTimeout(() => setFlashing(false), 450);

    if (!frameBase64) {
      setAnalysis({ kind: "error", text: "NIE UDAŁO SIĘ PRZECHWYCIĆ KLATKI — SPRÓBUJ PONOWNIE." });
      return;
    }
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const result = await runScanAnalysis({
        data: {
          imageBase64: frameBase64,
          mimeType: "image/jpeg",
          language: typeof navigator !== "undefined" ? navigator.language : "pl-PL",
        },
      });
      setAnalysis({ kind: "ok", text: result.description });
      speak(result.description);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAnalysis({ kind: "error", text: msg });
    } finally {
      setAnalyzing(false);
    }
  };

  // Stable handle so the voice-command effects below can call the freshest
  // handleScan without re-binding listeners on every state change it touches.
  const handleScanRef = useRef<(() => Promise<void>) | null>(null);
  handleScanRef.current = handleScan;

  // Voice-command bridge, part 1: flag left by VoiceCommandContext before it
  // navigated here — consume once on mount.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(PENDING_SCAN_KEY) === "1") {
        window.sessionStorage.removeItem(PENDING_SCAN_KEY);
        wantScanRef.current = true;
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Part 2: live event for when we're already mounted on /vision.
  useEffect(() => {
    const onScanCmd = () => {
      try {
        window.sessionStorage.removeItem(PENDING_SCAN_KEY);
      } catch {
        /* ignore */
      }
      if (state === "ready" && !analyzing) {
        wantScanRef.current = false;
        void handleScanRef.current?.();
      } else {
        wantScanRef.current = true;
      }
    };
    window.addEventListener("jarvis:vision-scan", onScanCmd);
    return () => window.removeEventListener("jarvis:vision-scan", onScanCmd);
  }, [state, analyzing]);

  // Part 3: fire a queued scan once the camera comes up. Short delay lets
  // auto-exposure settle so Gemini doesn't get a half-black boot frame.
  useEffect(() => {
    if (state !== "ready" || !wantScanRef.current) return;
    wantScanRef.current = false;
    const t = window.setTimeout(() => void handleScanRef.current?.(), 400);
    return () => window.clearTimeout(t);
  }, [state]);

  // "Discuss this" — drop the scan result into the Conversation Stream and
  // jump to the dashboard chat, so follow-up questions carry it as context
  // (getRecentHistory feeds it back to the model on the next turn).
  const discussAnalysis = () => {
    if (!analysis || analysis.kind !== "ok") return;
    audio.playClick();
    emitChat("jarvis", `[SKAN OPTYCZNY] ${analysis.text}`);
    setAnalysis(null);
    go("/");
  };

  const digital = !zoomCaps;
  // Fallback CSS zoom uses fraction directly (0 → 1×, 1 → 3×).
  const digitalScale = 1 + zoomFraction * 2;
  // HUD display (cosmetic).
  const maxDisplay = zoomCaps
    ? Math.max(2, Math.round(zoomCaps.max / Math.max(zoomCaps.min, 0.0001)))
    : 3;
  const displayX = 1 + zoomFraction * (maxDisplay - 1);
  const zoomDisplay = `${displayX.toFixed(1)}×`;

  let lensLabel: string;
  if (facingMode === "user") {
    lensLabel = "LENS FRONT";
  } else if (rearDevices.length > 1) {
    const idx = rearDevices.findIndex((d) => d.deviceId === activeDeviceId);
    const short = idx >= 0 ? rearLabels[idx] : `${Math.max(0, idx) + 1}/${rearDevices.length}`;
    lensLabel = `LENS ${short}`;
  } else {
    lensLabel = "LENS BACK";
  }

  return (
    <div className="flex h-full min-h-0 w-full max-w-full flex-col gap-3 overflow-hidden p-3 landscape:max-md:gap-2 landscape:max-md:p-2">
      <HudPanel
        index={0}
        title="OPTICAL FEED // LIVE"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="relative mx-auto w-full min-w-0 portrait:flex portrait:min-h-0 portrait:flex-1">
          <div
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
              pressStart.current = null;
            }}
            className={
              "relative mx-auto w-full max-w-full touch-none overflow-hidden bg-black portrait:h-full portrait:min-h-0 portrait:flex-1 " +
              "md:aspect-video md:max-h-[68vh] short:max-h-[52vh] landscape:max-md:aspect-video landscape:max-md:max-h-[62vh]"
            }
          >
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                opacity: state === "ready" ? 1 : 0.25,
                transform: digital && digitalScale > 1 ? `scale(${digitalScale})` : undefined,
                transformOrigin: "center center",
                transition: "transform 120ms linear",
              }}
            />

            {/* Vignette */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse at center, transparent 70%, rgba(0,0,0,0.45) 100%)",
              }}
            />

            {/* Targeting reticle corner brackets */}
            <ReticleBrackets />

            {/* Center crosshair */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <svg
                viewBox="0 0 100 100"
                className="h-24 w-24 text-primary/70"
                style={{ filter: "drop-shadow(0 0 4px currentColor)" }}
              >
                <circle
                  cx="50"
                  cy="50"
                  r="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.6"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.4"
                  strokeDasharray="1.4 1.6"
                />
                <line x1="50" y1="26" x2="50" y2="36" stroke="currentColor" strokeWidth="0.5" />
                <line x1="50" y1="64" x2="50" y2="74" stroke="currentColor" strokeWidth="0.5" />
                <line x1="26" y1="50" x2="36" y2="50" stroke="currentColor" strokeWidth="0.5" />
                <line x1="64" y1="50" x2="74" y2="50" stroke="currentColor" strokeWidth="0.5" />
              </svg>
            </div>

            {/* Animated scan line */}
            {state === "ready" && (
              <div
                className="pointer-events-none absolute inset-x-0 h-[2px] animate-vision-scan"
                style={{
                  background: "linear-gradient(90deg, transparent, var(--primary), transparent)",
                  boxShadow: "0 0 12px var(--primary), 0 0 28px var(--primary)",
                }}
              />
            )}

            {/* Corner readouts */}
            <div className="pointer-events-none absolute left-2 top-2 font-display text-[9px] uppercase tracking-[0.3em] text-primary/80">
              OPTIC:{" "}
              <span
                className={
                  state === "ready" ? "text-[color:var(--success)]" : "text-[color:var(--warning)]"
                }
              >
                {state === "ready" ? "● LIVE" : state === "loading" ? "○ BOOT" : "● OFFLINE"}
              </span>
            </div>
            <div className="pointer-events-none absolute right-2 top-2 font-display text-[9px] uppercase tracking-[0.3em] text-primary/60">
              {lensLabel}
            </div>
            <div className="pointer-events-none absolute left-2 bottom-2 font-display text-[9px] uppercase tracking-[0.3em] text-primary/60">
              {afLocked ? "AF: LOCK" : "MODE: SCAN"}
            </div>
            <div className="pointer-events-none absolute right-2 bottom-2 font-display text-[9px] uppercase tracking-[0.3em] text-primary/60">
              ZOOM {zoomDisplay}
              {digital ? " · DIG" : ""}
            </div>

            {/* Focus pulses */}
            {focusPulses.map((f) => (
              <div
                key={f.id}
                className="pointer-events-none absolute animate-ping"
                style={{
                  left: f.x - 22,
                  top: f.y - 22,
                  width: 44,
                  height: 44,
                  border: "1.5px solid var(--primary)",
                  boxShadow: "0 0 10px var(--primary)",
                  borderRadius: 2,
                }}
              />
            ))}

            {/* Toast */}
            {toast && (
              <div
                className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 border border-primary/60 bg-black/70 px-3 py-1 font-display text-[9px] uppercase tracking-[0.35em] text-primary"
                style={{ boxShadow: "var(--glow-primary)" }}
              >
                {toast}
              </div>
            )}

            {/* Zoom slider — right rail */}
            {state === "ready" && (
              <div className="pointer-events-auto absolute right-2 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => bumpZoom(+1)}
                  aria-label="Zoom in"
                  className="grid h-6 w-6 place-items-center border border-primary/60 bg-black/60 text-primary"
                >
                  <Plus className="h-3 w-3" strokeWidth={2} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={1 - zoomFraction}
                  onChange={(e) => {
                    // Slider top = closer (fraction 1), bottom = wider (fraction 0).
                    // vertical-lr places min at top, so invert.
                    const v = Number(e.target.value);
                    setZoomFraction(1 - v);
                  }}
                  aria-label="Zoom"
                  className="vision-zoom-slider h-28 w-6"
                  style={{ writingMode: "vertical-lr" } as CSSProperties}
                />
                <button
                  type="button"
                  onClick={() => bumpZoom(-1)}
                  aria-label="Zoom out"
                  className="grid h-6 w-6 place-items-center border border-primary/60 bg-black/60 text-primary"
                >
                  <Minus className="h-3 w-3" strokeWidth={2} />
                </button>
              </div>
            )}

            {/* Capture flash */}
            {flashing && (
              <div
                className="pointer-events-none absolute inset-0 animate-vision-flash"
                style={{ background: "white" }}
              />
            )}

            {/* State overlays */}
            {state !== "ready" && <StateOverlay state={state} />}

            {/* Thumbnail of last capture */}
            {lastCapture && (
              <div className="pointer-events-none absolute right-2 top-8 h-14 w-14 border border-primary/70 bg-black/60 landscape:max-md:h-10 landscape:max-md:w-10">
                <img src={lastCapture} alt="last capture" className="h-full w-full object-cover" />
                <span className="hud-corner tl" />
                <span className="hud-corner tr" />
                <span className="hud-corner bl" />
                <span className="hud-corner br" />
              </div>
            )}

            {/* Analysis in progress */}
            {analyzing && (
              <div className="pointer-events-none absolute inset-x-4 bottom-8 z-30 flex items-center gap-2 border border-primary/50 bg-black/75 px-3 py-2 font-display text-[10px] uppercase tracking-[0.3em] text-primary">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.5} />
                ANALYZING OPTICAL DATA…
              </div>
            )}

            {/* Analysis result */}
            {analysis && !analyzing && (
              <div
                className="absolute inset-x-4 bottom-8 z-30 border bg-black/80 backdrop-blur-sm"
                style={{
                  borderColor:
                    analysis.kind === "ok"
                      ? "color-mix(in oklab, var(--primary) 60%, transparent)"
                      : "color-mix(in oklab, var(--destructive) 60%, transparent)",
                }}
              >
                <div className="flex min-w-0 items-center justify-between gap-2 border-b border-primary/25 px-3 py-1.5">
                  <span
                    className="font-display text-[9px] uppercase tracking-[0.35em]"
                    style={{
                      color: analysis.kind === "ok" ? "var(--primary)" : "var(--destructive)",
                    }}
                  >
                    {analysis.kind === "ok" ? "ANALYSIS // COMPLETE" : "ANALYSIS // FAILED"}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {analysis.kind === "ok" && (
                      <button
                        type="button"
                        onClick={discussAnalysis}
                        aria-label="Discuss this scan in chat"
                        className="flex h-5 items-center gap-1 border border-primary/50 px-1.5 font-display text-[8px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/15"
                      >
                        <MessageSquare className="h-3 w-3" strokeWidth={2} />
                        DISCUSS
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setAnalysis(null)}
                      aria-label="Dismiss analysis"
                      className="grid h-5 w-5 place-items-center border border-primary/50 text-primary transition hover:bg-primary/15"
                    >
                      <X className="h-3 w-3" strokeWidth={2} />
                    </button>
                  </span>
                </div>
                <p className="max-h-28 min-w-0 overflow-y-auto whitespace-normal break-words px-3 py-2 font-mono text-[11px] leading-snug text-foreground/90 landscape:max-md:max-h-16 landscape:max-md:text-[9px] short:max-h-16 short:text-[9px]">
                  {analysis.text}
                </p>
              </div>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Control bar */}
        <div className="mt-auto flex w-full min-w-0 shrink-0 items-center justify-center gap-3 border-t border-primary/25 p-3 portrait:gap-2 portrait:p-2 landscape:max-md:p-2">
          <button
            type="button"
            onClick={flipFacing}
            disabled={state !== "ready"}
            aria-label="Flip camera"
            className="font-display flex min-w-0 items-center justify-center gap-2 border px-3 py-2 text-[10px] uppercase tracking-[0.3em] text-primary transition disabled:cursor-not-allowed disabled:opacity-40 portrait:flex-1 portrait:px-2 portrait:tracking-[0.24em]"
            style={{
              borderColor: "color-mix(in oklab, var(--primary) 55%, transparent)",
              backgroundColor: "color-mix(in oklab, var(--primary) 6%, transparent)",
            }}
          >
            <SwitchCamera className="h-4 w-4" strokeWidth={1.5} />
            FLIP
          </button>
          {showLensesButton && (
            <div ref={lensPopoverRef} className="relative portrait:flex-1">
              <button
                type="button"
                onClick={() => setLensPopoverOpen((v) => !v)}
                disabled={state !== "ready"}
                aria-label="Rear lenses"
                aria-expanded={lensPopoverOpen}
                className="font-display flex w-full min-w-0 items-center justify-center gap-2 border px-3 py-2 text-[10px] uppercase tracking-[0.3em] text-primary transition disabled:cursor-not-allowed disabled:opacity-40 portrait:px-2 portrait:tracking-[0.24em]"
                style={{
                  borderColor: "color-mix(in oklab, var(--primary) 55%, transparent)",
                  backgroundColor: "color-mix(in oklab, var(--primary) 6%, transparent)",
                }}
              >
                <Aperture className="h-4 w-4" strokeWidth={1.5} />
                LENSES
              </button>
              {lensPopoverOpen && (
                <div
                  className="pointer-events-none absolute left-1/2 z-40"
                  style={{ bottom: "calc(100% + 8px)", transform: "translateX(-50%)" }}
                >
                  <div className="relative" style={{ width: 176, height: 96 }}>
                    {rearDevices.map((d, i) => {
                      const n = rearDevices.length;
                      // Half-circle opening downward: angles from 200° to 340°.
                      const startDeg = 200;
                      const endDeg = 340;
                      const t = n === 1 ? 0.5 : i / (n - 1);
                      const deg = startDeg + (endDeg - startDeg) * t;
                      const rad = (deg * Math.PI) / 180;
                      const r = 72;
                      const x = Math.cos(rad) * r;
                      const y = Math.sin(rad) * r;
                      const active = d.deviceId === activeDeviceId;
                      return (
                        <button
                          key={d.deviceId || i}
                          type="button"
                          onClick={() => pickLens(d.deviceId)}
                          aria-label={`Lens ${rearLabels[i]}`}
                          className="pointer-events-auto absolute grid h-11 w-11 place-items-center rounded-full border font-display text-[9px] uppercase tracking-[0.2em] text-primary"
                          style={{
                            left: "50%",
                            bottom: 0,
                            transform: `translate(calc(-50% + ${x}px), ${y}px)`,
                            borderColor: active
                              ? "var(--primary)"
                              : "color-mix(in oklab, var(--primary) 45%, transparent)",
                            backgroundColor: "color-mix(in oklab, var(--primary) 10%, black)",
                            boxShadow: active ? "var(--glow-primary)" : undefined,
                          }}
                        >
                          {rearLabels[i]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => void handleScan()}
            disabled={state !== "ready" || analyzing}
            aria-label="Scan"
            className="font-display group relative flex min-w-0 items-center justify-center gap-2 border px-6 py-2 text-[11px] uppercase tracking-[0.35em] text-primary transition disabled:cursor-not-allowed disabled:opacity-40 portrait:flex-1 portrait:px-2 portrait:text-[10px] portrait:tracking-[0.24em]"
            style={{
              borderColor: "color-mix(in oklab, var(--primary) 60%, transparent)",
              backgroundColor: "color-mix(in oklab, var(--primary) 8%, transparent)",
              boxShadow: "var(--glow-primary)",
            }}
          >
            {analyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            ) : (
              <Camera className="h-4 w-4" strokeWidth={1.5} />
            )}
            {analyzing ? "SCANNING" : "SCAN"}
          </button>
        </div>
      </HudPanel>
    </div>
  );
}

function ReticleBrackets() {
  const base = "pointer-events-none absolute h-7 w-7 border-primary";
  const shadow = { filter: "drop-shadow(0 0 4px var(--primary))" };
  return (
    <>
      <div className={`${base} left-6 top-6 border-l-2 border-t-2`} style={shadow} />
      <div className={`${base} right-6 top-6 border-r-2 border-t-2`} style={shadow} />
      <div className={`${base} left-6 bottom-6 border-l-2 border-b-2`} style={shadow} />
      <div className={`${base} right-6 bottom-6 border-r-2 border-b-2`} style={shadow} />
    </>
  );
}

function StateOverlay({ state }: { state: Exclude<CamState, "ready"> }) {
  const cfg =
    state === "loading"
      ? {
          icon: <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.5} />,
          title: "INITIALIZING OPTICAL SENSOR",
          sub: "handshake • lens calibration • signal check",
          color: "var(--primary)",
        }
      : state === "denied"
        ? {
            icon: <ShieldAlert className="h-6 w-6" strokeWidth={1.5} />,
            title: "CAMERA ACCESS DENIED",
            sub: "grant permission in your browser to enable vision",
            color: "var(--destructive)",
          }
        : {
            icon: <VideoOff className="h-6 w-6" strokeWidth={1.5} />,
            title: "NO OPTICAL DEVICE FOUND",
            sub: "no compatible camera detected on this unit",
            color: "var(--warning)",
          };
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-[1px]">
      <div className="flex items-center gap-2" style={{ color: cfg.color }}>
        <span
          className="h-2 w-2 animate-blink rounded-full"
          style={{ backgroundColor: cfg.color, boxShadow: `0 0 10px ${cfg.color}` }}
        />
        {cfg.icon}
      </div>
      <div
        className="font-display text-[11px] uppercase tracking-[0.4em]"
        style={{ color: cfg.color }}
      >
        {cfg.title}
      </div>
      <div className="px-6 text-center font-mono text-[9px] uppercase tracking-[0.25em] text-primary/55">
        {cfg.sub}
      </div>
    </div>
  );
}
