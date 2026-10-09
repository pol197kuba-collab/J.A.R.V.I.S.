import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Crosshair, Footprints, MessageCircle, Minus, Plus } from "lucide-react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import {
  getAgentFlow,
  getRunDetail,
  type FlowRun,
  type RunFile,
} from "@/lib/agents/flow.functions";
import { getBudgetReport } from "@/lib/agents/budget.functions";
import { getGeneratedFileUrlFn } from "@/lib/documents/generated.functions";
import { listDocumentsFn } from "@/lib/documents/documents.functions";
import {
  listNotifications,
  markNotificationRead,
} from "@/lib/notifications/notifications.functions";
import { notifyTownResult } from "@/lib/notifications/townResult.functions";
import type { AgentSummary } from "@/lib/agents/runtime.functions";
import { useAgentChatChannel } from "@/lib/ai/useAgentChatChannel";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import { cn } from "@/lib/utils";
import { TOWN_AGENTS, TS, VISIT, WORLD_H, WORLD_W, type TownSlug } from "./townMap";
import { AGENT_COLOR } from "./townArt";
import { TAG, TownWorld, type Camera, type CharStatus } from "./townWorld";
import { TownDirector, characterStatus, isActive, type TownCommand } from "./townDirector";
import { CompanionPanel } from "./CompanionPanel";
import { applyAction, loadDogName, loadMood, saveMood, settle } from "./dogMood";
import { TownDialog, type BoardNote, type DialogTarget, type NoteDetail } from "./TownDialog";
import {
  explainError,
  failedRunOf,
  nightLevel,
  providerTrouble,
  retryPlan,
  visitReport,
} from "./townInsights";
import { lastResultLine, statusLine, taskOf } from "./townTalk";
import { propById } from "./townProps";
import { propContent } from "./townPropActions";

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

type Reach = DialogTarget | { kind: "letter" } | null;

