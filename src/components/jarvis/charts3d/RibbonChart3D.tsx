import { useEffect, useRef, useState, type ReactNode } from "react";
import { resolveCssColor } from "@/lib/theme/themeColor";
// Type-only: erased at build, so three.js never reaches the main bundle.
import type { RibbonChart, RibbonHover, RibbonInput } from "./createRibbonChart";

/**
 * The 3D ribbon chart, lazy: three.js loads in its own chunk the first time a
 * chart mounts. Series colours come in as CSS (tokens) and are resolved here.
 * Renders on demand only. `tooltip(i)` draws the HTML readout for row `i` at
 * the hovered point. While three loads (or if it fails) `fallback` shows.
 */
export function RibbonChart3D({
  data,
  tooltip,
  fallback,
  className,
}: {
  data: Omit<RibbonInput, "series"> & {
    series: Array<Omit<RibbonInput["series"][number], "color"> & { color: string }>;
  };
  tooltip: (i: number) => ReactNode;
  fallback: ReactNode;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<RibbonChart | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<RibbonHover | null>(null);
  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    let cancelled = false;
    let chart: RibbonChart | null = null;
    (async () => {
      try {
        const { createRibbonChart } = await import("./createRibbonChart");
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        chart = createRibbonChart(
          canvas,
          {
            primary: resolveCssColor("var(--primary)", "#00e6f9"),
            muted: resolveCssColor("var(--muted-foreground)", "#7fb9c0"),
            hot: resolveCssColor("var(--reactor-hot)", "#ffcd42"),
          },
          setHover,
        );
        chartRef.current = chart;
        chart.set(resolve(latest.current));
        setReady(true);
      } catch (err) {
        console.warn("[ribbon-chart] 3D unavailable, keeping the flat chart", err);
        if (!cancelled) setFailed(true);
      }
    })();
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      chartRef.current?.tilt(
        (e.clientX / window.innerWidth) * 2 - 1,
        (e.clientY / window.innerHeight) * 2 - 1,
      );
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    return () => {
      cancelled = true;
      window.removeEventListener("pointermove", onPointer);
      chartRef.current = null;
      chart?.dispose();
    };
  }, []);

  useEffect(() => {
    chartRef.current?.set(resolve(data));
    setHover(null);
  }, [data]);

  if (failed) return <>{fallback}</>;
  return (
    <div className={className} style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        aria-label="Wykres 3D"
        className="absolute inset-0 block h-full w-full cursor-crosshair transition-opacity duration-500"
        style={{ opacity: ready ? 1 : 0 }}
      />
      {!ready && <div className="absolute inset-0">{fallback}</div>}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap"
          style={{ left: hover.x, top: hover.y, transform: "translate(-50%, calc(-100% - 18px))" }}
        >
          {tooltip(hover.i)}
        </div>
      )}
    </div>
  );
}

function resolve(d: Parameters<typeof RibbonChart3D>[0]["data"]): RibbonInput {
  return {
    ...d,
    series: d.series.map((s) => ({ ...s, color: resolveCssColor(s.color, "#00e6f9") })),
  };
}
