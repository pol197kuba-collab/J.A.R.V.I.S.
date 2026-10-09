import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Crosshair, Minus, Plus } from "lucide-react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { getAgentFlow, type FlowRun } from "@/lib/agents/flow.functions";
import type { AgentSummary } from "@/lib/agents/runtime.functions";
import { useAgentChatChannel } from "@/lib/ai/useAgentChatChannel";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { cn } from "@/lib/utils";
import { TOWN_AGENTS, VISIT, WORLD_H, WORLD_W, type TownSlug } from "./townMap";
import { AGENT_COLOR } from "./townArt";
import { TAG, TownWorld, type Camera, type CharStatus } from "./townWorld";
import { TownDirector, characterStatus, isActive, type TownCommand } from "./townDirector";

const FALLBACK_NAMES: Record<TownSlug, string> = {
  jarvis: "J.A.R.V.I.S.",
  insight: "I.N.S.I.G.H.T.",
  metric: "M.E.T.R.I.C.",
  forge: "F.O.R.G.E.",
  shield: "S.H.I.E.L.D.",
  herald: "H.E.R.A.L.D.",
  user: "Ty",
};
const STATUS_LABEL: Record<CharStatus, string> = {
  idle: "Wolny",
  running: "Pracuje",
  done: "Skończył",
  error: "Problem",
  off: "Wyłączony",
};
const STATUS_CLASS: Record<CharStatus, string> = {
  idle: "border-border text-muted-foreground",
  running: "border-warning bg-warning/15 text-warning",
  done: "border-success bg-success/15 text-success",
  error: "border-destructive bg-destructive/15 text-destructive",
  off: "border-border text-muted-foreground opacity-70",
};
const QUICK = [
  { label: "Raport paliwowy", text: "Przygotuj raport o cenach paliw na jutro" },
  { label: "Kontrola systemu", text: "Sprawdź, czy w nocy coś się wysypało" },
  { label: "Plan postów", text: "Zaplanuj posty na LinkedIn na przyszły tydzień" },
];
/** A command J.A.R.V.I.S. never turned into a server run (e.g. answered by
 *  the local fallback brain) is closed after this long. */
const UNMATCHED_COMMAND_MS = 9000;

type LogLine = { id: number; time: string; slug: TownSlug; text: string };

