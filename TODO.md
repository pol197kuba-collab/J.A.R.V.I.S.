# TODO — Near Term

> Working queue, refreshed 2026-07-16 (post-decision pass). Ordered — work
> top to bottom unless noted. Check items off as they ship; keep this in
> sync instead of letting `CODEX.md`'s roadmap section and this file drift
> apart. Tags: **[F]** Fundament (backend/agent, durable, mostly invisible)
> · **[W]** Wow (visible, demo-able gadget) · **[UI]** frontend/dashboard.
>
> Cadence: don't ship two [F]s or two [W]s back to back — alternate, so we
> keep building the "operating system" half while still shipping things
> worth showing off (Vision Scanner is the bar for [W]).

## 1. [UI] Dashboard redesign — holo-panels with depth — **shipped 2026-07-16, confirmed working**

Root cause (confirmed against the screenshot + `src/routes/index.tsx:25`,
which wrapped every section in one `space-y-6` stack of uniform `HudPanel`s):
the last Lovable pass (`.lovable/plan.md`) only softened `.hud-panel`'s
edges (radius, glow, backdrop-blur) while explicitly keeping every panel's
box composition identical ("Zero moved/renamed/removed features"). Rounding
corners on the same uniform boxes was never going to read as "depth."

Implemented: `HudPanel` now takes a `tone` prop (`"elevated" | "quiet"`).
- **Elevated** (hero "COMMAND // OVERVIEW", "CONVERSATION STREAM") keeps
  full glass/glow lift, and its corner brackets now sit *outside* the
  rounded edge (`-5px`, was `4px` inset) instead of drawn inside — reads as
  floating instrumentation, not a frame on the border.
- **Quiet** (telemetry strip, notes, tasks, agent ops, weather, github)
  dropped corner brackets entirely, thinner border/background, no
  backdrop-blur lift — recessed into the HUD surface instead of reading as
  an equal-weight floating window.
- `src/styles.css`: `.hud-panel` now shared structure only;
  `.hud-panel--elevated` / `.hud-panel--quiet` carry the actual visual
  weight difference.

Verified: `tsc --noEmit` clean on all touched files (pre-existing unrelated
errors elsewhere untouched). **Could not get a live browser screenshot in
this environment** — `vite.config.ts` depends on private `@lovable.dev/*`
build packages only resolvable inside the Lovable-connected environment,
and no real Supabase credentials were available to get past the login
phase either way. Merged as #10 — verified against a real screenshot after
deploy.

### Follow-up (2026-07-16, same day): hero panel composition fix

Screenshot after #10 confirmed the panel-chrome tone split (elevated/quiet)
was too subtle to register as real depth, and specifically called out
"COMMAND // OVERVIEW" as still weak — large dead vertical space with the
reactor-ring graphic reading as orphaned/disconnected rather than part of
the design. Root cause: the ring graphic (`src/routes/index.tsx`) was
`position: absolute`, `top-1/2 -translate-y-1/2` inside a `relative`
container with only one other content row (`items-end`) — floating
decoration centered in empty space rather than laid out content.

Fix: moved the ring graphic into the actual flex row as a normal sibling
of the text block (`items-center justify-between gap-8`, `shrink-0`,
h-28 w-28, no more `position: absolute`/`top-1/2`). The row's height is now
driven by its real content instead of an empty relative container with a
decoration floating inside it. Still no live screenshot available in this
sandbox (same private-package/credentials blocker as above) — **needs a
fresh screenshot after this ships** to confirm the dead space is actually
gone; if it isn't, the cause is something outside `routes/index.tsx` /
`HudPanel`/`styles.css` and needs live DOM inspection, not another
guess-and-patch round.

## 2. [F] Strażnik logów (Guardian agent) — **shipped 2026-07-16**

Reordered ahead of Analityk on purpose: reuses data already logged
(`event_log`, `agent_runs`) instead of needing a new pipeline.

While scoping it, found the `parent_run_id` fix listed here was **already
shipped 2026-07-13** (commit `c40347a`) — this file and `CODEX.md` had both
gone stale claiming it as an open gap for three days past that fix.
Corrected in `CODEX.md`'s Agent registry section.

