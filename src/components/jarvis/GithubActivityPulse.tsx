import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { HudPanel } from "./HudPanel";

// Tracks a single repo for now — this HUD is a "construction log" for the
// platform itself. If multiple repos are ever worth watching, swap this for
// a small list and merge/sort the fetched events by created_at.
const REPO = "pol197kuba-collab/J.A.R.V.I.S.";

type PulseItem = { id: string; time: string; text: string };

const STORAGE_KEY = "jarvis_gh_pulse";
const STORAGE_TS_KEY = "jarvis_gh_pulse_ts";
const MIN_REFRESH_MS = 2 * 60 * 1000;
let inFlight: Promise<void> | null = null;

// GitHub's public Events API — same shape documented at
// https://docs.github.com/en/rest/activity/events — no auth needed for a
// public repo, but unauthenticated requests are capped at 60/hr per IP, so
// this polls slowly and caches through reloads.
type GithubEvent = {
  id: string;
  type: string;
  actor?: { login?: string };
  created_at: string;
  payload?: {
    action?: string;
    ref?: string;
    ref_type?: string;
    commits?: Array<{ message?: string }>;
    pull_request?: { number?: number; title?: string };
    issue?: { number?: number; title?: string };
    release?: { tag_name?: string };
    forkee?: { full_name?: string };
  };
};

function describe(e: GithubEvent): string | null {
  const who = e.actor?.login ?? "someone";
  const p = e.payload ?? {};
  switch (e.type) {
    case "PushEvent": {
      const n = p.commits?.length ?? 0;
      const msg = p.commits?.[n - 1]?.message?.split("\n")[0] ?? "";
      const branch = p.ref?.replace("refs/heads/", "") ?? "?";
      return `PUSH · ${n} COMMIT${n === 1 ? "" : "S"} → ${branch.toUpperCase()}${msg ? ` · ${msg.toUpperCase()}` : ""}`;
    }
    case "PullRequestEvent":
      return `PR #${p.pull_request?.number ?? "?"} ${(p.action ?? "").toUpperCase()} · ${(p.pull_request?.title ?? "").toUpperCase()}`;
    case "IssuesEvent":
      return `ISSUE #${p.issue?.number ?? "?"} ${(p.action ?? "").toUpperCase()} · ${(p.issue?.title ?? "").toUpperCase()}`;
    case "IssueCommentEvent":
      return `COMMENT ON #${p.issue?.number ?? "?"} BY ${who.toUpperCase()}`;
    case "CreateEvent":
      return `CREATED ${(p.ref_type ?? "REF").toUpperCase()} ${(p.ref ?? "").toUpperCase()}`;
    case "DeleteEvent":
      return `DELETED ${(p.ref_type ?? "REF").toUpperCase()} ${(p.ref ?? "").toUpperCase()}`;
    case "ReleaseEvent":
      return `RELEASE ${(p.action ?? "").toUpperCase()} · ${p.release?.tag_name ?? "?"}`;
    case "ForkEvent":
      return `FORKED → ${(p.forkee?.full_name ?? "?").toUpperCase()}`;
    case "WatchEvent":
      return `★ STARRED BY ${who.toUpperCase()}`;
    default:
      return null; // skip noisy/uninteresting event types
  }
}

const FALLBACK: string[] = ["CONSTRUCTION LOG OFFLINE // AWAITING UPLINK TO GITHUB."];

export function GithubActivityPulse({ index = 0 }: { index?: number }) {
  const [items, setItems] = useState<PulseItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = window.localStorage.getItem(STORAGE_KEY);
      if (cached) return JSON.parse(cached) as PulseItem[];
    } catch {
      /* ignore */
    }
    return [];
  });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (inFlight) return inFlight;
    setLoading(true);
    inFlight = (async () => {
      try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/events?per_page=15`, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) throw new Error(`github_http_${res.status}`);
        const raw = (await res.json()) as GithubEvent[];
        const dispatches: PulseItem[] = raw
          .map((e) => {
            const text = describe(e);
            if (!text) return null;
            return {
              id: e.id,
              time: new Date(e.created_at).toLocaleTimeString([], { hour12: false }),
              text,
            };
          })
          .filter((d): d is PulseItem => d !== null)
          .slice(0, 8);
        setItems((prev) => (dispatches.length ? dispatches : prev));
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dispatches));
          window.localStorage.setItem(STORAGE_TS_KEY, String(Date.now()));
        } catch {
          /* ignore */
        }
      } catch {
        // Keep whatever's cached/rendered; this is decorative telemetry, not
        // something worth surfacing an error state for.
      } finally {
        setLoading(false);
      }
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }, []);

  useEffect(() => {
    const ts = Number(
      (typeof window !== "undefined" && window.localStorage.getItem(STORAGE_TS_KEY)) || 0,
    );
    const stale = Date.now() - ts > MIN_REFRESH_MS;
    if (stale) void refresh();
    const id = setInterval(() => void refresh(), MIN_REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const rows = items.length
    ? items
    : FALLBACK.map((t, i) => ({ id: `fb-${i}`, time: "--:--:--", text: t }));

  return (
    <HudPanel
      index={index}
      tone="quiet"
      title="CONSTRUCTION LOG // GITHUB PULSE"
      rightSlot={
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="flex items-center gap-1.5 border border-primary/40 bg-primary/5 px-2 py-1 font-display text-[9px] uppercase tracking-[0.25em] text-primary transition hover:bg-primary/15 disabled:opacity-50"
          aria-label="Refresh GitHub activity"
        >
          <RefreshCw className={"h-3 w-3 " + (loading ? "animate-spin" : "")} strokeWidth={1.5} />
          <span>{loading ? "SYNC" : "REFRESH"}</span>
        </button>
      }
      className="flex flex-col"
    >
      <div className="p-3 landscape:max-md:p-2">
        <ul className="space-y-2">
          {rows.map((it, i) => (
            <li
              key={it.id}
              className="flex min-w-0 gap-3 border-l-2 border-primary/50 pl-2 font-mono text-[11px] uppercase leading-snug text-foreground/85 landscape:max-md:text-[9px]"
              style={{ animation: `fade-up 0.45s ease-out ${i * 80}ms both` }}
            >
              <span className="shrink-0 text-primary/80">[{it.time}]</span>
              <span className="min-w-0 flex-1 whitespace-normal break-words">{it.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </HudPanel>
  );
}
