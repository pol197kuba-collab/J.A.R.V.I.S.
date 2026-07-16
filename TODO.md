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

## 1. [UI] Dashboard redesign — holo-panels with depth — **shipped 2026-07-16, pending visual sign-off**

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

## 2. [F] Strażnik logów (Log Guardian agent) — next agent

Reordered ahead of Analityk on purpose: this reuses data we already have
(`event_log`, `agent_runs`, `GithubActivityPulse`) instead of needing a new
pipeline, and it absorbs two loose ends in one build instead of doing them
as isolated fixes:
- Fix `agent_runs.parent_run_id` not being populated on `delegate_to_agent`
  child runs — needed for the Guardian to reconstruct multi-agent traces at
  all, and blocks every future delegation feature until it's fixed anyway.
- Investigate the still-open 2026-07-10 telemetry finding: HUD news/intel
  widget showed 2 error-status runs out of 3 attempts, no captured output
  on failure. This is exactly the kind of thing a Log Guardian should have
  caught and surfaced — good first real task for it once it exists.
- Agent shape: read-only over `event_log`/`agent_runs`/tool-call history,
  surfaces anomalies (repeated failures, error-status runs, silent
  failures) either proactively (a HUD alert) or on request ("co się
  ostatnio wywaliło?").

## 3. [W] Situation Room / Radar Sweep — next gadget

Merge geo-tracking (Leaflet/Warsaw fallback), `WeatherTelemetry`,
`GithubActivityPulse`, and `ThreatStream` into one animated radar-style
panel — rotating sweep line, blips popping in for live events instead of
four static list panels. Zero new backend, pure frontend composition, and
a genuine "wow" moment reusing data we already surface elsewhere.

## 4. [F] Multi-provider AI routing

Every call is hardcoded to Gemini's REST endpoint (`runtime.server.ts`,
`tools.server.ts`). Add a provider abstraction (Claude, OpenAI, Groq,
OpenRouter — each a `fetch` to a different endpoint behind a shared
function-calling contract) so a user can bring their own key per task.
Highest-value, lowest-architecture-risk item on the backlog, and unlocks
intelligent model routing afterward for free.

## 5. [F] RAG over personal documents (= Analityk, deprioritized not dropped)

Extend the proven `memories`/`match_memories` pgvector pattern to a
`documents`/`document_chunks` schema + upload/chunking Edge Function +
`search_documents` tool. TypeScript-first (`xlsx`/`papaparse`) — no Python
service unless a specific capability genuinely can't be done in JS. Still
valuable, just heavier (new pipeline, not reused data) than Strażnik — goes
after it rather than first, per the reordering above.

## 6. [W] Second gadget slot — open

Reassess once items above ship — candidates: **Vision Scanner v2** (feed
scan results into `remember`/`recall` so a scan becomes recallable later),
or **ambient reactive Arc Core** (reactor/background reacting to voice in
real time full-screen, building on the existing Speaking/Processing state
in `ArcCorePanel`).

## 7. [F] Concierge agent (calendar / email) — new agent proposal

Cheap to add: prompt-only persona like Marketer, no new architecture,
bound to the calendar/email OAuth tools below once they exist. Natural
pairing rather than a standalone "tools" item with no agent to use them.

## 8. [F] Calendar / email tools

OAuth-backed tools via the existing tool-registry pattern
(`public.tools` + per-agent binding) — same shape as `web_search`/
`fetch_url`, no new architecture. Ships together with Concierge (#7).

## 9. [F] Cleanup backlog (low priority, batch together)

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