const LAST_VISIT_KEY = "jarvis.town.lastVisit";
const SEEN_FAULTS_KEY = "jarvis.town.seenFaults";
const readLocal = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLocal = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* private mode — fine */
  }
};
const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export function TownView() {
  const { send, agents, messages, activeAgent } = useAgentChatChannel();
  const fetchFlow = useServerFn(getAgentFlow);
  const { data: flow, error: flowError } = useQuery({
    queryKey: ["agents", "flow"],
    queryFn: () => fetchFlow(),
    refetchInterval: 3000,
  });
  const runs = useMemo(() => flow?.runs ?? [], [flow]);
  const navigate = useNavigate();

  const [selected, setSelected] = useState<TownSlug>("jarvis");
  const [commands, setCommands] = useState<TownCommand[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<TownSlug | "auto">("auto");
  const [, setTick] = useState(0);
  const [dogName, setDogName] = useState(() => loadDogName());
  const [mood, setMood] = useState(() => loadMood(Date.now()));
  const [dogReady, setDogReady] = useState(false);
  const [walkMode, setWalkMode] = useState(false);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [dialogTop, setDialogTop] = useState(false);
  // ── the Vault, faults, results, the visit report ─────────────────────────
  const fetchBudget = useServerFn(getBudgetReport);
  const { data: budget, isLoading: budgetLoading } = useQuery({
    queryKey: ["budget", "report"],
    queryFn: () => fetchBudget(),
    refetchInterval: 5 * 60_000,
  });
  const trouble = useMemo(() => providerTrouble(runs, Date.now()), [runs]);
  const fetchNotifications = useServerFn(listNotifications);
  const { data: notifications, isFetched: notificationsFetched } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => fetchNotifications({ data: { limit: 30 } }),
    refetchInterval: 60_000,
  });

  // failed tasks you've already looked at ("Co się stało?") stop smoking
  const [seenFaults, setSeenFaults] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(readLocal(SEEN_FAULTS_KEY) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const markFaultSeen = useCallback((runId: string) => {
    setSeenFaults((prev) => {
      if (prev.has(runId)) return prev;
      const next = new Set([...prev, runId].slice(-100));
      writeLocal(SEEN_FAULTS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  // a result's full answer + files, fetched when its note is opened
  const fetchRunDetail = useServerFn(getRunDetail);
  const fetchFileUrl = useServerFn(getGeneratedFileUrlFn);
  const [details, setDetails] = useState<Record<string, NoteDetail>>({});
  const openNote = useCallback(
    (id: string) => {
      if (!isUuid(id)) return;
      setDetails((d) => (d[id] ? d : { ...d, [id]: { text: null, files: [], loading: true } }));
      fetchRunDetail({ data: { runId: id } })
        .then((r) =>
          setDetails((d) => ({ ...d, [id]: { text: r.text, files: r.files, loading: false } })),
        )
        .catch(() =>
          setDetails((d) => ({ ...d, [id]: { text: null, files: [], loading: false } })),
        );
    },
    [fetchRunDetail],
  );
  const download = useCallback(
    (f: RunFile) => {
      fetchFileUrl({ data: { fileId: f.id, kind: "download" } })
        .then((r) => {
          if (r.ok) window.location.assign(r.url);
          else pushLogRef.current("jarvis", `Nie udało się pobrać: ${f.filename}`);
        })
        .catch(() => pushLogRef.current("jarvis", `Nie udało się pobrać: ${f.filename}`));
    },
    [fetchFileUrl],
  );

  const fetchDocuments = useServerFn(listDocumentsFn);
  // Only the document shelf needs these — fetch when a prop dialog opens.
  const {
    data: documents,
    isLoading: documentsLoading,
    isError: documentsError,
  } = useQuery({
    queryKey: ["documents"],
    queryFn: () => fetchDocuments(),
    enabled: dialog?.kind === "prop" && propById(dialog.id)?.kind === "shelf",
  });
  const [notes, setNotes] = useState<BoardNote[]>([]);
  const [nearby, setNearby] = useState<Reach>(null);
  const walkRef = useRef(walkMode);
  walkRef.current = walkMode;
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const heldKeys = useRef(new Set<string>());
  const dogNameRef = useRef(dogName);
  dogNameRef.current = dogName;

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
  const notesRef = useRef(notes);
  notesRef.current = notes;
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
  const pushLogRef = useRef(pushLog);
  pushLogRef.current = pushLog;

  // The bell mirrors the board: a new result lights it, reading the note on
  // the board marks it read there too.
  const qc = useQueryClient();
  const notifyBell = useServerFn(notifyTownResult);
  const markBellRead = useServerFn(markNotificationRead);
  const bellIds = useRef(new Map<string, string>());

  /** Pin a finished request's answer on the board as a note to read. */
  const addNote = useCallback(
    (id: string, ok: boolean, text: string, opts?: { title?: string; quiet?: boolean }) => {
      const cmd = commandsRef.current.find((c) => c.runId === id || c.id === id);
      const title = (opts?.title ?? cmd?.text ?? `Wynik z ${clock()}`).slice(0, 48);
      setNotes((ns) =>
        [
          { id, title, text, ok, at: Date.now(), read: false },
          ...ns.filter((n) => n.id !== id),
        ].slice(0, 12),
      );
      if (opts?.quiet) return;
      // Marvel fetches it from the board and brings it to you
      worldRef.current?.dog.deliver();
      notifyBell({ data: { runId: id, title, text, ok } })
        .then((r) => {
          if (r.id) bellIds.current.set(id, r.id);
          void qc.invalidateQueries({ queryKey: ["notifications", "list"] });
        })
        .catch(() => {
          /* the note on the board is what counts; the bell is a bonus */
        });
    },
    [notifyBell, qc],
  );
  const readNote = useCallback(
    (id: string) => {
      setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, read: true } : n)));
      const bellId = bellIds.current.get(id);
      if (!bellId) return;
      bellIds.current.delete(id);
      markBellRead({ data: { id: bellId } })
        .then(() => qc.invalidateQueries({ queryKey: ["notifications", "list"] }))
        .catch(() => {});
    },
    [markBellRead, qc],
  );
  const addNoteRef = useRef(addNote);
  addNoteRef.current = addNote;

  // ── world + director, created once on the client ─────────────────────────
  useEffect(() => {
    const world = new TownWorld();
    world.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    worldRef.current = world;
    world.dog.name = dogNameRef.current;
    world.dog.onAction = (action, line) => {
      setMood((m) => {
        const next = applyAction(m, action, Date.now());
        saveMood(next);
        return next;
      });
      pushLog("user", line);
    };
    setDogReady(true);
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
      resultReady: (runId, ok, text) => addNoteRef.current(runId, ok, text),
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

  useEffect(() => {
    if (worldRef.current) worldRef.current.dog.name = dogName;
  }, [dogName]);

  // real data → events
  useEffect(() => {
    if (flow) directorRef.current?.ingest(flow);
  }, [flow]);

  // "Since you were last here": once per visit, when the data is in,
  // J.A.R.V.I.S. comes to your terminal with a short report (pinned on the
  // board too). Only after a real break (30+ min) — not on every reload.
  const lastVisit = useRef<number | null>(null);
  const reported = useRef(false);
  useEffect(() => {
    lastVisit.current = Number(readLocal(LAST_VISIT_KEY)) || null;
    const stamp = () => writeLocal(LAST_VISIT_KEY, String(Date.now()));
    const id = window.setInterval(stamp, 60_000);
    window.addEventListener("pagehide", stamp);
    return () => {
      stamp();
      window.clearInterval(id);
      window.removeEventListener("pagehide", stamp);
    };
  }, []);
  useEffect(() => {
    if (reported.current || !flow || !notificationsFetched) return;
    reported.current = true;
    const since = lastVisit.current;
    writeLocal(LAST_VISIT_KEY, String(Date.now()));
    if (!since || Date.now() - since < 30 * 60_000) return;
    const lines = visitReport(flow.runs, notifications ?? [], since, nameOf);
    const w = worldRef.current;
    if (!lines) {
      w?.say("jarvis", "Witaj z powrotem. Bez nowości.", 2600, "check", "ok");
      return;
    }
    addNote(`report-${Date.now()}`, true, ["Od Twojej ostatniej wizyty:", ...lines].join("\n"), {
      title: "Raport od ostatniej wizyty",
      quiet: true,
    });
    pushLog("jarvis", `Raport: ${lines[0]}`);
    if (!w) return;
    void w.actor("jarvis", async () => {
      await w.walkTo("jarvis", VISIT.user);
      w.face("jarvis", "left");
      w.say("jarvis", "Witaj z powrotem! " + lines[0], 3200, "pin");
      await w.wait(3400);
      w.say("jarvis", "Całość przypiąłem na tablicy.", 2200, "pin");
      await w.wait(2200);
      await w.goHome("jarvis");
    });
  }, [flow, notificationsFetched, notifications, nameOf, addNote, pushLog]);

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
      w.boardAlert = notesRef.current.filter((n) => !n.read).length;
      w.faults = new Set(
        TOWN_AGENTS.filter((slug) => {
          const f = failedRunOf(slug, runs);
          return !!f && !seenFaults.has(f.id) && now - Date.parse(f.createdAt) < 24 * 3600_000;
        }),
      );
      w.vaultAlarm = !!trouble || budget?.level === "over";
      const forced = import.meta.env.DEV
        ? (window as unknown as { __townNight?: number }).__townNight
        : undefined;
      w.night = forced ?? nightLevel(new Date());
      w.dog.night = w.night >= 0.6;
      setTick((t) => (t + 1) % 1e6);
    };
    sync();
    const id = window.setInterval(sync, 1000);
    return () => window.clearInterval(id);
  }, [runs, summaries, commands, notes, seenFaults, trouble, budget]);

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
      // Pan only — the zoom level is the user's choice, never changed for them.
      const cam = camRef.current;
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
        if (w.walkMode && !dialogRef.current) {
          const k = heldKeys.current;
          const dx = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
          const dy = (k.has("down") ? 1 : 0) - (k.has("up") ? 1 : 0);
          if (dx || dy) w.userStep(dx, dx ? 0 : dy);
        }
        w.update(dt);
        if (w.walkMode) {
          // the camera glides after your character
          const cam = camRef.current;
          const u = w.chars.user;
          const tx = u.x - cv.width / cam.z / 2;
          const ty = u.y - cv.height / cam.z / 2;
          cam.x += (tx - cam.x) * Math.min(1, dt / 120);
          cam.y += (ty - cam.y) * Math.min(1, dt / 120);
          clampCam();
        }
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
        const dog = worldRef.current?.dog;
        if (dog?.hit(wx, wy)) {
          if (dog.letter) openDialogRef.current({ kind: "letter" });
          else void dog.interact("pet");
          return;
        }
        const w = worldRef.current;
        if (w?.walkMode && !dialogRef.current) {
          tapWalkRef.current(wx, wy);
          return;
        }
        const hit = w?.pick(wx, wy);
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

  // ── walk mode ────────────────────────────────────────────────────────────
  const openDialog = useCallback((reach: Exclude<Reach, null>) => {
    const w = worldRef.current;
    if (!w) return;
    let t: DialogTarget;
    if (reach.kind === "letter") {
      // take the note from Marvel and read it right away
      w.dog.takeLetter();
      const ns = notesRef.current;
      const note = ns.find((n) => !n.read) ?? ns[0];
      t = { kind: "board", noteId: note?.id };
    } else t = reach;
    if (t.kind === "agent") {
      w.talkingTo = t.slug;
      w.faceUser(t.slug);
      setSelected(t.slug);
    } else if (t.kind === "prop") {
      const prop = propById(t.id);
      const me = w.chars.user;
      if (prop) {
        const dx = prop.anchor[0] * TS - me.x;
        const dy = prop.anchor[1] * TS - me.y;
        w.face(
          "user",
          Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up",
        );
      }
    } else w.face("user", "up");
    // Keep yourself visible: the box goes to the half of the map you're not in.
    setDialogTop(w.chars.user.y > WORLD_H / 2);
    setDialog(t);
  }, []);
  const closeDialog = useCallback(() => {
    if (worldRef.current) worldRef.current.talkingTo = null;
    setDialog(null);
    canvasRef.current?.focus();
  }, []);

  /** Tap/click while walking: talk to whoever you tapped, read the board, or walk there. */
  const tapWalk = useCallback(
    (wx: number, wy: number) => {
      const w = worldRef.current;
      if (!w) return;
      const who = (Object.values(w.chars) as { slug: TownSlug; x: number; y: number }[]).find(
        (c) => c.slug !== "user" && Math.hypot(c.x - wx, c.y - 6 - wy) < 12,
      );
      if (who) {
        const slug = who.slug;
        void w.userWalkTo(w.besideAgent(slug)).then(() => {
          const r = w.reachable();
          if (r?.kind === "agent" && r.slug === slug) openDialog({ kind: "agent", slug });
        });
        return;
      }
      if (w.isBoard(wx, wy)) {
        void w.userWalkTo(w.nearestBoardSpot()).then(() => {
          if (w.reachable()?.kind === "board") openDialog({ kind: "board" });
        });
        return;
      }
      const tx = Math.floor(wx / 16);
      const ty = Math.floor(wy / 16);
      if (w.map.blocked[ty]?.[tx] === false) void w.userWalkTo([tx, ty]);
    },
    [openDialog],
  );
  const tapWalkRef = useRef(tapWalk);
  tapWalkRef.current = tapWalk;
  const openDialogRef = useRef(openDialog);
  openDialogRef.current = openDialog;

  const toggleWalk = useCallback(() => {
    const w = worldRef.current;
    const cv = canvasRef.current;
    if (!w || !cv) return;
    const on = !w.walkMode;
    w.walkMode = on;
    setWalkMode(on);
    if (on) {
      // No auto-zoom: the whole floor stays in view; zooming in is optional
      // (+ / wheel / pinch), and the camera only follows you once you have.
      pushLog("user", "Wychodzisz na spacer po biurze.");
      cv.focus();
    } else {
      closeDialog();
      heldKeys.current.clear();
      void w.goHome("user").then(() => w.face("user", "up"));
    }
  }, [closeDialog, pushLog]);

  // what's within reach, for the touch-friendly "talk" button
  useEffect(() => {
    if (!walkMode) {
      setNearby(null);
      return;
    }
    const id = window.setInterval(() => {
      const r = worldRef.current?.reachable() ?? null;
      setNearby((prev) =>
        prev?.kind === r?.kind &&
        (prev?.kind !== "agent" || (r?.kind === "agent" && prev.slug === r.slug))
          ? prev
          : r,
      );
    }, 200);
    return () => window.clearInterval(id);
  }, [walkMode]);

  // keyboard: arrows / WASD walk, E / Enter / Space talk
  useEffect(() => {
    if (!walkMode) return;
    const KEYS: Record<string, string> = {
      ArrowUp: "up",
      w: "up",
      W: "up",
      ArrowDown: "down",
      s: "down",
      S: "down",
      ArrowLeft: "left",
      a: "left",
      A: "left",
      ArrowRight: "right",
      d: "right",
      D: "right",
    };
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || dialogRef.current || e.ctrlKey || e.metaKey || e.altKey) return;
      const dir = KEYS[e.key];
      if (dir) {
        e.preventDefault();
        heldKeys.current.add(dir);
        return;
      }
      if (e.key === "e" || e.key === "E" || e.key === "Enter" || e.key === " ") {
        const r = worldRef.current?.reachable();
        if (r) {
          e.preventDefault();
          openDialog(r);
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      const dir = KEYS[e.key];
      if (dir) heldKeys.current.delete(dir);
    };
    const blur = () => heldKeys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [walkMode, openDialog]);

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
          if (w.walkMode) return; // you're out walking — stay where you are
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
            addNoteRef.current(
              cmd.id,
              true,
              last?.text?.replace(/\s+/g, " ").trim() || "Gotowe — odpowiedź jest w czacie.",
            );
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
              tabIndex={0}
              aria-label="Mapa biura agentów. Wybierz agenta z listy powyżej, aby zobaczyć szczegóły."
              className="block aspect-[704/512] max-h-[70vh] min-h-[260px] w-full cursor-grab touch-none bg-black active:cursor-grabbing"
              style={{ imageRendering: "pixelated" }}
            />
            <div className="absolute right-5 top-5 grid gap-1.5">
              <button
                type="button"
                aria-pressed={walkMode}
                aria-label={walkMode ? "Zakończ spacer" : "Spacer: chodź swoją postacią"}
                title={walkMode ? "Zakończ spacer" : "Spacer: chodź swoją postacią"}
                onClick={toggleWalk}
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-md border",
                  walkMode
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:border-primary hover:text-primary",
                )}
              >
                <Footprints className="h-4 w-4" />
              </button>
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
            {walkMode && nearby && !dialog && (
              <button
                type="button"
                onClick={() => openDialog(nearby)}
                className="font-display absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-md border-2 border-foreground/80 bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-[3px_3px_0_rgba(0,0,0,0.6)]"
              >
                <MessageCircle className="h-4 w-4" />
                {nearby.kind === "letter"
                  ? "Weź kartkę od psa"
                  : nearby.kind === "board"
                    ? "Otwórz tablicę"
                    : nearby.kind === "prop"
                      ? (propById(nearby.id)?.prompt ?? "Użyj")
                      : `Porozmawiaj: ${TAG[nearby.slug]}`}
              </button>
            )}
            {dialog && (
              <TownDialog
                target={dialog}
                placement={dialogTop ? "top" : "bottom"}
                name={nameOf}
                drawPortrait={(cv, who) => worldRef.current?.drawPortrait(cv, who)}
                statusText={(slug) =>
                  statusLine(
                    slug,
                    runs,
                    summaries.get(slug)?.currentTask ?? null,
                    summaries.get(slug)?.isEnabled,
                    Date.now(),
                  )
                }
                resultText={(slug) => {
                  const last = [...messages].reverse().find((m) => m.role === "jarvis");
                  return lastResultLine(slug, runs, last?.text?.trim() || null, Date.now());
                }}
                notes={notes}
                onRead={readNote}
                faultText={(slug) => {
                  const f = failedRunOf(slug, runs);
                  if (!f) return null;
                  return explainError(f.error);
                }}
                onRetry={(slug) => {
                  const f = failedRunOf(slug, runs);
                  const plan = f ? retryPlan(f, runs) : null;
                  if (!f || !plan) return null;
                  return () => {
                    markFaultSeen(f.id);
                    submit(plan.text, plan.to);
                  };
                }}
                onFaultSeen={(slug) => {
                  const f = failedRunOf(slug, runs);
                  if (f) markFaultSeen(f.id);
                }}
                noteDetail={(id) => details[id] ?? { text: null, files: [], loading: false }}
                onOpenNote={openNote}
                onDownload={download}
                onCommand={(t, to) => submit(t, to)}
                onClose={closeDialog}
                propContent={(id) =>
                  propContent(id, {
                    world: worldRef.current!,
                    dogName,
                    runs,
                    name: nameOf,
                    documents,
                    documentsLoading,
                    documentsError,
                    budget,
                    budgetLoading,
                    trouble,
                    navigate: (to) => void navigate({ to }),
                    log: pushLog,
                  })
                }
                onArcadeScore={(score) =>
                  score > 0 && pushLog("user", `Automat „Złap buga”: złapane bugi — ${score}.`)
                }
              />
            )}
          </div>
          <p className="px-4 pb-3 text-xs text-muted-foreground @max-[420px]:px-2">
            {walkMode
              ? "Spacer: WASD lub strzałki (albo dotknij mapy), E — rozmowa z agentem, tablica albo przedmiot (kawa, regał, automat do gier…). Wyniki poleceń czekają na tablicy w Rdzeniu."
              : "Włącz spacer (ikona stóp), żeby chodzić swoją postacią i rozmawiać z agentami."}
          </p>
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

        <CompanionPanel
          index={3}
          dog={dogReady ? (worldRef.current?.dog ?? null) : null}
          name={dogName}
          onRename={setDogName}
          mood={settle(mood, Date.now())}
        />

        <HudPanel index={4} title="DZIENNIK" tone="quiet">
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
