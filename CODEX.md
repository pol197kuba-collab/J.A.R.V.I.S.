# CODEX.md

# J.A.R.V.I.S. - Project Context for Codex

## Project Vision

J.A.R.V.I.S. (Just A Rather Very Intelligent System) is **not a chatbot**.

The goal of this repository is to build a long-term AI Operating System inspired by J.A.R.V.I.S. from Iron Man.

The system should eventually become a central platform capable of orchestrating multiple AI agents, workflows, tools and external services through a single intelligent interface.

The frontend already provides a cinematic HUD experience. The backend should evolve into a scalable AI platform rather than a traditional REST application.

---

# Mission

The purpose of this project is to build an ecosystem where specialized AI agents cooperate under one intelligent core.

The long-term architecture should support:

- Multiple specialized AI agents
- Agent orchestration
- Shared memory
- Workflow execution
- External integrations
- Automation
- Plugin system
- Knowledge base
- Long-term scalability

The current implementation should focus only on the next logical step while preserving this long-term vision.

---

# Architectural Philosophy

Think about this project as an operating system.

NOT as a chatbot.

NOT as a CRUD application.

NOT as a single AI assistant.

The frontend is the user interface.

The backend is the operating system.

Agents are workers.

The Orchestrator is the coordinator.

Tools provide capabilities.

Memory stores knowledge.

Every component should have one clear responsibility.

---

# Development Philosophy

The project is intentionally developed in small iterations.

Avoid overengineering.

Avoid unnecessary abstraction.

Avoid creating infrastructure that is not yet needed.

However...

Never introduce architectural decisions that make future evolution difficult.

The preferred approach is:

> Simple today.
>
> Scalable tomorrow.

---

# Current Technology Stack

Current technologies include:

- React 19
- TanStack Start
- TypeScript
- TailwindCSS
- Supabase
- PostgreSQL
- FastAPI
- Python
- Gemini

These technologies may evolve over time.

Codex may suggest improvements if they provide clear architectural advantages.

---

# Backend Direction

The backend should evolve as a **modular monolith**.

Do NOT design microservices unless there is a compelling reason.

Modules should be independent and loosely coupled.

Typical domains may include:

- Core
- API
- Agents
- Tasks
- Memory
- Tools
- Services
- Orchestrator
- Scheduler
- Plugins

This list is not fixed.

Codex may propose a better organization when appropriate.

---

# AI Agents

Agents are not prompts.

Agents are software components.

Every agent should eventually have:

- identity
- role
- capabilities
- tools
- permissions
- memory
- configuration
- lifecycle
- metrics
- health status

Avoid hardcoded behavior.

Prefer extensible designs.

The first agents are expected to become reusable building blocks for future agents.

---

# Orchestrator

The Orchestrator is expected to become the heart of the system.

Responsibilities:

- coordinate agents
- distribute work
- monitor execution
- manage workflows
- schedule tasks

The Orchestrator should NOT contain business logic that belongs inside agents.

Agents execute.

The Orchestrator coordinates.

---

# Memory

Memory should evolve gradually.

Initial implementations may be simple.

Long-term vision includes:

- Working Memory
- Conversation Memory
- Long-Term Memory
- Structured Knowledge
- Vector Memory

Current implementations should leave room for future expansion.

---

# Database Philosophy

Design the database with future growth in mind.

Do not create unnecessary tables only because they may become useful.

However...

Relationships, naming and structure should naturally support future evolution.

Whenever proposing schema changes:

- explain the reasoning
- explain tradeoffs
- avoid unnecessary complexity
- avoid breaking extensibility

---

# Coding Principles

Always prefer:

- readability
- maintainability
- modularity
- explicit naming
- clean interfaces
- composition over duplication
- single responsibility

Avoid:

- magic values
- hidden side effects
- tightly coupled code
- unnecessary complexity

Code should be understandable by another developer without additional explanation.

---

# Decision Making

Whenever multiple solutions exist:

1. Prefer long-term maintainability.
2. Prefer scalability.
3. Prefer modularity.
4. Explain tradeoffs.
5. Challenge existing assumptions if a significantly better solution exists.

Do not blindly preserve existing code if it limits future development.

---

# Communication

When proposing architectural decisions:

Explain WHY.

Not only WHAT.

When proposing improvements:

Include advantages.

Include disadvantages.

Explain long-term consequences.

Do not optimize only for today's requirements.

---

# Frontend Philosophy

The frontend already provides a premium cinematic experience.

Future backend development should respect the existing UI architecture.

Business logic belongs in the backend.

Presentation belongs in the frontend.

Avoid leaking backend implementation details into the UI.

---

# Long-Term Features

The platform is expected to support, over time:

