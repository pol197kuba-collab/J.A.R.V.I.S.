# CODEX.md

## Project Vision

J.A.R.V.I.S. (Just A Rather Very Intelligent System) is **not a chatbot** —
it's a long-term AI Operating System, inspired by J.A.R.V.I.S. from Iron
Man, that orchestrates multiple specialized AI agents, tools, memory and
external services through one cinematic interface.

Product shape: a **hosted web HUD** (React + TanStack Start, Supabase
backend), not a native desktop app. That single fact governs which features
below are a natural fit and which require an architectural addition (a
local bridge process) before they're possible at all — see
[Architecture constraints](#architecture-constraints).

## Principles

- **Frontend = interface. Backend = operating system.** Agents are workers,
  the Orchestrator coordinates, tools provide capabilities, memory stores
  knowledge. One clear responsibility per component.
- **Simple today, scalable tomorrow.** Small iterations, no premature
  infrastructure — but never make a decision that blocks future evolution.
  Test: _"Will this still be a good decision at 100+ agents?"_
- **Modular monolith**, not microservices, unless there's a compelling
  reason. Typical domains: Core, Agents, Tasks, Memory, Tools, Orchestrator.
- **Agents are software components, not prompts.** Identity, role, tools,
  permissions, memory, config — avoid hardcoded behavior.
- Prefer readability, explicit naming, composition over duplication. Avoid
  magic values, hidden side effects, unnecessary complexity.
- When proposing a change: explain **why**, not just what — advantages,
  disadvantages, long-term consequences. Challenge existing code if a
  clearly better solution exists; don't preserve it out of inertia.
- Business logic in the backend, presentation in the frontend — never leak
  backend details into the UI.
- **Delivery cadence: alternate Fundament and Wow.** Don't ship two
  invisible backend milestones in a row, and don't ship two demo gadgets in
  a row either. Roughly every other shipped item should be a durable
  capability (agent, tool, memory, routing — the "operating system" half)
  and the others a visible, demo-able gadget in the HUD (Vision Scanner is
  the reference example). See `TODO.md` for the current ordered queue.

## Feature Roadmap

Benchmarked 2026-07-16 against a comparable product (multi-AI Windows
desktop assistant with RAG, memory, voice, tool-calling and OS automation).
Where we already match or lead, and where their feature list points at a
real next step for **our** architecture:

### Already have (and in some cases ahead)

- AI Memory — `remember`/`recall`, pgvector semantic search (Milestone 2).
- Tool-calling agent — 11 tools, multi-step reasoning (web search, notes,
  tasks, memory, all CRUD).
- Voice — continuous conversation mode, wake-word-once + 20s follow-up
  window, echo guard (Milestone 2.2). More natural than a one-shot
  wake-word-per-utterance design.
- Web dashboard — the HUD itself; already ~30 components deep.

### Natural next steps (fit our stack directly)

1. **Multi-provider AI routing — increment 1 shipped, see Milestone 7.**
   Gemini is still the primary reasoning engine for every agent's main
   conversation and every tool (`tools.server.ts` — `web_search` grounding,
   embeddings — is untouched and stays Gemini-only). What shipped: a
   provider abstraction (`src/lib/agents/providers/`) that currently has one
   extra adapter, Groq (free tier), used automatically for the UI-action
   classifier pass and as emergency failover when Gemini errors — not yet a
   user-selectable primary model. Claude was evaluated and ruled out for
   now (the user only has claude.ai, not an API console key — adding it
   would require a new purchase, which was explicitly declined).
   OpenRouter was approved but not built yet — same adapter shape as Groq.
2. **RAG over personal documents.** We already proved the pattern with
   `memories` + `match_memories` (pgvector, HNSW, Gemini embeddings). Extend
   it: a `documents`/`document_chunks` schema, an upload + chunking pipeline
   (Edge Function), and a `search_documents` tool. Same infrastructure,
   new content type (PDFs, notes, project files) instead of chat-derived
   facts.
3. **Calendar / email tools.** Fits the existing tool-registry pattern
   exactly (`public.tools` + per-agent binding) — OAuth-backed integrations
   alongside `web_search`/`fetch_url`. No new architecture, just new tools.
4. **Intelligent model routing.** Falls out naturally once (1) exists — the
   Orchestrator picks a provider/model per request instead of a user
   picking one manually.

### Long-shot — needs a new architectural piece first

- **Local/desktop automation** (launch apps, organize files, browser
  automation, OS-level control) and **local AI via Ollama** both require
  code running _on the user's machine_, which a browser tab and a Supabase
  Edge Function cannot do. This is the same shape as the previously-scoped
  "Tier 3 — device bridge" (smart-home/Tapo), generalized: a small local
  companion process that authenticates to the user's account and executes
  commands queued via `device_commands`. Don't attempt either feature
  without deciding on and building that bridge first — chasing them
  directly inside the current web stack is a dead end.

## Architecture constraints

Product shape is a **hosted web app**, not an Electron/native desktop app.
Concretely, this means:

- No filesystem access, no launching local processes, no local Ollama —
  anything requiring code on the user's machine needs the bridge concept
  above, not a browser API.
- All AI calls happen server-side (Edge Function / TanStack server fn) with
  the user's own API key — never expose provider keys to the client.
- The `devices`/`device_commands` tables already exist for exactly this
  "queue a command for something outside our runtime" pattern — reuse them
  for any future local-bridge work rather than inventing a parallel channel.

## Coding & Decision-Making

- Prefer long-term maintainability > scalability > modularity, in that
  order, when solutions trade off against each other.
- Whenever proposing schema changes: explain the reasoning, the tradeoffs,
  and confirm they don't foreclose extensibility.
- Don't build long-term features prematurely — they should emerge through
  iteration, not upfront scaffolding.

---

# Current State (Living)

> Last audited: 2026-07-16. This section reflects the **actual live state**
> (git repo + Supabase data export), not the original plan. Update it after
> every phase or major architectural change — do not let it go stale again.

## Confirmed stack reality

- **100% TypeScript.** No Python/FastAPI code exists anywhere in this repo,
  despite earlier planning. If a Python service is introduced later, it will
  be a **separate deployment** (Render/Fly/Railway) called via `fetch` from
  a Supabase Edge Function — Edge Functions themselves run on Deno and
  cannot host Python directly. Do not assume a Python backend exists unless
  this section says otherwise.
- Orchestration lives entirely in `src/lib/agents/runtime.server.ts`
  (server-side, `chat_routing: "server"` confirmed in live `user_settings`).
  The client-side `jarvisBrain.ts` path exists but is not the active route.
- Default model: `gemini-2.5-flash` for all agents. `models.ts` is the
  single source of truth for which model IDs are offered in the UI. (Will
  need to become provider-aware once multi-provider routing lands — see
  Feature Roadmap above.)

## Two sources of truth — audit both, always

- **Git repo** = schema (SQL migrations, DDL) + all application code.
  Reliable for structure, never reliable for row-level data.
- **Live Supabase data** (agent rows, tool bindings, settings) can be
  created directly by the running app (e.g. via an "add agent" UI action)
  **without ever producing a migration file**. The `marketer` agent was
  discovered this way — it was invisible from git alone.
- Practical rule: before any planning session that touches agents/tools,
  pull a fresh data snapshot (agents, tools, agent_tools, user_settings —
  excluding `user_secrets` and conversational tables) rather than relying on
  migrations or memory of past sessions.
- **The drift runs the other way too, and it's the one that actually bit
  us:** a migration file merged into git is **not** applied to the live
  database automatically. This project applies SQL migrations manually —
  the user pastes the migration's SQL into the Supabase SQL editor
  themselves; nothing in the GitHub → Lovable pipeline runs it on merge.
  Confirmed 2026-07-16: `20260716150000_guardian_agent.sql` merged
  cleanly, but the `guardian` agent didn't exist live, the chat agent
  selector and Agent Hub didn't show it, and the Orchestrator's live
  roster genuinely didn't include it (so it couldn't delegate, and
  improvised opening System Logs instead when asked to consult it).
  **Whenever a migration is added, paste its full SQL directly into the
  chat reply** (not just "I added a migration file") so the user can copy
  it straight into Supabase — don't assume merging the PR was the last
  step.

