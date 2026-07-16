# TODO — Near Term

> Working queue, refreshed 2026-07-16. Ordered — work top to bottom unless
> noted. Check items off as they ship; keep this in sync instead of letting
> `CODEX.md`'s roadmap section and this file drift apart. Tags: **[F]**
> Fundament (backend/agent, durable, mostly invisible) · **[W]** Wow
> (visible, demo-able gadget) · **[UI]** frontend/dashboard.
>
> Cadence: don't ship two [F]s or two [W]s back to back — alternate, so we
> keep building the "operating system" half while still shipping things
> worth showing off (Vision Scanner is the bar for [W]).

## 0. Blocked on you — dashboard redesign [UI]

Waiting on your screenshot to scope this properly, but the root cause is
already clear from `.lovable/plan.md`: the last Lovable pass ("Premium AI OS
Visual Refresh — v2") was explicitly styling-only — it softened
`.hud-panel` edges (radius, glow, backdrop-blur) and added a decorative
background layer, but kept every panel's box composition **identical**
("Zero moved/renamed/removed features"). That's the whole gap: rounding
corners on the same boxy grid of windows was never going to produce "depth,
away from boxy windows" — that needs a rethink of what a panel *is*
(layering, asymmetric composition, panels that don't read as discrete
windows), not a border-radius tweak.

Once the screenshot's in: audit `src/styles.css` (`.hud-panel`,
`.hud-corner`, surface/glow tokens) and `DashboardShell.tsx` layout, and
plan an actual compositional pass — not another "soften the same boxes"
pass.

## 1. [F] Fix `agent_runs.parent_run_id` tracing gap

`delegate_to_agent` works end-to-end but doesn't populate `parent_run_id`
on the child run despite the column existing for this. Small, fast fix —
do it first because it blocks readable tracing for every multi-agent
feature below it (RAG delegation, future agents, Phase 3).

## 2. [W] Ship one new gadget

Pick one (or propose your own) — candidates that reuse data we already
have live in the HUD:

- **Situation Room widget** — merge geo-tracking (Leaflet/Warsaw fallback),
  `WeatherTelemetry`, `GithubActivityPulse`, and `ThreatStream` into one
  glanceable radar-style panel. Zero new backend, pure frontend
  composition + a genuine wow layout moment.
- **Vision Scanner v2** — feed scan results into Memory (`remember`), so a
  scanned document/object becomes recallable later ("what did I scan
  yesterday about X?"). Ties the existing gadget into the agent brain.
- Your call — this slot is deliberately open.

## 3. [F] Multi-provider AI routing

Every call is hardcoded to Gemini's REST endpoint (`runtime.server.ts`,
`tools.server.ts`). Add a provider abstraction (Claude, OpenAI, Groq,
OpenRouter — each a `fetch` to a different endpoint behind a shared
function-calling contract) so a user can bring their own key per task.
Highest-value, lowest-architecture-risk item on the backlog, and unlocks
intelligent model routing afterward for free.

## 4. [F] RAG over personal documents (= Analityk Phase 2, merged)

Extend the proven `memories`/`match_memories` pgvector pattern to a
`documents`/`document_chunks` schema + upload/chunking Edge Function +
`search_documents` tool. TypeScript-first (`xlsx`/`papaparse`) — no Python
service unless a specific capability genuinely can't be done in JS.

## 5. [W] Second gadget slot

Reassess after items 2-4 ship — could be a voice-driven "scan → remember"
live demo, or something new depending on what's shipped by then.

## 6. [F] Calendar / email tools

OAuth-backed tools via the existing tool-registry pattern
(`public.tools` + per-agent binding) — same shape as `web_search`/
`fetch_url`, no new architecture.

## 7. [F] Cleanup backlog (low priority, batch together)

- `user_settings.default_model` is dead — nothing reads it (`agents.model`
  always wins). Wire it up as a real fallback once multi-provider routing
  lands, or delete it.
- Investigate 2026-07-10 telemetry: HUD news/intel widget showed 2
  error-status runs out of 3 attempts on the same prompt, no captured
  output on failure. Not blocking, but flagged and unresolved.

---

## Long-shot / not scheduled

- **Local device bridge** (desktop automation, local Ollama) — needs a new
  architectural piece (a local companion process talking to
  `device_commands`) before either feature is attemptable at all. Don't
  start this without deciding on the bridge first — see `CODEX.md`
  Architecture constraints.