const clock = () =>
  new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDur = (r: FlowRun) => {
  const end = r.finishedAt ? Date.parse(r.finishedAt) : Date.now();
  const s = Math.max(0, Math.round((end - Date.parse(r.createdAt)) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

export function TownView() {
  const { send, agents, messages, activeAgent } = useAgentChatChannel();
  const fetchFlow = useServerFn(getAgentFlow);
  const { data: flow, error: flowError } = useQuery({
    queryKey: ["agents", "flow"],
    queryFn: () => fetchFlow(),
    refetchInterval: 3000,
  });
  const runs = useMemo(() => flow?.runs ?? [], [flow]);

  const [selected, setSelected] = useState<TownSlug>("jarvis");
  const [commands, setCommands] = useState<TownCommand[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<TownSlug | "auto">("auto");
  const [, setTick] = useState(0);

  // `agents` is a fresh [] on every render until the query has data, so key
  // the memo on content, not identity — otherwise the sync effect below
  // (which depends on it and sets state) would loop forever.
  const agentsKey = agents
    .map((a) => `${a.slug}:${a.status}:${a.progress}:${a.isEnabled}:${a.currentTask}`)
    .join("|");
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const summaries = useMemo(() => {
    const m = new Map<string, AgentSummary>();
    for (const a of agentsRef.current) m.set(a.slug, a);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentsKey]);
  const nameOf = useCallback(
    (slug: TownSlug) => summaries.get(slug)?.name ?? FALLBACK_NAMES[slug],
    [summaries],
  );

  // refs the imperative world/director read without re-subscribing
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const nameRef = useRef(nameOf);
  nameRef.current = nameOf;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<TownWorld | null>(null);
  const directorRef = useRef<TownDirector | null>(null);
  const camRef = useRef<Camera>({ x: 0, y: 0, z: 1 });
  const fitRef = useRef(1);
  const dprRef = useRef(1);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logSeq = useRef(0);
  const openedLogged = useRef(false);
  const portraitRef = useRef<HTMLCanvasElement | null>(null);

  const pushLog = useCallback((slug: TownSlug, line: string) => {
    setLog((l) => [{ id: ++logSeq.current, time: clock(), slug, text: line }, ...l].slice(0, 40));
  }, []);

  // ── world + director, created once on the client ─────────────────────────
  useEffect(() => {
    const world = new TownWorld();
    world.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    worldRef.current = world;
    directorRef.current = new TownDirector(world, {
      log: (slug, line) => pushLog(slug, line),
      takeCommand: (runId) => {
        const cmd = commandsRef.current.find((c) => !c.runId && c.state === "pending") ?? null;
        if (!cmd) return null;
        setCommands((cs) =>
          cs.map((c) => (c.id === cmd.id ? { ...c, runId, state: "running" } : c)),
        );
        return cmd;
      },
      commandFinished: (runId, ok) =>
        setCommands((cs) =>
          cs.map((c) => (c.runId === runId ? { ...c, state: ok ? "done" : "error" } : c)),
        ),
      latestReply: () => {
        const last = [...messagesRef.current].reverse().find((m) => m.role === "jarvis");
        return last?.text?.replace(/\s+/g, " ").trim() || null;
      },
      name: (slug) => nameRef.current(slug),
    });
    if (!openedLogged.current) {
      openedLogged.current = true;
      pushLog("jarvis", "Biuro otwarte. Agenci na swoich miejscach.");
    }
    // Dev-only handle for poking the simulation from the console / e2e checks.
    if (import.meta.env.DEV)
      (window as unknown as { __town?: unknown }).__town = { world, director: directorRef.current };
    return () => {
      worldRef.current = null;
      directorRef.current = null;
    };
  }, [pushLog]);

  useEffect(() => {
    if (portraitRef.current) worldRef.current?.drawPortrait(portraitRef.current, selected);
  }, [selected]);

  // real data → events
  useEffect(() => {
    if (flow) directorRef.current?.ingest(flow);
  }, [flow]);

  // statuses, progress bars and board cards (also re-evaluated every second
  // so "done"/"error" states fade on their own)
  useEffect(() => {
    const sync = () => {
      const w = worldRef.current;
      if (!w) return;
      const now = Date.now();
      for (const slug of TOWN_AGENTS) {
        const s = summaries.get(slug);
        w.status[slug] = characterStatus(slug, runs, s?.isEnabled, now);
        w.progress[slug] = s && s.progress > 0 && s.progress < 100 ? s.progress / 100 : null;
      }
      const color = (slug: string) =>
        (TOWN_AGENTS as readonly string[]).includes(slug)
          ? AGENT_COLOR[slug as TownSlug]
          : "#a59a8c";
      w.cards = [
        ...commandsRef.current
          .filter((c) => c.state === "pending")
          .map(() => ({ color: AGENT_COLOR.user, col: 0 as const })),
        ...runs
          .filter((r) => isActive(r.status))
          .map((r) => ({ color: color(r.agentSlug), col: 1 as const })),
        ...runs
          .filter((r) => !isActive(r.status))
          .slice(0, 8)
          .map((r) => ({ color: color(r.agentSlug), col: 2 as const })),
      ];
      setTick((t) => (t + 1) % 1e6);
    };
    sync();
    const id = window.setInterval(sync, 1000);
    return () => window.clearInterval(id);
  }, [runs, summaries, commands]);

  // ── canvas: size, camera, render loop ────────────────────────────────────
  const clampCam = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const cam = camRef.current;
    const vw = cv.width / cam.z;
    const vh = cv.height / cam.z;
    cam.x = vw >= WORLD_W ? (WORLD_W - vw) / 2 : Math.max(0, Math.min(WORLD_W - vw, cam.x));
    cam.y = vh >= WORLD_H ? (WORLD_H - vh) / 2 : Math.max(0, Math.min(WORLD_H - vh, cam.y));
  }, []);
  const fitView = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const cam = camRef.current;
    cam.z = fitRef.current;
    cam.x = (WORLD_W - cv.width / cam.z) / 2;
    cam.y = (WORLD_H - cv.height / cam.z) / 2;
  }, []);
  const zoomAt = useCallback(
    (sx: number, sy: number, factor: number) => {
      const cam = camRef.current;
      const zMax = Math.max(fitRef.current * 5, 7 * dprRef.current);
      const nz = Math.max(fitRef.current, Math.min(zMax, cam.z * factor));
      const wx = cam.x + sx / cam.z;
      const wy = cam.y + sy / cam.z;
      cam.z = nz;
      cam.x = wx - sx / nz;
      cam.y = wy - sy / nz;
      clampCam();
    },
    [clampCam],
  );
  const centerOn = useCallback(
    (slug: TownSlug) => {
      const cv = canvasRef.current;
      const w = worldRef.current;
      if (!cv || !w) return;
      const cam = camRef.current;
      cam.z = Math.max(cam.z, Math.min(3 * dprRef.current, fitRef.current * 2.2));
      cam.x = w.chars[slug].x - cv.width / cam.z / 2;
      cam.y = w.chars[slug].y - cv.height / cam.z / 2;
      clampCam();
    },
    [clampCam],
  );

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let first = true;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      if (!r.width) return;
      const cam = camRef.current;
      const cx = cam.x + cv.width / cam.z / 2;
      const cy = cam.y + cv.height / cam.z / 2;
      dprRef.current = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(r.width * dprRef.current);
      cv.height = Math.round(r.height * dprRef.current);
      fitRef.current = Math.min(cv.width / WORLD_W, cv.height / WORLD_H);
      if (first) {
        first = false;
        fitView();
      } else {
        cam.z = Math.max(cam.z, fitRef.current);
        cam.x = cx - cv.width / cam.z / 2;
        cam.y = cy - cv.height / cam.z / 2;
        clampCam();
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    resize();

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const w = worldRef.current;
      if (w) {
        w.update(dt);
        w.draw(ctx, camRef.current, dprRef.current, selectedRef.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // pan / pinch / wheel
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch: { d: number; z: number } | null = null;
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: camRef.current.z };
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      const cam = camRef.current;
      if (pointers.size === 1) {
        cam.x -= (dx * dprRef.current) / cam.z;
        cam.y -= (dy * dprRef.current) / cam.z;
        clampCam();
        moved += Math.abs(dx) + Math.abs(dy);
      } else if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = cv.getBoundingClientRect();
        zoomAt(
          ((a.x + b.x) / 2 - r.left) * dprRef.current,
          ((a.y + b.y) / 2 - r.top) * dprRef.current,
          (pinch.z * d) / pinch.d / cam.z,
        );
        moved += 10;
      }
    };
    const up = (e: PointerEvent) => {
      const was = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (was && moved < 6 && e.type === "pointerup") {
        const r = cv.getBoundingClientRect();
        const cam = camRef.current;
        const wx = cam.x + ((e.clientX - r.left) * dprRef.current) / cam.z;
        const wy = cam.y + ((e.clientY - r.top) * dprRef.current) / cam.z;
        const hit = worldRef.current?.pick(wx, wy);
        if (hit) setSelected(hit);
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomAt(
        (e.clientX - r.left) * dprRef.current,
        (e.clientY - r.top) * dprRef.current,
        Math.exp(-e.deltaY * 0.0016),
      );
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("wheel", wheel);
    };
  }, [clampCam, fitView, zoomAt]);

  // ── commands ─────────────────────────────────────────────────────────────
  const submit = useCallback(
    (raw: string, to: TownSlug | "auto") => {
      const body = raw.trim();
      if (!body) return;
      const cmd: TownCommand = {
        id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: body,
        target: to,
        createdAt: Date.now(),
        runId: null,
        state: "pending",
      };
      setCommands((cs) => [...cs.slice(-19), cmd]);
      pushLog("user", `Ty: „${body}”${to !== "auto" ? ` → ${nameOf(to)}` : ""}`);
      const w = worldRef.current;
      if (w) {
        void w.actor("user", async () => {
          await w.walkTo("user", [17, 16]);
          w.face("user", "up");
          w.say("user", body, 2400, "pin");
          await w.wait(1200);
          await w.goHome("user");
          w.face("user", "up");
        });
      }
      // A chosen agent is reached through J.A.R.V.I.S., who delegates — the
      // same path as asking him in the chat.
      const message = to === "auto" ? body : `Zleć to agentowi ${nameOf(to)}: ${body}`;
      send(message)
        .catch(() => {
          setCommands((cs) => cs.map((c) => (c.id === cmd.id ? { ...c, state: "error" } : c)));
          worldRef.current?.say("jarvis", "Nie udało się wysłać polecenia", 2600, "cross", "bad");
        })
        .finally(() => {
          window.setTimeout(() => {
            const still = commandsRef.current.find((c) => c.id === cmd.id);
            if (!still || still.runId || still.state !== "pending") return;
            setCommands((cs) => cs.map((c) => (c.id === cmd.id ? { ...c, state: "done" } : c)));
            const w2 = worldRef.current;
            const last = [...messagesRef.current].reverse().find((m) => m.role === "jarvis");
            if (w2) {
              void w2.actor("jarvis", async () => {
                await w2.walkTo("jarvis", VISIT.user);
                w2.face("jarvis", "left");
                w2.say(
                  "jarvis",
                  last?.text?.replace(/\s+/g, " ").trim() || "Gotowe",
                  3000,
                  "check",
                  "ok",
                );
                await w2.wait(1600);
                await w2.goHome("jarvis");
              });
            }
          }, UNMATCHED_COMMAND_MS);
        });
    },
    [nameOf, pushLog, send],
  );
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(text, target);
    setText("");
  };

  // ── inspector data ───────────────────────────────────────────────────────
  const sel = summaries.get(selected);
  const status = worldRef.current?.status[selected] ?? "idle";
  const mine = runs.filter((r) => r.agentSlug === selected);
  const current = mine.find((r) => isActive(r.status)) ?? mine[0];
  const children = current ? runs.filter((r) => r.parentRunId === current.id) : [];
  const history = mine.filter((r) => r !== current).slice(0, 3);
  const notJarvisActive = activeAgent.slug !== AGENT_SLUGS.JARVIS;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4 p-4 @max-[980px]:grid-cols-1 @max-[640px]:p-2">
      <div className="grid min-w-0 gap-4">
        <HudPanel index={0} title="AGENT TOWN // PIĘTRO AGENTÓW" showTag={false}>
          <div className="flex flex-wrap gap-1.5 px-4 pt-3 @max-[420px]:px-2" aria-label="Agenci">
            {TOWN_AGENTS.map((slug) => {
              const st = worldRef.current?.status[slug] ?? "idle";
              return (
                <button
                  key={slug}
                  type="button"
                  aria-pressed={selected === slug}
                  onClick={() => {
                    setSelected(slug);
                    centerOn(slug);
                  }}
                  className={cn(
                    "font-display flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                    selected === slug
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-foreground hover:border-primary",
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 border border-current"
                    style={{ background: AGENT_COLOR[slug] }}
                  />
                  {TAG[slug]}
                  <span
                    className={cn(
                      "h-2 w-2",
                      st === "running"
                        ? "bg-warning"
                        : st === "error"
                          ? "bg-destructive"
                          : st === "done"
                            ? "bg-success"
                            : "bg-muted-foreground/50",
                    )}
                  />
                </button>
              );
            })}
          </div>
          <div className="relative p-3 @max-[420px]:p-2">
            <canvas
              ref={canvasRef}
              aria-label="Mapa biura agentów. Wybierz agenta z listy powyżej, aby zobaczyć szczegóły."
              className="block aspect-[704/512] max-h-[70vh] min-h-[260px] w-full cursor-grab touch-none bg-black active:cursor-grabbing"
              style={{ imageRendering: "pixelated" }}
            />
            <div className="absolute right-5 top-5 grid gap-1.5">
              {[
                {
                  label: "Przybliż",
                  icon: Plus,
                  run: () =>
                    zoomAt(canvasRef.current!.width / 2, canvasRef.current!.height / 2, 1.4),
                },
                {
                  label: "Oddal",
                  icon: Minus,
                  run: () =>
                    zoomAt(canvasRef.current!.width / 2, canvasRef.current!.height / 2, 1 / 1.4),
                },
                { label: "Pokaż całą mapę", icon: Crosshair, run: fitView },
              ].map((b) => (
                <button
                  key={b.label}
                  type="button"
                  aria-label={b.label}
                  title={b.label}
                  onClick={b.run}
                  className="grid h-9 w-9 place-items-center rounded-md border border-border bg-card text-foreground hover:border-primary hover:text-primary"
                >
                  <b.icon className="h-4 w-4" />
                </button>
              ))}
            </div>
            {flowError && (
              <p className="absolute bottom-5 left-5 max-w-[80%] rounded-md border border-destructive bg-card px-2 py-1 text-xs text-destructive">
                Brak połączenia z danymi agentów. Biuro pokazuje ostatni znany stan.
              </p>
            )}
          </div>
        </HudPanel>

        <HudPanel index={1} title="NOWE POLECENIE" tone="quiet">
          <form
            onSubmit={onSubmit}
            className="flex flex-wrap items-center gap-2 p-4 @max-[420px]:p-2"
            autoComplete="off"
          >
            <span className="font-display text-sm text-primary">TY:</span>
            <input
              ref={inputRef}
              id="town-command"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Co mam zlecić? np. „Sprawdź ceny paliw”"
              aria-label="Treść polecenia"
              className="min-w-0 flex-[1_1_240px] rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <select
              id="town-target"
              value={target}
              onChange={(e) => setTarget(e.target.value as TownSlug | "auto")}
              aria-label="Dla kogo"
              className="min-w-0 flex-[0_1_220px] rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="auto">Dla: J.A.R.V.I.S. przydzieli</option>
              {TOWN_AGENTS.filter((s) => s !== "jarvis").map((s) => (
                <option key={s} value={s}>
                  Dla: {nameOf(s)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="font-display rounded-md border border-primary bg-primary px-4 py-2 text-sm text-primary-foreground hover:brightness-110"
            >
              Wyślij
            </button>
          </form>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 @max-[420px]:px-2">
            {QUICK.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => submit(q.text, "auto")}
                className="group flex items-center gap-1 text-sm text-foreground hover:text-primary"
              >
                <span className="text-transparent group-hover:text-primary group-focus-visible:text-primary">
                  ▶
                </span>
                {q.label}
              </button>
            ))}
          </div>
          <p className="px-4 pb-4 text-xs text-muted-foreground @max-[420px]:px-2">
            Twoja postać przypina polecenie na tablicy w Rdzeniu. J.A.R.V.I.S. je bierze, rozdziela
            pracę i przynosi wynik do Twojego terminala. Pełna odpowiedź jest też w czacie.
            {notJarvisActive && (
              <span className="mt-1 block text-warning">
                Aktywny agent czatu to {activeAgent.name}, więc polecenie trafi najpierw do niego.
              </span>
            )}
          </p>
        </HudPanel>
      </div>

      <div className="grid min-w-0 gap-4">
        <HudPanel index={2} title="AGENT" tone="quiet">
          <div className="flex items-center gap-3 p-4 @max-[420px]:p-3">
            <canvas
              ref={portraitRef}
              width={64}
              height={64}
              aria-hidden
              className="h-16 w-16 shrink-0 border-2 border-border bg-background"
              style={{ imageRendering: "pixelated" }}
            />
            <div className="min-w-0">
              <h2 className="font-display truncate text-base">{nameOf(selected)}</h2>
              <p className="text-xs text-muted-foreground">{sel?.role ?? "—"}</p>
              <span
                className={cn(
                  "mt-1 inline-block border px-2 py-0.5 text-[11px] uppercase",
                  STATUS_CLASS[status],
                )}
              >
                {STATUS_LABEL[status]}
              </span>
            </div>
          </div>
          <Section label={current && isActive(current.status) ? "Teraz robi" : "Ostatnie zadanie"}>
            {sel?.currentTask || current ? (
              <>
                <p className="break-words text-sm">
                  „{sel?.currentTask ?? taskOf(current, runs) ?? "zadanie bez opisu"}”
                </p>
                {current && (
                  <p className="text-xs text-muted-foreground">czas: {fmtDur(current)}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Czeka na zadanie.</p>
            )}
          </Section>
          <Section label="Kroki">
            {current?.toolCalls.length ? (
              <ul className="grid gap-1">
                {current.toolCalls.slice(-6).map((t, i, arr) => (
                  <li
                    key={i}
                    className="grid min-w-0 grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 text-sm"
                  >
                    <span
                      className={cn(
                        "h-2.5 w-2.5 border border-border",
                        i === arr.length - 1 && isActive(current.status)
                          ? "animate-blink bg-warning"
                          : "bg-success",
                      )}
                    />
                    <span className="min-w-0 break-words">{t.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {i === arr.length - 1 && isActive(current.status) ? "trwa" : "ok"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Brak kroków.</p>
            )}
          </Section>
          {selected === "jarvis" && (
            <Section label="Delegacje">
              {children.length ? (
                <ul className="grid gap-1">
                  {children.map((k) => (
                    <li
                      key={k.id}
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 text-sm"
                    >
                      <span className="min-w-0 break-words">
                        {(TAG as Record<string, string>)[k.agentSlug] ?? k.agentName}{" "}
                        <span className="text-muted-foreground">{taskOf(k, runs)}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{fmtDur(k)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Brak delegacji.</p>
              )}
            </Section>
          )}
          <Section label="Historia">
            {history.length ? (
              <ul className="grid gap-1">
                {history.map((r) => (
                  <li
                    key={r.id}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 text-sm"
                  >
                    <span
                      className={cn(
                        "min-w-0 break-words",
                        r.status === "error" && "text-destructive",
                      )}
                    >
                      {taskOf(r, runs) ?? (r.status === "error" ? "zadanie z błędem" : "zadanie")}
                    </span>
                    <span className="text-xs text-muted-foreground">{fmtDur(r)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Jeszcze nic dziś.</p>
            )}
          </Section>
          {selected !== "jarvis" && (
            <div className="border-t border-border p-4 @max-[420px]:p-3">
              <button
                type="button"
                onClick={() => {
                  setTarget(selected);
                  inputRef.current?.focus();
                }}
                className="font-display rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:border-primary hover:text-primary"
              >
                Zleć zadanie {TAG[selected]}
              </button>
            </div>
          )}
        </HudPanel>

        <HudPanel index={3} title="DZIENNIK" tone="quiet">
          <ol className="no-scrollbar grid max-h-72 gap-1 overflow-y-auto overflow-x-hidden p-4 @max-[420px]:p-3">
            {log.map((l) => (
              <li key={l.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-2 text-sm">
                <time className="text-xs tabular-nums text-muted-foreground">{l.time}</time>
                <span className="min-w-0 break-words">
                  <span
                    className="mr-1 inline-block h-2 w-2"
                    style={{ background: AGENT_COLOR[l.slug] }}
                  />
                  {l.text}
                </span>
              </li>
            ))}
          </ol>
        </HudPanel>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 border-t border-border px-4 py-3 @max-[420px]:px-3">
      <p className="font-display mb-1.5 text-[11px] uppercase text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** A run's task text: what its parent delegated to it, if anything. */
function taskOf(run: FlowRun | undefined, runs: readonly FlowRun[]): string | null {
  if (!run?.parentRunId) return null;
  const parent = runs.find((r) => r.id === run.parentRunId);
  return parent?.delegations.find((d) => d.toSlug === run.agentSlug)?.task ?? null;
}