## Agent registry (live, as of 2026-07-22)

| slug                  | status  | model            | tools bound                                                                                                                               | notes                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orchestrator`        | enabled | gemini-2.5-flash | 11 tools (web_search, fetch_url, save_note, list_notes, delete_note, remember, recall, create_task, list_tasks, update_task, delete_task) | Default agent, auto-seeded per user via `handle_new_user()`. `config.system_prompt` empty — uses code-level `DEFAULT_SYSTEM_PROMPT` as-is.                                                                                                                                                                                                                                                                             |
| `marketer`            | enabled | gemini-2.5-flash | web_search                                                                                                                                | Created via app UI (not a migration). Fixed 2026-07-10: `config.system_prompt` now contains **only** the Marketer specialization, no identity/language text — that comes exclusively from `persona.ts`. This is the pattern to follow for every future agent.                                                                                                                                                          |
| `guardian` (Strażnik) | enabled | gemini-2.5-flash | 3 tools (guardian_scan_errors, guardian_run_stats, guardian_check_delegation)                                                             | Added 2026-07-16 via migration (`20260716150000_guardian_agent.sql`) for every existing + future user — the "seed through a migration, not the UI" lesson from `marketer` applied. Read-only system-health monitoring + active smoke-tests over `event_log`/`agent_runs`. Explicitly **no** code/filesystem access and **no** UI/voice test automation — see TODO.md for why that's out of scope for any in-app agent. |
| `analityk`            | enabled | gemini-2.5-flash | list_documents, search_documents                                                                                                          | Added 2026-07-20 via migrations (`20260720120000_documents_rag.sql` + `20260720120500_analityk_agent.sql`). RAG over the user's uploaded documents (`documents`/`document_chunks` + `match_document_chunks`). Confirmed working live 2026-07-21 — see TODO.md item 6.                                                                                                                                                  |
| `researcher`          | enabled | gemini-2.5-flash | web_search, fetch_url, list_documents, search_documents                                                                                   | Added 2026-07-22 via migration (`20260722120000_researcher_agent.sql`) — TODO.md item 11. Deep multi-step research: several search/fetch rounds, cross-checking sources, synthesis with a source list, grounded in the user's own documents via the Analityk RAG tools. No new tools seeded — reuses 4 existing ones. Config: max_tool_iterations 10, max_output_tokens 2400, temperature 0.4.                         |

`delegate_to_agent` tool-calling exists in `runtime.server.ts` and was
**verified end-to-end 2026-07-10** (orchestrator run `eb968ad8` →
`delegate_to_agent(slug: "marketer", ...)` → marketer run `115fb1fc`
executed ~2s later, output relayed back). `agent_runs.parent_run_id` was
fixed 2026-07-13 (commit `c40347a`) — this section had gone stale claiming
it as an open gap for three days past that fix; caught 2026-07-16 while
scoping the Guardian agent. `guardian_check_delegation` now exists
specifically so this kind of regression gets caught by a smoke-test
instead of by a documentation audit next time.

## Known dead/inconsistent config

- `user_settings.default_model` (currently `gemini-2.5-flash`) is **not
  actually read by anything** — each agent's own `agents.model` column
  wins. Either wire it up as a real fallback when `agents.model` is null,
  or remove it to avoid confusion.
- Commit history on the connected branch is mostly generic ("Changes") from
  Lovable auto-sync. Not urgent, but write clearer commit messages going
  forward for anything done directly in github.dev.

## Milestone log

- **Milestone 1 (2026-07-14)** — Orchestrator gained Memory
  (`remember`/`recall` on `public.memories`) and Tasks
  (`create_task`/`list_tasks`/`update_task` on new `public.tasks`).
  Migration `20260714101500_memory_and_tasks_tools.sql`.
- **Milestone 2 (2026-07-15)** — Tasks UI (dashboard widget + `/tasks`
  page), semantic recall (pgvector + `match_memories` RPC, Gemini
  `gemini-embedding-001` embeddings merged with ILIKE), `created_by_agent`/
  `memories.agent_id` attribution. Migration
  `20260715093000_semantic_memory.sql`.
- **Milestone 2.1 (2026-07-15)** — Bug fixes from live testing: system
  prompt now always carries the real current date/time (agents previously
  guessed relative dates from training data); CRUD parity — added
  `list_notes`, `delete_note`, `delete_task` tools. Migration
  `20260715120000_note_task_delete_tools.sql`.
- **Milestone 2.2 (2026-07-15)** — Voice conversation mode: wake word
  required only to start, 20s follow-up window after each reply (extended
  per utterance), echo guard against JARVIS hearing his own TTS,
  `wake_word_enabled` setting finally wired up (was dead since initial
  schema). All in `VoiceCommandContext.tsx`, no backend changes.
- **Milestone 3 (2026-07-16)** — Dashboard depth pass (PRs #10-#12).
  `HudPanel` gained an `"elevated" | "quiet"` tone; the real fix, found via
  live DOM inspection rather than screenshots, was a cascade-layer bug in
  `styles.css`: an unlayered `.hud-panel > * { position: relative }` rule
  was silently beating Tailwind's layered `.absolute` utility on every
  panel in the app (unlayered CSS always wins regardless of specificity),
  forcing decorative absolutely-positioned elements into normal flow. Fixed
  by moving it into `@layer utilities` + `:where()`. Hero panel dropped
  552px → 264px. Hero redesign reuses `ArcReactorTriangle` (previously
  sidebar-only) + a new shared `useAgentStatus()` hook instead of a second
  bespoke decoration.
- **Milestone 4 (2026-07-16)** — Guardian (Strażnik) agent, see Phase 3
  below.
- **Milestone 5 (2026-07-16)** — Agent Flow Tree. Replaces the
  `SystemStatsStrip` dashboard widget (FPS/CPU/MEM/NET — real but
  uninteresting) with a live delegation tree: Orchestrator at the root,
  branching down to whichever agent it delegates to, tool calls per node,
  built entirely from `agent_runs.parent_run_id` +
  `agent_runs.output.tool_calls` (both already written by the runtime —
  no new tables). `src/lib/agents/flow.functions.ts` +
  `src/components/jarvis/AgentFlowTree.tsx`. Also fixed
  `guardian_scan_errors` querying the dead `event_log` table instead of
  `system_events` (the table the runtime actually writes telemetry to) —
  caught while tracing exactly where run/tool data lives for this widget.
- **Milestone 6 (2026-07-17)** — Schema Explorer (`/schema`), admin-only.
  Shipped directly via Lovable (not this session) from a plan the user
  shared for review first. Reviewed the plan against the codebase before
  it landed: confirmed the owner auto-admin-grant trigger would satisfy an
  admin gate, and that the `supabaseAdmin` service-role pattern already
  existed if needed as a fallback — but flagged the plan's "Bez zmian w
  bazie" claim as likely wrong, since PostgREST only exposes the `public`
  schema and can't query `information_schema`/`pg_catalog` directly. The
  shipped implementation confirms that call: migration
  `20260717103728_e976ee53-...sql` adds
  `public.get_public_schema_snapshot()`, a `SECURITY DEFINER` function
  (queries `pg_class`/`pg_attribute`/`pg_constraint`/`pg_policies`/
  `pg_type`, gated by `has_role(auth.uid(), 'admin')` _inside_ the
  function body, `RAISE EXCEPTION` on failure) called via
  `supabase.rpc(...)` from `src/lib/schema/schema.functions.ts` — the
  exact pattern predicted, consistent with `has_role`/`handle_new_user`.
  `/schema` (`src/routes/schema.tsx`) renders it as a table index + detail
  panel (columns, PK/nullable/default, inbound/outbound FKs, RLS policies
  with `USING`/`WITH CHECK`) plus an SVG graph view. Minor gap: the
  sidebar "Schema" link isn't itself gated by an admin check (the RPC's
  own check is what actually protects the data) — low risk in this
  single-tenant app, tracked in `TODO.md` cleanup backlog.
- **Milestone 7 (2026-07-17)** — Multi-provider AI routing, increment 1.
  Interviewed the user before building anything, since this is a spend
  decision: Claude turned out to be claude.ai only (no API console key —
  ruled out without a new purchase, which the user explicitly didn't want),
  Gemini is a real paid pay-as-you-go BYOK key (unchanged, stays the
  primary reasoning engine), and Groq (genuinely free tier) was approved as
  the one new provider. Scoped narrowly on purpose: Groq never replaces
  Gemini, it only removes waste and adds a safety net around it.
  `src/lib/agents/providers/types.ts` promotes the Gemini-shaped
  turn representation `runtime.server.ts` already used internally
  (`GeminiContent`/`GeminiPart`) to a shared type, so `providers/groq.ts`
  can translate to/from Groq's OpenAI-compatible chat completions at
  exactly that one boundary — the tool-calling loop itself is untouched
  and still thinks entirely in Gemini's shape. Two uses: (1) the
  `perform_ui_action` classifier fallback pass — previously a **second
  full paid Gemini call on every turn that didn't already call a UI
  action** — now runs on free Groq (`llama-3.1-8b-instant`) first, falling
  through to the original Gemini path unchanged if no Groq key is set;
  (2) automatic failover — a Gemini error mid-turn (rate limit/5xx/
  timeout) retries once via Groq (`llama-3.3-70b-versatile`) before the
  run fails, logged to `system_events`. `web_search` (Google Search
  grounding) and `remember`/`recall` (Gemini embeddings) are deliberately
  untouched — Gemini-exclusive capabilities, not something Groq
  substitutes for. Migration `20260717120000_groq_api_key.sql` adds
  `user_secrets.groq_api_key`; Settings gained a matching BYOK panel.
  OpenRouter was approved too but not built this round (same adapter
  shape as Groq, easy follow-on). See `TODO.md` item 5 for the full
  writeup and what's deliberately still out of scope.
- **Milestone 8 (2026-07-17)** — Situation Room (`/situation-room`),
  replacing `/geo-tracking`. Audited the four widgets being merged before
  touching code: `geo-tracking` (real browser Geolocation) and
  `GithubActivityPulse` (real GitHub Events API) were genuine;
  `WeatherTelemetry` was random-jitter fiction with no real API behind it,
  and `ThreatStream` was a scripted fake feed that wasn't even wired into
  any route. Fixed both instead of relocating fake data: `WeatherTelemetry`
  now calls Open-Meteo (free, no key) with the real geolocation fix;
  `ThreatStream` became `SystemPulseStream`, same UI, sourced from real
  `system_events`. `TacticalRadar.tsx` extracts the radar SVG from the old
  geo-tracking page into a shared component that plots real contacts
  (`system_events`, distance = recency, angle = a deterministic hash of
  the event id, color = level) instead of decorative lat/lon-seeded blips.
  Live-testing during a Playwright render caught a real gap: the weather
  fetch had no timeout and could hang on "acquiring telemetry…" forever —
  added an 8s `AbortController` timeout so it fails cleanly instead.
  `data/threatStream.ts` deleted (dead fake-data generator).
- **Milestone 8.1 (2026-07-17)** — live user feedback on Milestone 8:
  `system_events`-as-radar-blips read as meaningless ("what are the green
  dots"), and weather had no sky condition or location label. Radar's
  contacts swapped to real ADS-B aircraft (`src/lib/geo/flightRadar.ts`,
  OpenSky Network free/keyless `states/all`, bounding-boxed to a 150km
  range around the real fix) — real bearing/distance from lat/lon, not a
  hash. `system_events` stays visible via `SystemPulseStream`'s ticker
  instead, which fits that data shape better anyway. `WeatherTelemetry`
  gained a `weather_code`→condition label (WMO table) and a reverse-
  geocoded location name in the panel title (BigDataCloud, free/keyless).
  Both new external APIs' response shapes were verified against live
  `curl` calls before coding the parsers, not assumed from memory. A real
  precipitation weather radar on an actual map (Leaflet + RainViewer) was
  discussed and deliberately deferred — different visual language from
  the rest of the HUD, bigger scope, queued as its own future item.
- **Milestone 8.2 (2026-07-17)** — more live feedback: the SVG radar with
  zero aircraft in range read as "broken", not "empty", and wasn't
  pannable/zoomable. Replaced it outright with a real Leaflet map (dark
  CARTO tiles, `.geo-map` filter class already prepared in `styles.css`
  from an earlier, apparently-abandoned Leaflet attempt).
  `TacticalMap.tsx` plots aircraft at real lat/lon as heading-rotated
  markers; pan/zoom are Leaflet's own defaults, no extra work. **Caught a
  real bug before shipping**: Leaflet touches `window` at module load
  time, which crashed this app's SSR (every route is server-rendered)
  with `window is not defined` — confirmed live in the sandbox dev
  server, not assumed. Fixed with a client-only dynamic `import("leaflet")`
  inside a `useEffect`, keeping only `import type * as LeafletNS` at the
  top level (type-only imports are erased, never reach the SSR bundle) —
  reverified clean (no crash, map renders, HUD overlays stack correctly)
  before merging. `flightRadar.ts` simplified to return raw
  lat/lon/heading instead of a radar-projected angle/distance;
  `TacticalRadar.tsx` deleted (fully superseded). A precipitation-radar
  tile overlay (RainViewer) on this same map is now a much smaller
  add-on than originally scoped, since the map/Leaflet groundwork already
  exists.
- **Milestone 8.3 (2026-07-17)** — two more real bugs from live testing.
  (1) Map showed pure black: the `.geo-map` filter was built to invert
  _light_ OSM tiles, crushed CARTO's already-dark tiles to near-black —
  verified by rendering a real downloaded tile through both filters via a
  local Playwright page, not guessed. Fixed with a light-touch tint
  (`saturate(1.3) hue-rotate(170deg)`, no darkening). (2) Map fixed but
  `AIRCRAFT: 0` persisted and the view was zoomed to whole-world: OpenSky
  Network doesn't send CORS headers for third-party origins (`curl -D -`
  confirms `access-control-allow-origin: https://opensky-network.org`
  only) — every browser call was silently blocked, so the "genuinely 0
  aircraft" read logged in Milestone 8.1/8.2 was wrong; it never worked
  from a browser at all. `curl`-based dev verification missed this since
  curl doesn't enforce CORS. Fixed by moving the OpenSky call behind a
  server function (`src/lib/geo/flightRadar.functions.ts`,
  `fetchNearbyFlightsFn`) — server-to-server has no CORS restriction,
  same pattern as every other external-API call in this app. The
  world-zoom was Leaflet's default `scrollWheelZoom` hijacking normal
  page-scroll; fixed with the standard click-to-activate-scroll-zoom
  pattern, plus made the home-marker effect always recenter the view on
  `lat`/`lon` change (previously only did so on first marker creation).
  Could not verify the CORS fix end-to-end in-sandbox (server-function
  RPC never executes here, an established unrelated limitation) — the
  `curl` header check is independent evidence of the actual cause;
  genuine confirmation needs a live check post-deploy.