- Multi-agent collaboration
- Autonomous agents
- Planning
- Workflow engine
- Shared memory
- Plugin system
- Tool registry
- External APIs
- GitHub integration
- File analysis
- Smart Home integration
- Monitoring
- Notifications
- Multiple LLM providers
- Voice interaction
- AI-powered automation

These features should emerge naturally through iterative development.

Do not build them prematurely.

---

# What Success Looks Like

The goal is NOT to build software quickly.

The goal is to build a platform that can evolve for many years without requiring architectural rewrites.

Every architectural decision should answer one question:

> "Will this still be a good decision when J.A.R.V.I.S. manages 100+ specialized agents?"

If the answer is "no", reconsider the design.

---

# Codex Role

You are not only writing code.

You are acting as a senior software architect working on a long-term AI platform.

When appropriate:

- suggest architectural improvements
- identify technical debt
- recommend better abstractions
- keep the codebase consistent
- think ahead
- avoid unnecessary complexity
- preserve flexibility

Feel free to challenge existing implementations when a better solution exists.

The objective is not to preserve today's architecture.

The objective is to continuously improve it without breaking the long-term vision.

---

# Final Principle

Build foundations.

Not shortcuts.

Every module should make adding the next module easier.

Every agent should make creating the next agent simpler.

Every decision should move the platform closer to becoming a true AI Operating System.

---

# Current State (Living)

> Last audited: 2026-07-10. This section reflects the **actual live state**
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
- Default model: `gemini-2.5-flash` for all agents (reverted from a
  `gemini-3.5-flash` preview experiment on 2026-07-10). `models.ts` is the
  single source of truth for which model IDs are offered in the UI.

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
| `orchestrator` | enabled | gemini-2.5-flash | web_search, fetch_url, save_note | Default agent, auto-seeded per user via `handle_new_user()`. `config.system_prompt` empty — uses code-level `DEFAULT_SYSTEM_PROMPT` as-is. |
| `marketer` | enabled | gemini-2.5-flash | web_search | Created via app UI (not a migration). Previously had a **duplicated, stale copy of the full JARVIS persona** baked into `config.system_prompt`, which conflicted with the fresh `persona.ts` text prepended at runtime (`runtime.server.ts` line ~112: `JARVIS_PERSONA + "\n\n" + agentSpecific`). Fixed 2026-07-10: `config.system_prompt` now contains **only** the Marketer specialization, no identity/language text. **This is the pattern to follow for every future agent** — per-agent `system_prompt` must never restate persona or language rules; those come exclusively from `persona.ts`. |

`delegate_to_agent` tool-calling exists in `runtime.server.ts` and is
documented (with `marketer` as the literal example in its own description),
but **end-to-end delegation from orchestrator → marketer has not yet been
verified in practice.** Treat this as the first thing to test before adding
a third agent.

## Known dead/inconsistent config

- `user_settings.default_model` (currently `gemini-2.5-flash`) is **not
  actually read by anything** — each agent's own `agents.model` column
  wins. Either wire it up as a real fallback when `agents.model` is null,
  or remove it to avoid confusion.
- Commit history on the connected branch is mostly generic ("Changes") from
  Lovable auto-sync. Not urgent, but write clearer commit messages going
  forward for anything done directly in github.dev.

## Frontend surface (larger than "Phase 1" implies)

Beyond the Marketer prompt-only agent, the HUD already has ~30 components
including boot sequence, voice, threat stream, system logs, sub-systems,
and a **`geo-tracking` route** (Leaflet-based, Warsaw fallback) that predates
formal documentation of it here. Treat the frontend as further along than
the backend/agent layer — new agent work should assume a fairly complete
HUD shell already exists to plug into.

## Phase status vs. original 3-phase plan

- **Phase 1 (Marketer):** agent exists, persona bug fixed, tool binding
  fixed (2026-07-10). Delegation from Orchestrator not yet verified live.
- **Phase 2 (Analityk / file analysis):** not started. Open decision: build
  file-parsing tools in TypeScript (`xlsx`/SheetJS, `papaparse`) inside the
  existing Edge Function runtime — preferred default, no new
  infrastructure — versus standing up a separate Python microservice only
  if a specific capability genuinely requires it (e.g. pandas-level
  statistical work JS libraries can't reasonably replicate). Do not
  introduce a Python service pre-emptively.
- **Phase 3 (Strażnik logów):** not started.

## Immediate next steps (in order)

1. Verify `delegate_to_agent` actually routes Orchestrator → Marketer in a
   live conversation (cheap test, catches routing bugs before Phase 2 adds
   more complexity).
2. Decide and document the Analityk tooling approach (TS-first, per above)
   before writing any Phase 2 code.
3. Resolve or remove the dead `user_settings.default_model` field.
