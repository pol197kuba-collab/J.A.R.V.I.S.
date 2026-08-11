import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSummary } from "@/lib/agents/runtime.functions";

/**
 * Stark Agent Matrix — HTML5 Canvas rendering of the J.A.R.V.I.S. CORE and
 * its agent satellites. Layout is computed mathematically: few agents form a
 * single wide ring, more agents spill into concentric orbits and the node
 * scale shrinks automatically so the galaxy always fits its container.
 */

export type MatrixNode = {
  agent: AgentSummary;
  x: number;
  y: number;
  r: number;
  orbit: number;
  angle: number;
  active: boolean;
};

type Particle = { t: number; speed: number; node: number };

function isActive(a: AgentSummary) {
  return a.activeRuns > 0 || a.status === "running" || (a.currentTask ?? "") !== "";
}

/** Nodes per orbit ring, growing outward. */
function ringCapacity(ring: number) {
  return ring === 0 ? 6 : 6 + ring * 4;
}

function layout(agents: AgentSummary[], w: number, h: number, time: number): MatrixNode[] {
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(w, h) / 2;
  const rings: AgentSummary[][] = [];
  let idx = 0;
  while (idx < agents.length) {
    const ring = rings.length;
    const cap = ringCapacity(ring);
    rings.push(agents.slice(idx, idx + cap));
    idx += cap;
  }
  const ringCount = Math.max(rings.length, 1);
  const coreR = maxR * 0.24;
  const usable = maxR * 0.96 - coreR;
  const nodes: MatrixNode[] = [];

  rings.forEach((ringAgents, ring) => {
    const t = ringCount === 1 ? 0.62 : 0.42 + (ring / (ringCount - 1)) * 0.55;
    const orbitR = coreR + usable * t;
    const perNode = (2 * Math.PI * orbitR) / Math.max(ringAgents.length, 1);
    const nodeR = Math.max(12, Math.min(maxR * 0.13, perNode * 0.36));
    const spin = time * 0.00004 * (ring % 2 === 0 ? 1 : -1);
    ringAgents.forEach((agent, i) => {
      const angle = (i / ringAgents.length) * Math.PI * 2 - Math.PI / 2 + spin + ring * 0.35;
      const bob = Math.sin(time * 0.0009 + i * 1.7) * nodeR * 0.08;
      nodes.push({
        agent,
        x: cx + Math.cos(angle) * (orbitR + bob),
        y: cy + Math.sin(angle) * (orbitR + bob) * 0.86,
        r: nodeR,
        orbit: orbitR,
        angle,
        active: isActive(agent),
      });
    });
  });
  return nodes;
}

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function AgentMatrix({
  agents,
  onSelect,
}: {
  agents: AgentSummary[];
  onSelect: (agent: AgentSummary) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<MatrixNode[]>([]);
  const agentsRef = useRef(agents);
  const particlesRef = useRef<Particle[]>([]);
  const hoverRef = useRef<number>(-1);
  const [hover, setHover] = useState<{ node: MatrixNode; x: number; y: number } | null>(null);

  agentsRef.current = agents;

  const pick = useCallback((mx: number, my: number) => {
    return nodesRef.current.findIndex((n) => Math.hypot(n.x - mx, n.y - my) <= n.r * 1.15);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    const start = performance.now();

    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      const time = now - start;
      const list = agentsRef.current;
      ctx.clearRect(0, 0, w, h);
      if (w < 10 || h < 10) return;

      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.min(w, h) / 2;
      const coreR = maxR * 0.24;
      const nodes = layout(list, w, h, time);
      nodesRef.current = nodes;

      // faint orbit ellipses
      const drawn = new Set<number>();
      for (const n of nodes) {
        const key = Math.round(n.orbit);
        if (drawn.has(key)) continue;
        drawn.add(key);
        ctx.beginPath();
        ctx.ellipse(cx, cy, n.orbit, n.orbit * 0.86, 0, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(90, 200, 255, 0.12)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // data beams core -> active agents
      nodes.forEach((n, i) => {
        const beam = n.active || hoverRef.current === i;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(n.x, n.y);
        ctx.strokeStyle = beam ? "rgba(120, 220, 255, 0.45)" : "rgba(120, 220, 255, 0.10)";
        ctx.lineWidth = beam ? 1.6 : 0.8;
        ctx.stroke();
      });

      // particles travelling along the beams
      const activeIdx = nodes.map((n, i) => (n.active ? i : -1)).filter((i) => i >= 0);
      const target = Math.min(90, activeIdx.length * 10);
      if (activeIdx.length > 0 && particlesRef.current.length < target) {
        particlesRef.current.push({
          t: 0,
          speed: 0.004 + Math.random() * 0.006,
          node: activeIdx[Math.floor(Math.random() * activeIdx.length)]!,
        });
      }
      particlesRef.current = particlesRef.current.filter((p) => {
        const n = nodes[p.node];
        p.t += p.speed;
        if (!n || p.t > 1) return false;
        const px = cx + (n.x - cx) * p.t;
        const py = cy + (n.y - cy) * p.t;
        const size = 1.6 + Math.sin(p.t * Math.PI) * 1.6;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(160, 235, 255, ${0.25 + Math.sin(p.t * Math.PI) * 0.7})`;
        ctx.fill();
        return true;
      });

      // ---- CORE ------------------------------------------------------
      const pulse = 1 + Math.sin(time * 0.0021) * 0.05;
      const r = coreR * pulse;
      const glow = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 2.4);
      glow.addColorStop(0, "rgba(255, 190, 90, 0.55)");
      glow.addColorStop(0.35, "rgba(255, 140, 40, 0.18)");
      glow.addColorStop(1, "rgba(255, 120, 0, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2);
      ctx.fill();

      // plasma swirls
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      base.addColorStop(0, "rgba(255, 250, 220, 1)");
      base.addColorStop(0.45, "rgba(255, 196, 80, 0.95)");
      base.addColorStop(1, "rgba(220, 110, 15, 0.9)");
      ctx.fillStyle = base;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      for (let i = 0; i < 4; i++) {
        const a = time * 0.0006 * (i % 2 ? -1 : 1) + i * 1.6;
        const sx = cx + Math.cos(a) * r * 0.4;
        const sy = cy + Math.sin(a) * r * 0.4;
        const swirl = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.75);
        swirl.addColorStop(0, "rgba(255, 240, 190, 0.55)");
        swirl.addColorStop(1, "rgba(255, 140, 20, 0)");
        ctx.fillStyle = swirl;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      ctx.restore();

      // core rim + orbiting sparks
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 220, 150, 0.6)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      for (let i = 0; i < 22; i++) {
        const a = time * 0.0012 + (i / 22) * Math.PI * 2;
        const rr = r * (1.15 + 0.25 * Math.sin(time * 0.002 + i));
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9, 1.3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 205, 120, 0.7)";
        ctx.fill();
      }

      // ---- NODES -----------------------------------------------------
      const fontScale = Math.max(8, Math.min(12, maxR * 0.055));
      nodes.forEach((n, i) => {
        const hovered = hoverRef.current === i;
        const nr = n.r * (hovered ? 1.12 : 1);
        const tint = n.active ? "120, 230, 255" : n.agent.isEnabled ? "90, 180, 230" : "120, 130, 150";
        const halo = ctx.createRadialGradient(n.x, n.y, nr * 0.2, n.x, n.y, nr * 1.9);
        halo.addColorStop(0, `rgba(${tint}, ${n.active ? 0.35 : 0.18})`);
        halo.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(n.x, n.y, nr * 1.9, 0, Math.PI * 2);
        ctx.fill();

        hexPath(ctx, n.x, n.y, nr);
        ctx.fillStyle = `rgba(${tint}, ${hovered ? 0.22 : 0.12})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${tint}, ${hovered ? 1 : 0.7})`;
        ctx.lineWidth = hovered ? 2 : 1.2;
        ctx.stroke();

        hexPath(ctx, n.x, n.y, nr * 0.62);
        ctx.strokeStyle = `rgba(${tint}, 0.35)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        if (n.active) {
          const ring = (time % 1600) / 1600;
          hexPath(ctx, n.x, n.y, nr * (1 + ring * 0.8));
          ctx.strokeStyle = `rgba(${tint}, ${0.5 * (1 - ring)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // label
        const label = n.agent.name.toUpperCase();
        ctx.font = `600 ${fontScale}px "Rajdhani", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = `rgba(${tint}, 0.95)`;
        ctx.fillText(label, n.x, n.y + nr + 4);
      });
    };

    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const i = pick(mx, my);
    hoverRef.current = i;
    const n = nodesRef.current[i];
    setHover(n ? { node: n, x: n.x, y: n.y } : null);
  };

  const handleClick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = pick(e.clientX - rect.left, e.clientY - rect.top);
    const n = nodesRef.current[i];
    if (n) onSelect(n.agent);
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-manipulation"
        onPointerMove={handleMove}
        onPointerLeave={() => {
          hoverRef.current = -1;
          setHover(null);
        }}
        onPointerDown={handleClick}
      />

      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-[var(--core-label,3.2rem)] text-center">
        <p className="font-display text-sm font-bold tracking-[0.3em] text-[color:oklch(0.85_0.14_75)] sm:text-lg">
          J.A.R.V.I.S. CORE
        </p>
        <p className="font-display text-[8px] uppercase tracking-[0.25em] text-muted-foreground sm:text-[10px]">
          Just A Rather Very Intelligent System
        </p>
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-44 rounded-lg border border-primary/40 bg-background/85 p-2 font-mono text-[10px] uppercase tracking-[0.08em] text-foreground/90 shadow-[0_0_25px_-6px_var(--primary)] backdrop-blur"
          style={{
            left: Math.min(Math.max(hover.x + 14, 8), (wrapRef.current?.clientWidth ?? 300) - 184),
            top: Math.max(hover.y - 60, 8),
          }}
        >
          <p className="font-display text-[10px] tracking-[0.2em] text-primary">
            {hover.node.agent.name}
          </p>
          <p className="mt-1 text-muted-foreground">
            TASK:{" "}
            <span className="text-foreground/90">{hover.node.agent.currentTask ?? "STANDBY"}</span>
          </p>
          <p className="text-muted-foreground">
            PROGRESS: <span className="text-foreground/90">{hover.node.agent.progress}%</span>
          </p>
          <p className="text-muted-foreground">
            TIME:{" "}
            <span className="text-foreground/90">
              {Math.floor(hover.node.agent.timeElapsedSeconds / 60)}m{" "}
              {hover.node.agent.timeElapsedSeconds % 60}s
            </span>
          </p>
        </div>
      )}
    </div>
  );
}