- **Milestone 8.4 (2026-07-17/18)** — the error-surfacing from 8.3 paid
  off immediately: two more real failures (`AbortController` 10s timeout
  firing on every poll — raised to 25s with headroom after confirming
  OpenSky itself responds in under 2s; then a transient Cloudflare 522,
  resolved with `retry: 2` plus a 90s poll interval after `curl` revealed
  OpenSky's anonymous tier is hard-capped at 400 requests/day via its
  `x-rate-limit-remaining` header) were each read straight from the exact
  logged error instead of guessed. Then a real _design_ gap, not a bug:
  aircraft only ever loaded within a fixed 150km radius of the user's own
  position, so panning/zooming the map elsewhere (which is what the user
  was actually doing, looking for traffic) could never show anything.
  Rebuilt as a viewport-driven tracker (Flightradar24-style):
  `fetchFlightsInBounds` takes Leaflet's own `getBounds()` box directly;
  `TacticalMap.tsx` now owns the fetch (via `moveend`), reporting a
  `{ok|error|zoom_in}` status back to the route via a callback;
  `MAX_QUERY_SPAN_DEG = 15` refuses to query above that span (an amber
  "ZOOM IN TO LOAD" state, distinct from the red error state) so a
  whole-world zoom-out can't blow the daily quota in one request.

