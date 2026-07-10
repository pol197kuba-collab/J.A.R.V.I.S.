import { useEffect, useRef, useState } from "react";
import { HudPanel } from "./HudPanel";
import { audio } from "@/lib/audio/AudioEngine";
import { Camera, ShieldAlert, VideoOff, Loader2 } from "lucide-react";

type CamState = "loading" | "ready" | "denied" | "unavailable";

export function VisionScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<CamState>("loading");
  const [flashing, setFlashing] = useState(false);
  const [lastCapture, setLastCapture] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
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
      }
    }
    void start();

    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };
  }, []);

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

  return (
    <div className="space-y-3 p-3 landscape:max-md:space-y-2 landscape:max-md:p-2">
      <HudPanel index={0} title="OPTICAL FEED // LIVE" className="flex flex-col">
        <div className="relative mx-auto w-full">
          <div
            className={
              "relative mx-auto aspect-[3/4] w-full overflow-hidden bg-black md:aspect-video " +
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
              CH-VIS-01
            </div>
            <div className="pointer-events-none absolute left-2 bottom-2 font-display text-[9px] uppercase tracking-[0.3em] text-primary/60">
              MODE: SCAN
            </div>
            <div className="pointer-events-none absolute right-2 bottom-2 font-display text-[9px] uppercase tracking-[0.3em] text-primary/60">
              FPS: 30
            </div>

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

        {/* SCAN button */}
        <div className="flex items-center justify-center border-t border-primary/25 p-3 landscape:max-md:p-2">
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