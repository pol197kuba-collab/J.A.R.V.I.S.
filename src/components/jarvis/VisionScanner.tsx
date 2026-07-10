import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { HudPanel } from "./HudPanel";
import { audio } from "@/lib/audio/AudioEngine";
import { Camera, ShieldAlert, VideoOff, Loader2, SwitchCamera, Minus, Plus } from "lucide-react";

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

export function VisionScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const [state, setState] = useState<CamState>("loading");
  const [flashing, setFlashing] = useState(false);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [zoomCaps, setZoomCaps] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [digitalZoom, setDigitalZoom] = useState(1); // fallback CSS zoom (1–3)
  const [focusPulses, setFocusPulses] = useState<FocusPulse[]>([]);
  const [afLocked, setAfLocked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastTapAt, setLastTapAt] = useState(0);

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

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: opts?.deviceId
          ? { deviceId: { exact: opts.deviceId } }
          : { facingMode: { ideal: opts?.facingMode ?? "environment" } },
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
            setZoomCaps({
              min: caps.zoom.min,
              max: caps.zoom.max,
              step: caps.zoom.step && caps.zoom.step > 0 ? caps.zoom.step : 0.1,
            });
            setZoom(caps.zoom.min);
            setDigitalZoom(1);
          } else {
            setZoomCaps(null);
            setDigitalZoom(1);
          }
        } catch {
          setZoomCaps(null);
        }

        setAfLocked(false);
        setState("ready");
      } catch (err: unknown) {
        const name = (err as { name?: string })?.name ?? "";
        if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
          setState("denied");
        } else if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
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
        void start(
          activeDeviceId
            ? { deviceId: activeDeviceId }
            : { facingMode },
        );
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [activeDeviceId, facingMode, start, stopStream]);

  // Apply hardware zoom
  useEffect(() => {
    if (!zoomCaps) return;
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    const c: ExtendedConstraint = { zoom };
    track.applyConstraints({ advanced: [c] } as MediaTrackConstraints).catch(() => undefined);
  }, [zoom, zoomCaps]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1400);
  }, []);

  const cycleLens = useCallback(() => {
    audio.playClick();
    if (devices.length >= 2) {
      const idx = Math.max(0, devices.findIndex((d) => d.deviceId === activeDeviceId));
      const next = devices[(idx + 1) % devices.length];
      void start({ deviceId: next.deviceId });
    } else {
      const nextFacing = facingMode === "environment" ? "user" : "environment";
      setFacingMode(nextFacing);
      void start({ facingMode: nextFacing });
    }
  }, [devices, activeDeviceId, facingMode, start]);

  const clampZoom = (z: number) =>
    zoomCaps ? Math.min(zoomCaps.max, Math.max(zoomCaps.min, z)) : Math.min(3, Math.max(1, z));

  const bumpZoom = (delta: number) => {
    if (zoomCaps) {
      setZoom((z) => clampZoom(z + delta * (zoomCaps.step || 0.1) * 4));
    } else {
      setDigitalZoom((z) => clampZoom(z + delta * 0.2));
    }
  };

  const resetZoom = () => {
    if (zoomCaps) setZoom(zoomCaps.min);
    else setDigitalZoom(1);
  };

  const tryTapFocus = useCallback(
    async (nx: number, ny: number) => {
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
    },
    [],
  );

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

  const handleScan = () => {
    if (state !== "ready") return;
    audio.playClick();
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          setLastCapture(canvas.toDataURL("image/jpeg", 0.85));
        } catch {
          // ignore taint / decoder errors — silent for stage 1
        }
      }
    }
    setFlashing(true);
    window.setTimeout(() => setFlashing(false), 450);
  };

  const lensIndex = devices.findIndex((d) => d.deviceId === activeDeviceId);
  const lensLabel =
    devices.length >= 2
      ? `LENS ${Math.max(0, lensIndex) + 1}/${devices.length}`
      : `LENS ${facingMode === "environment" ? "BACK" : "FRONT"}`;
  const digital = !zoomCaps;
  const zoomValue = zoomCaps ? zoom : digitalZoom;
  const zoomMin = zoomCaps?.min ?? 1;
  const zoomMax = zoomCaps?.max ?? 3;
  const zoomStep = zoomCaps?.step ?? 0.05;
  const zoomDisplay = digital
    ? `${zoomValue.toFixed(1)}×`
    : `${(zoomValue / zoomMin).toFixed(1)}×`;

  return (
    <div className="flex min-h-0 flex-col gap-3 p-3 portrait:min-h-[100dvh] landscape:max-md:gap-2 landscape:max-md:p-2">
      <HudPanel index={0} title="OPTICAL FEED // LIVE" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative mx-auto w-full">
          <div
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
              pressStart.current = null;
            }}
            className={
              "relative mx-auto aspect-[3/4] w-full touch-none overflow-hidden bg-black md:aspect-video " +
              "max-h-[68vh] short:max-h-[52vh] landscape:max-md:aspect-video landscape:max-md:max-h-[62vh]"
            }
          >
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                filter: "contrast(1.05) saturate(1.1) hue-rotate(-4deg)",
                opacity: state === "ready" ? 1 : 0.25,
                transform: digital && digitalZoom > 1 ? `scale(${digitalZoom})` : undefined,
                transformOrigin: "center center",
                transition: "transform 120ms linear",
              }}
            />

            {/* Cyan tint & vignette */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 85%, rgba(0,0,0,0.95) 100%)",
                mixBlendMode: "multiply",
              }}
            />
            <div
              className="pointer-events-none absolute inset-0 opacity-25 mix-blend-overlay"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, rgba(34,211,238,0.22) 0 1px, transparent 1px 4px)",
              }}
            />

            {/* Targeting reticle corner brackets */}
            <ReticleBrackets />

            {/* Center crosshair */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <svg viewBox="0 0 100 100" className="h-24 w-24 text-primary/70" style={{ filter: "drop-shadow(0 0 4px currentColor)" }}>
                <circle cx="50" cy="50" r="18" fill="none" stroke="currentColor" strokeWidth="0.6" />
                <circle cx="50" cy="50" r="10" fill="none" stroke="currentColor" strokeWidth="0.4" strokeDasharray="1.4 1.6" />
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
                  background:
                    "linear-gradient(90deg, transparent, var(--primary), transparent)",
                  boxShadow: "0 0 12px var(--primary), 0 0 28px var(--primary)",
                }}
              />
            )}

            {/* Corner readouts */}
            <div className="pointer-events-none absolute left-2 top-2 font-display text-[9px] uppercase tracking-[0.3em] text-primary/80">
              OPTIC:{" "}
              <span className={state === "ready" ? "text-[color:var(--success)]" : "text-[color:var(--warning)]"}>
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
                  min={zoomMin}
                  max={zoomMax}
                  step={zoomStep}
                  value={zoomValue}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (zoomCaps) setZoom(v);
                    else setDigitalZoom(v);
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
          </div>

          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Control bar */}
        <div className="mt-auto flex shrink-0 items-center justify-center gap-3 border-t border-primary/25 p-3 landscape:max-md:p-2">
          <button
            type="button"
            onClick={cycleLens}
            disabled={state !== "ready"}
            aria-label="Switch lens"
            className="font-display flex items-center gap-2 border px-3 py-2 text-[10px] uppercase tracking-[0.3em] text-primary transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: "color-mix(in oklab, var(--primary) 55%, transparent)",
              backgroundColor: "color-mix(in oklab, var(--primary) 6%, transparent)",
            }}
          >
            <SwitchCamera className="h-4 w-4" strokeWidth={1.5} />
            LENS
          </button>
          <button
            type="button"
            onClick={handleScan}
            disabled={state !== "ready"}
            aria-label="Scan"
            className="font-display group relative flex items-center gap-2 border px-6 py-2 text-[11px] uppercase tracking-[0.35em] text-primary transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: "color-mix(in oklab, var(--primary) 60%, transparent)",
              backgroundColor: "color-mix(in oklab, var(--primary) 8%, transparent)",
              boxShadow: "var(--glow-primary)",
            }}
          >
            <Camera className="h-4 w-4" strokeWidth={1.5} />
            SCAN
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