Beyond the Marketer prompt-only agent, the HUD already has ~30 components
including boot sequence, voice, system logs, sub-systems, and (since
Milestone 8.4) a **`situation-room` route** — real browser Geolocation, a
real pannable/zoomable Leaflet map (`TacticalMap.tsx`) plotting real
ADS-B contacts loaded for whatever's currently in view, and real
telemetry (GitHub Events API, Open-Meteo). Treat the frontend as further
along than the backend/agent layer — new agent work should assume a
fairly complete HUD shell already exists to plug into.

### Arc Core reactor components (consolidated 2026-07-14)

The reactor visuals were consolidated during a Lovable-driven Arc Core /
scaling pass. The legacy `ReactorCore.tsx` (~400 lines) and `ArcCoreWidget.tsx`
were **removed**; there is now a single pair of SVG components, both driven
purely by `--primary` and CSS animations (no runtime state, safe to render
anywhere):

- `MiniArcReactor.tsx` — small spinning three-triangle mark, `size` prop
  (default 28). Used in the sidebar header, boot/login, and module frames.
- `ArcReactorTriangle.tsx` — the large radial reactor. Self-scales
  responsively via Tailwind (`w-[min(48vmin,360px)]`, `max-md:`,
  `landscape:max-md:`, `short:`) and accepts `raised` + `className` for
  per-slot overrides.