**Scope decision** (discussed at length before building): Guardian covers
backend/data-layer monitoring + active smoke-tests only —
`guardian_scan_errors` (recent errors/warnings across `event_log` +
`agent_runs`), `guardian_run_stats` (per-agent trend/regression detection:
error rate, avg latency over a time window), `guardian_check_delegation`
(smoke-tests that the `parent_run_id` fix above stays fixed, instead of
that regressing silently again). **Explicitly does not cover UI/voice
testing** — no agent in this architecture can drive a browser or listen to
audio (agents run server-side in an Edge Function with no browser
runtime); that stays a manual Claude Code verification pass per frontend
change, same as the dashboard redesign above. Decided 2026-07-16, not
re-litigating this — no "automated UI tests" item tracked here on purpose.

Shipped: migration `20260716150000_guardian_agent.sql` (new `guardian`
agent seeded for every existing + future user, matching the "seed via
migration, not the UI" lesson from how `marketer` was created), 3 new
tools in `tools.server.ts`.

Follow-up fix (same day): `guardian_scan_errors` queried `event_log`,
which nothing in the live runtime has ever written to — the real
telemetry stream is `system_events` (different table, different column
names: `owner_id` not `user_id`, `meta` not `metadata`). `event_log` is
dead schema left over from the initial migration. Fixed to query
`system_events`; caught while building item 3 below, which needed to know
exactly where run/tool telemetry actually lives.

## 3. [W] Agent Flow Tree — **shipped 2026-07-16, superseding Situation Room**

User feedback after using Strażnik: no way to *see* delegation happening —
which agent got a request, whether it called a tool, when it handed back
to the Orchestrator. Requested a live "inverted family tree" — Orchestrator
at the top, branching down to whichever agent it delegates to, tool calls
shown per node — that grows on its own as new agents get added, replacing
the old `SystemStatsStrip` (FPS/CPU/MEM/NET) telemetry widget, which
added no real information.

This directly fills the "next wow gadget" slot — better fit than Situation
Room (real product mechanics, not a mashup of unrelated data), so Situation
Room / Radar Sweep is bumped to the open second-gadget slot (item 7) rather
than built now.

Turned out to need **zero new backend work**: `agent_runs.parent_run_id`
already links delegated runs to their parent (fixed 2026-07-13, confirmed
working via Strażnik's own smoke-test), and `agent_runs.output.tool_calls`
already records every tool (including `delegate_to_agent`) a run invoked.
The whole tree builds from one existing table.

Shipped:
- `src/lib/agents/flow.functions.ts` — `getAgentFlow`, reads recent
  `agent_runs` + `agents`, returns a flat list the client groups into a
  tree (topmost ancestor of the most recent run = "current interaction").
- `src/components/jarvis/AgentFlowTree.tsx` — replaces
  `SystemStatsStrip` in `routes/index.tsx` (index 1, same `tone="quiet"`
  slot). Minimalist glass tiles, pulsing glow while a run is `running`,
  settled green/red on done/error, a small dot travelling down the
  connector while a delegation is in flight, tool-call chips per node.
  New keyframes in `styles.css`: `flow-node-in`, `flow-dot-travel`.
- `SystemStatsStrip.tsx` left in place (unused for now) rather than
  deleted, in case it's wanted elsewhere later.

Verified structurally (tree-building + visual render, including the
pulsing/travelling-dot states) via a temporary local-only dev server in
this sandbox with synthetic data — the usual blocker applies to the *real*
data path: no live Supabase session here to confirm `getAgentFlow` against
actual `agent_runs`. Confirm live: ask the Orchestrator to delegate to
Strażnik (as already tested) and watch this widget while it happens.

### Follow-up (2026-07-17): full roster + two live-testing bugs

Live-tested after merge — worked, but three things came back from real
usage:

1. **"CLASSIFIER NO FUNCTION CALL" chip.** `runOrchestrator`'s internal
   fallback UI-action classifier (a second Gemini call on every turn that
   doesn't already call `perform_ui_action`) logs its own outcome into the
   same `tool_calls` array as real tool invocations. The tree rendered
   that as if it were a tool the agent chose to use. Fixed: filter
   anything starting with `classifier_` in `flow.functions.ts`.
   `perform_ui_action` itself stays visible when the classifier fallback
   genuinely triggers a real action.
2. **Strażnik briefly disappearing mid-delegation.** The tree recomputed
   "latest interaction" from scratch on every 3s poll; a child run's own
   `createdAt` briefly reading as the max in the fetched set (independent
   of whether it's really a new interaction) could flip which subtree got
   shown. Fixed: pin the chosen root run (`useRef`) across polls, only
   adopting a new one when a genuinely newer top-level run appears.
3. **"Widzę tylko Strażnika, nie widzę Marketera."** Original design only
   rendered agents that actually appeared in the current interaction's
   run tree — Marketer never showed because it wasn't delegated to.
   Explicit decision: **always show the full enabled-agent roster as a
   persistent structure** (Orchestrator + every teammate, always
   present), with only the agents actually involved in the current/most
   recent interaction highlighted (glow, status color, tool chips) —
   everyone else renders dimmed/"standby". `getAgentFlow` now returns
   `{ agents, runs }` instead of just a run list.

Re-verified structurally in this sandbox (same synthetic-data approach —
the RPC mechanism itself doesn't execute against a real backend here
regardless of auth, a sandbox limitation, not code-specific) after these
three fixes: full three-node roster renders, idle node dimmed correctly,
active path highlighted correctly.

### Second follow-up (2026-07-17): highlight never expired

Live-tested again after the full-roster fix: on a fresh app load, with
nothing asked yet, Strażnik showed up already lit up (green, "3207ms") —
the last-ever completed interaction stayed pinned as "active" forever,
including across app restarts, reading as if it were still working.

Fixed: added `HIGHLIGHT_EXPIRY_MS` (10s, per explicit ask — first proposed
60s, corrected down). Once every run in the currently-pinned interaction
has settled (nothing `running`) and the most recent `finished_at` is more
than 10s old, the pin clears and the whole tree fades back to full
standby. Needed `agent_runs.finished_at` added to the `getAgentFlow`
select (wasn't fetched before), plus a small polling-independent clock
(`setInterval` tick in the component) so the expiry actually re-evaluates
on a timer rather than only when new run data arrives.

Verified in this sandbox: synthetic data with `finished_at` 15s in the
past renders the entire tree as standby (all three nodes dimmed),
confirming the expiry path.

## 4. [UI] Schema Explorer (`/schema`) — **shipped 2026-07-17, live, confirmed working**

Admin-only HUD module to browse the live database topology: tables,
columns (type/nullable/default/PK), foreign keys (outbound + inbound,
clickable to jump between tables), RLS policies (per table, with
`USING`/`WITH CHECK` expressions), and enums — plus a graph view (SVG,
grid-laid-out nodes with FK arrows). Shipped directly via Lovable, not
this session; reviewed the plan against the codebase before it landed and
confirmed live behavior after by reading the merged diff.

Implementation matches what the pre-build review flagged as the
architecturally-necessary approach: the plan's own framing ("Bez zmian w
bazie") undersold it slightly — one migration was needed after all,
`20260717103728_e976ee53-...sql`, adding `public.get_public_schema_snapshot()`,
a `SECURITY DEFINER` function that queries `pg_class`/`pg_attribute`/
`pg_constraint`/`pg_policies`/`pg_type` internally and is called via
`supabase.rpc(...)` (`src/lib/schema/schema.functions.ts`). Supabase's
PostgREST client only exposes the `public` schema through `.from(...)` —
`information_schema`/`pg_catalog` aren't reachable that way, so a
`SECURITY DEFINER` RPC wrapper was the only viable route, consistent with
the existing `has_role`/`handle_new_user` pattern.

Access control is enforced **inside the RPC itself**
(`IF NOT has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION`), not just
client-side — a non-admin calling it gets a hard `42501` error, not a
silently-filtered response. The sidebar "Schema" entry
(`AppSidebar.tsx`) is currently shown unconditionally rather than gated
by an admin check, which is cosmetic-only risk in this single-tenant app
(the owner is the only account that can ever exist, and is always admin)
but worth a follow-up if the app ever stops being single-tenant — see
cleanup backlog (#10).

## 5. [F] Multi-provider AI routing — **increment 1 shipped 2026-07-17**

Interviewed the user first since this touches money: Claude access turned
out to be claude.ai (Pro/Max) only, no API console key — off the table
without a new purchase, which was explicitly ruled out. Gemini is a real
paid pay-as-you-go plan (the existing BYOK key). Landed on: **Groq is the
only new provider, free tier only**, used strictly as a cost/resilience
layer around Gemini — never as the primary reasoning engine, and never
replacing Gemini-exclusive capabilities (`web_search`'s Google Search
grounding, `remember`/`recall` embeddings — both stay Gemini-only).

Shipped:
- Migration `20260717120000_groq_api_key.sql` — `user_secrets.groq_api_key`
  (same BYOK pattern as Gemini). Settings → "Groq // Free Fallback Engine"
  panel to paste a free console.groq.com key (no card required).
- `src/lib/agents/providers/` — `types.ts` (the canonical Gemini-shaped
  turn representation `runtime.server.ts` already used internally, now
  shared) + `groq.ts` (translates that shape to/from Groq's
  OpenAI-compatible chat completions, including reconstructing
  `tool_call_id` pairing from Gemini's id-less functionCall/functionResponse
  ordering — documented invariant, not a guess).
- **Classifier fallback pass now runs on Groq first.** This was the actual
  token-efficiency win: every turn that doesn't call `perform_ui_action`
  was silently making a *second* full paid Gemini call just to force a
  yes/no "is this a UI command" decision. That's now a free, near-instant
  Groq call (`llama-3.1-8b-instant`), with the original Gemini path kept
  intact as the fallback if no Groq key is set or Groq errors — zero
  regression for anyone who skips the Groq setup.
- **Automatic failover**: if Gemini errors mid-turn (rate limit/5xx/
  timeout) and a Groq key exists, that turn retries once against
  `llama-3.3-70b-versatile` before the run is marked failed. Logged to
  `system_events` either way (warn on failover attempt, error if both
  providers failed) so Guardian/System Logs shows it happened.
- Not done yet, deliberately: Groq is not a user-selectable primary model
  for an agent's main conversation (only used internally, automatically).
  OpenRouter was approved by the user too but not built this round — same
  adapter shape as Groq, cheap follow-on whenever it's picked back up.

Verified at ship time: `tsc --noEmit` and `eslint` clean on every touched
file, and a full `vite build` (SSR) succeeds. Could not exercise a real
Gemini failure or a real Groq response in this sandbox (no live API
keys/network here) — the translation logic was verified by reading it
against the exact shapes `runtime.server.ts` already produces (its own
tool-call round-trip invariant), not by guessing the OpenAI/Groq API shape
from memory.

### Follow-up (2026-07-17): live-tested with a real Groq key, two real bugs found and fixed

1. **Classifier logging gap** — the "none" branch (ordinary chat, the
   common case) never called `logEvent`, so System Logs showed zero
   evidence Groq was running on most turns — only the rare UI-action hits
   were visible. Fixed: logs `classifier fallback via groq: none` too.
2. **Groq key looked "lost" after reload** — unlike Gemini, the Groq key
   input had no `localStorage` copy, so it always rendered empty on
   Settings reload even though the server-side key was fine. Fixed by
   mirroring Gemini's local-copy pattern (server copy remains the only
   functional one).
3. **Classifier fallback overwrote nothing** — when the fallback (Groq or
   Gemini) found a real UI action, it only set `uiAction` for navigation
   and never touched `finalText`, so the chat bubble kept showing whatever
   confused text the main turn produced before failing to call
   `perform_ui_action` itself (observed live: "ostrzeżenie: agent
   unknown"). Fixed with a `UI_ACTION_CONFIRMATIONS` map that overwrites
   `finalText` with a clean confirmation once the fallback succeeds.

Also clarified through live testing (not a bug): the classifier only runs
when the main turn doesn't already call `perform_ui_action` itself — for
obvious commands ("otwórz system logs") Gemini's main turn often succeeds
directly, so **no** classifier call (Groq or otherwise) happens at all,
which is the cheapest possible outcome, not a regression back to Gemini.
Confirmed live: `classifier fallback via groq: none` appears reliably for
ordinary chat messages after a Groq key is linked.

## 6. [F] RAG over personal documents (= Analityk, deprioritized not dropped)

Extend the proven `memories`/`match_memories` pgvector pattern to a
`documents`/`document_chunks` schema + upload/chunking Edge Function +
`search_documents` tool. TypeScript-first (`xlsx`/`papaparse`) — no Python
service unless a specific capability genuinely can't be done in JS. Still
valuable, just heavier (new pipeline, not reused data) than Strażnik — goes
after it rather than first, per the reordering above.

## 7. [W] Situation Room — **shipped 2026-07-17**

Merged `geo-tracking`, `WeatherTelemetry`, `GithubActivityPulse` and
`ThreatStream` into one unified radar command panel at `/situation-room`
(`geo-tracking` route removed, sidebar entry renamed). Went further than
"merge the widgets" — audited what was actually real first: `geo-tracking`
(browser Geolocation) and `GithubActivityPulse` (GitHub Events API) were
genuine; `WeatherTelemetry` was pure random-jitter fiction and
`ThreatStream` was a scripted fake feed that wasn't even wired into any
route. Fixed both instead of just relocating them:

- **`TacticalRadar.tsx`** — the tactical grid/sweep/rings SVG extracted
  from the old geo-tracking page into a shared component, generalized to
  plot a `contacts: RadarContact[]` prop instead of decorative lat/lon-
  seeded blips. Contacts are the real `system_events` feed (same one
  System Logs reads) — distance from center = recency, angle = a
  deterministic hash of the event id (stable across polls), color = level.
- **`WeatherTelemetry.tsx`** rewritten to call Open-Meteo (free, no API
  key) with the real geolocation fix, replacing the random-jitter numbers.
  Added an 8s abort timeout after live-testing surfaced it could hang on
  "acquiring telemetry…" forever with no timeout — now cleanly shows an
  error state on failure.
- **`ThreatStream.tsx` → `SystemPulseStream.tsx`** — same color-coded/
  fade-in ticker UI, but sourced from real `system_events` instead of the
  deleted `data/threatStream.ts` fake generator. Title changed from
  "Global Threat // Sat-Link Stream" (fiction) to "System Pulse // Event
  Stream" (honest).
- Dashboard (`index.tsx`) dropped the standalone `WeatherTelemetry`/
  `GithubActivityPulse` cards since both now live inside Situation Room.
- All UI-action/voice references to `/geo-tracking` updated
  (`AppSidebar`, `VoiceCommandContext`, `ArkRebootContext`, `jarvisBrain`,
  `commandDirectory`) so `perform_ui_action: open_telemetry` and the
  "pokaż telemetrię" voice command still resolve correctly.

Verified in this sandbox: `tsc --noEmit`/`eslint` clean, `vite build`
succeeds and regenerates `routeTree.gen.ts`. Also did a real Playwright
render (mocked geolocation) — layout, radar, HUD corners and all three
side panels render correctly with real coordinates reflected. Weather/
GitHub/system-events all showed empty/error states rather than real data
in the screenshot, but confirmed via direct `curl` from the host that
Open-Meteo itself is reachable — the failures are this sandbox's browser
not trusting the outbound proxy's TLS cert (a known, previously-
established sandbox limitation, not a code bug), and the weather panel's
new error state proved it fails cleanly rather than hanging.

Vision Scanner v2 and ambient reactive Arc Core remain queued as the next
gadget slot after this one.

## 8. [F] Concierge agent (calendar / email) — new agent proposal

Cheap to add: prompt-only persona like Marketer, no new architecture,
bound to the calendar/email OAuth tools below once they exist. Natural
pairing rather than a standalone "tools" item with no agent to use them.

## 9. [F] Calendar / email tools

OAuth-backed tools via the existing tool-registry pattern
(`public.tools` + per-agent binding) — same shape as `web_search`/
`fetch_url`, no new architecture. Ships together with Concierge (#8).

## 10. [F] Cleanup backlog (low priority, batch together)

- `user_settings.default_model` is dead — nothing reads it (`agents.model`
  always wins). Wire it up as a real fallback once multi-provider routing
  lands, or delete it.

---

## Long-shot / not scheduled

- **Local device bridge** (desktop automation, local Ollama) — needs a new
  architectural piece (a local companion process talking to
  `device_commands`) before either feature is attemptable at all. Don't
  start this without deciding on the bridge first — see `CODEX.md`
  Architecture constraints.
