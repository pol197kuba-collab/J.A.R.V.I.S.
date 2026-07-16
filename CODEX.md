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
  Test: *"Will this still be a good decision at 100+ agents?"*
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
1. **Multi-provider AI routing.** Today every call is hardcoded to Gemini's
   REST endpoint (`runtime.server.ts`, `tools.server.ts`). A provider
   abstraction (Claude, OpenAI, Groq, OpenRouter — each just a `fetch` to a
   different endpoint with a shared function-calling contract) lets a user
   bring their own key for whichever model fits the task, or let the
   Orchestrator route by task type. Highest-value, lowest-architecture-risk
   item on this list — user's own explicit interest.
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
  code running *on the user's machine*, which a browser tab and a Supabase
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

## Agent registry (live, as of 2026-07-10)

| slug | status | model | tools bound | notes |
|---|---|---|---|---|
| `orchestrator` | enabled | gemini-2.5-flash | 11 tools (web_search, fetch_url, save_note, list_notes, delete_note, remember, recall, create_task, list_tasks, update_task, delete_task) | Default agent, auto-seeded per user via `handle_new_user()`. `config.system_prompt` empty — uses code-level `DEFAULT_SYSTEM_PROMPT` as-is. |
| `marketer` | enabled | gemini-2.5-flash | web_search | Created via app UI (not a migration). Fixed 2026-07-10: `config.system_prompt` now contains **only** the Marketer specialization, no identity/language text — that comes exclusively from `persona.ts`. This is the pattern to follow for every future agent. |

`delegate_to_agent` tool-calling exists in `runtime.server.ts` and was
**verified end-to-end 2026-07-10** (orchestrator run `eb968ad8` →
`delegate_to_agent(slug: "marketer", ...)` → marketer run `115fb1fc`
executed ~2s later, output relayed back). Known gap:
`agent_runs.parent_run_id` is not being populated on the child run despite
the column existing for this exact purpose — fix before adding multi-level
delegation, or tracing becomes unreadable with more agents.

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

Beyond the Marketer prompt-only agent, the HUD already has ~30 components
including boot sequence, voice, threat stream, system logs, sub-systems,
and a **`geo-tracking` route** (Leaflet-based, Warsaw fallback) that predates
formal documentation of it here. Treat the frontend as further along than
the backend/agent layer — new agent work should assume a fairly complete
HUD shell already exists to plug into.

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
w sidebarze" change. The panel also surfaces live status (Speaking /
Processing / Listening / Standby) from `speak.ts` + `agentActivity.ts`.
No orphaned references to the removed components remain.

## Phase status vs. original 3-phase plan

- **Phase 1 (Marketer):** agent exists, persona bug fixed, tool binding
  fixed, delegation verified end-to-end (2026-07-10).
- **Phase 2 (Analityk / file analysis):** not started. Open decision: build
  file-parsing tools in TypeScript (`xlsx`/SheetJS, `papaparse`) inside the
  existing Edge Function runtime — preferred default, no new
  infrastructure — versus standing up a separate Python microservice only
  if a specific capability genuinely requires it (e.g. pandas-level
  statistical work JS libraries can't reasonably replicate). Do not
  introduce a Python service pre-emptively. **Note:** this phase now
  overlaps with the "RAG over personal documents" item in the Feature
  Roadmap above — worth merging into one piece of work rather than building
  twice.
- **Phase 3 (Strażnik logów):** not started.

## Immediate next steps

Superseded by **`TODO.md`** at the repo root — that file is now the single
ordered, checkable execution queue (Fundament/Wow/UI tagged, per the
cadence principle above). Keep this section as architecture context only;
update `TODO.md` as items ship instead of duplicating a list here.

### 2026-07-16 frontend note

The last Lovable-driven visual pass (`.lovable/plan.md`, "Premium AI OS
Visual Refresh — v2") was scoped as *styling-only*: rounded corners, soft
glow, a decorative background layer — it explicitly kept every panel's
existing box composition untouched ("Zero moved/renamed/removed
features"). That is why it read as "just rounded corners" rather than the
deeper dark/glass redesign that was actually wanted — the plan never
touched panel composition, only its edges. Any real redesign needs to
start one level up: what a "panel" *is* (composition, layering, whether it
should read as a window at all), not just how its border/radius look. See
`TODO.md` item 0.