In the sidebar, `ArcCorePanel` (in `AppSidebar.tsx`) wraps
`ArcReactorTriangle` with size overrides (`!w-[160px]`, `short:!w-[100px]`,
mobile `!w-[100px]`/`short:!w-[80px]`) — this is the "Zmniejszono Arc Core
w sidebarze" change. No orphaned references to the removed components
remain.

Since Milestone 3, `ArcReactorTriangle` is also used in the dashboard
hero (`routes/index.tsx`, `!w-[150px]`), both consumers reading live
status (Speaking / Processing / Listening / Standby) from a shared
`useAgentStatus()` hook (`components/jarvis/useAgentStatus.ts`) wrapping
`speak.ts` + `agentActivity.ts` — don't duplicate that logic again if a
third consumer shows up, extend the hook instead.

## Phase status vs. original 3-phase plan

- **Phase 1 (Marketer):** agent exists, persona bug fixed, tool binding
  fixed, delegation verified end-to-end (2026-07-10).
- **Phase 2 (Analityk / file analysis):** not started, and **reordered
  after Strażnik** (see below) — decided 2026-07-16. Still the right
  eventual scope: file-parsing tools in TypeScript (`xlsx`/SheetJS,
  `papaparse`) inside the existing Edge Function runtime, no Python service
  unless a specific capability genuinely requires it. Overlaps with the
  "RAG over personal documents" Feature Roadmap item — merge into one piece
  of work rather than building twice, whenever it's picked back up.
