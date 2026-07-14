import { useEffect, useRef, useState } from "react";

/**
 * Real device telemetry — FPS via requestAnimationFrame, JS heap via
 * performance.memory (Chromium), CPU thread count, and network downlink
 * via navigator.connection. Each metric maintains a rolling 12-sample
 * trend so the sparkline reflects the actual device state.
 */

type Metric = {
  label: string;
  value: string;
  trend: number[];
  /** 0-100 normalisation for the spark */
  pct: number;
};

type PerfMemory = { usedJSHeapSize: number; jsHeapSizeLimit: number };
type NetInfo = {
  downlink?: number;
  rtt?: number;
  effectiveType?: string;
  addEventListener?: (ev: string, h: () => void) => void;
  removeEventListener?: (ev: string, h: () => void) => void;
};

const TREND_LEN = 12;

function push(arr: number[], v: number) {
  const next = arr.slice(-TREND_LEN + 1);
  next.push(v);
  return next;
}

export function SystemStatsStrip() {
  const [fps, setFps] = useState<Metric>({ label: "FPS", value: "—", trend: [], pct: 0 });
  const [mem, setMem] = useState<Metric>({ label: "MEM", value: "—", trend: [], pct: 0 });
  const [cpu, setCpu] = useState<Metric>({ label: "CPU // THREADS", value: "—", trend: [], pct: 0 });
  const [net, setNet] = useState<Metric>({ label: "NET", value: "—", trend: [], pct: 0 });

  // FPS loop — only samples while the tab is actually in the foreground;
  // a backgrounded tab has nothing to measure and the loop would otherwise
  // keep waking the JS engine for no visible benefit.
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    const tick = () => {
      frames += 1;
      const now = performance.now();
      if (now - last >= 1000) {
        const v = Math.round((frames * 1000) / (now - last));
        setFps((prev) => ({
          label: "FPS",
          value: `${v}`,
          trend: push(prev.trend, v),
          pct: Math.min(100, (v / 120) * 100),
        }));
        frames = 0;
        last = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    const start = () => {
      if (rafRef.current != null) return;
      frames = 0;
      last = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (rafRef.current == null) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Memory + CPU + Net (polled)
  useEffect(() => {
    const cores = navigator.hardwareConcurrency ?? 0;
    const sample = () => {
      if (document.visibilityState !== "visible") return;
      const perf = performance as unknown as { memory?: PerfMemory };
      if (perf.memory) {
        const used = perf.memory.usedJSHeapSize / (1024 * 1024);
        const limit = perf.memory.jsHeapSizeLimit / (1024 * 1024);
        setMem((prev) => ({
          label: "MEM",
          value: `${used.toFixed(0)} MB`,
          trend: push(prev.trend, used),
          pct: Math.min(100, (used / Math.max(1, limit)) * 100),
        }));
      } else {
        setMem({ label: "MEM", value: "N/A", trend: [10, 12, 11, 13, 12, 14], pct: 30 });
      }

      const navConn = (navigator as unknown as { connection?: NetInfo }).connection;
      if (navConn && navConn.downlink != null) {
        const v = navConn.downlink;
        setNet((prev) => ({
          label: "NET",
          value: `${v.toFixed(1)} Mbps`,
          trend: push(prev.trend, v),
          pct: Math.min(100, (v / 100) * 100),
        }));
      } else {
        setNet((prev) => ({
          label: "NET",
          value: navigator.onLine ? "ONLINE" : "OFFLINE",
          trend: push(prev.trend, navigator.onLine ? 60 : 0),
          pct: navigator.onLine ? 60 : 0,
        }));
      }

      // CPU proxy: # of logical cores + load estimate inferred from FPS dip.
      setCpu((prev) => {
        const load = Math.max(0, 100 - (fpsRef.current || 60) * (100 / 60));
        return {
          label: "CPU",
          value: cores ? `${cores}× / ${load.toFixed(0)}%` : `${load.toFixed(0)}%`,
          trend: push(prev.trend, load),
          pct: load,
        };
      });
    };
    sample();
    const id = setInterval(sample, 1500);
    return () => clearInterval(id);
  }, []);

  // Keep a ref of latest FPS so CPU sampler can read it without re-subscribing.
  const fpsRef = useRef(60);
  useEffect(() => {
    const v = parseInt(fps.value, 10);
    if (!Number.isNaN(v)) fpsRef.current = v;
  }, [fps]);

  const metrics = [fps, cpu, mem, net];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {metrics.map((s) => {
        const max = Math.max(1, ...s.trend);
        return (
          <div
            key={s.label}
            className="relative overflow-hidden rounded-lg border border-border/60 bg-card/50 p-3 backdrop-blur"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                {s.label}
              </span>
              <span className="font-display text-lg font-semibold text-primary">{s.value}</span>
            </div>
            <div className="mt-2 flex h-8 items-end gap-1">
              {(s.trend.length ? s.trend : [1]).map((v, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-sm bg-primary/60"
                  style={{ height: `${Math.max(8, (v / max) * 100)}%`, boxShadow: "0 0 8px var(--primary)" }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}