- **Phase 3 (Strażnik logów / Guardian): done, 2026-07-16.** Reordered
  ahead of Phase 2 because it reuses existing `event_log`/`agent_runs`
  data (no new pipeline). Shipped as `guardian_scan_errors` (recent
  errors/warnings), `guardian_run_stats` (per-agent trend/regression
  detection), `guardian_check_delegation` (smoke-tests the `parent_run_id`
  fix stays fixed). Migration `20260716150000_guardian_agent.sql`.
  Deliberately scoped to read-only backend/data monitoring — no code/
  filesystem access, no UI/voice test automation (see `TODO.md` for why
  that's out of scope for any in-app agent, not just this one).

Two new agent ideas beyond the original 3-phase plan, tentatively queued
in `TODO.md`:

- **Concierge** (calendar/email) — cheap, prompt-only like Marketer, paired
  with the calendar/email OAuth tools item.
- Second wow-gadget slot may eventually want a **Researcher**-style agent
  (deep multi-step web research, complementing Marketer's marketing focus)
  once RAG-on-documents exists to ground it — not scheduled yet, noted for
  when that decision comes up.

## Immediate next steps

Superseded by **`TODO.md`** at the repo root — that file is now the single
ordered, checkable execution queue (Fundament/Wow/UI tagged, per the
cadence principle above). Keep this section as architecture context only;
update `TODO.md` as items ship instead of duplicating a list here.

### 2026-07-16 frontend note

The last Lovable-driven visual pass (`.lovable/plan.md`, "Premium AI OS
Visual Refresh — v2") was scoped as _styling-only_: rounded corners, soft
glow, a decorative background layer — it explicitly kept every panel's
existing box composition untouched ("Zero moved/renamed/removed
features"). That is why it read as "just rounded corners" rather than the
deeper dark/glass redesign that was actually wanted — the plan never
touched panel composition, only its edges.

Decided direction (after reviewing a live screenshot against
`src/routes/index.tsx`, which wraps every section in one uniform
`space-y-6` stack of equal-weight `HudPanel`s): keep the single-column
layout, but give panels real elevation/layering and let selected elements
bleed past their container edge, instead of every section being a flat,
equally-weighted, strictly-clipped box. **Shipped — see Milestone 3
above.**
