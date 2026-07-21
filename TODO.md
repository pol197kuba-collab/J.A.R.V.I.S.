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
>
> **Build-order override (2026-07-20):** items are numbered by when they
> were added/shipped, not strict build order — build **6 → 11 → 12**
> before **8 → 9 → 10**. RAG/Analityk (6), Researcher (11), and Producer
> (12) form one connected pipeline (the flagship "zrób mi prezentację o
> X" demo: RAG grounds Researcher, Researcher feeds Producer), so 11+12
> are treated as **one combined wow milestone**, a deliberate, explicit
> exception to the alternation cadence above rather than an oversight —
> shipping them apart would delay the actual payoff for no technical
> reason, since Concierge/calendar-tools/cleanup (8-10) have no
> dependency on this arc either way. Section numbers themselves are left
> unchanged (already referenced in pushed commit messages) — only the
> build order is reprioritized here, not the file's physical layout.

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

### Second follow-up (2026-07-21): logging coverage audit — Strażnik was mostly blind

User's framing, verbatim reasoning: before giving Strażnik more analysis
tools, the actual bottleneck was that most of the app never wrote to
`system_events` in the first place — no data to analyze regardless of how
good the analysis gets. Full audit done before touching any code (see the
Explore agent's report from this session): of 24 `*.functions.ts` server
functions, only 3 logged anything on failure, and of 16 agent tools in
`tools.server.ts`, only `web_search` had full success+failure coverage.
Two zones were confirmed **architecturally incapable** of ever reaching
`system_events`: `jarvisBrain.ts`'s client-only Gemini fallback path (no
Supabase client ever constructed in that branch) and the entire voice
layer (`VoiceCommandContext.tsx`/`speak.ts`, console-only by construction).

Key finding that shaped the whole fix: `guardian_scan_errors` already
scans `system_events` with `level IN ('warn','error')` and **no `source`
filter** — meaning it needed zero code changes to benefit from more
logging elsewhere. The entire fix is "close the write gaps," not "build
Guardian new tools." This also fixed scope down to error/warn-level
logging only — adding more `info`-level success logs wouldn't even be
visible to Guardian's own scan, so none were added.

Shipped:
- `src/lib/system/logServerError.ts` — shared, non-generic helper
  (`logServerError`/`logServerWarn`) for server-function error branches.
  Deliberately not a `.handler()`-wrapping HOC — this project's
  `createServerFn().middleware().inputValidator().handler()` type
  inference is finicky enough that a generic wrapper risked breaking it
  in ways unverifiable without a working `tsc` in this sandbox. Explicit
  call sites are more repetitive but safe.
- `src/lib/system/logClientEvent.ts` — client-side counterpart wired
  through the existing (previously **zero callers anywhere in the app**)
  `emitSystemEvent` server function. Best-effort/swallows its own
  failures, since a logging call must never break the flow it describes.
- `tools.server.ts`: error-path logging added to every write tool that
  previously logged success only (`fetch_url`, `save_note`, `list_notes`,
  `delete_note`, `remember`, `create_task`, `list_tasks`, `update_task`,
  `delete_task`, `list_documents`), plus the 3 `guardian_*` tools' own
  query failures (previously silent — ironic gap: if Guardian's own
  health-check broke, nothing recorded that). Also stopped `recall` and
  `search_documents` from silently swallowing a failed semantic RPC call
  (`match_memories`/`match_document_chunks` erroring used to vanish with
  zero trace, silently degrading to keyword-only search) — now a `warn`.
- `documents.functions.ts`: `createDocumentFn`/`listDocumentsFn` error
  logging added; `processDocumentFn` now warns when a document processes
  with `0/N` chunks embedded (total semantic-search degradation for that
  document — e.g. an expired Gemini key — previously left zero trace
  anywhere except an unlogged `embeddedCount` field returned to the
  client). **Real bug fix, not just an observability gap**:
  `deleteDocumentFn`'s Storage removal error was previously not even
  checked (result discarded outright) — now checked and logged as a warn
  (DB row delete still proceeds either way — an orphaned Storage object
  is a smaller problem than a document stuck because Storage hiccupped).
- `jarvisBrain.ts`: `logClientEvent` wired into every real failure point
  in the client-fallback path (all-models-exhausted, 4xx, empty
  candidate, JSON-parse-failed-used-raw-text, exception) and into the
  server-runtime-failed-so-falling-back-to-client path, previously
  `console.warn` only.
- `VoiceCommandContext.tsx`/`speak.ts`: genuine failures only — STT
  engine error, `SpeechRecognition` unsupported, TTS engine error (not
  `interrupted`/`canceled`, which are normal e.g. on `speakCancel()`),
  TTS start exception. Deliberately did **not** log the noise-filter/
  wake-word/echo-guard/throttle rejections audited alongside these — that
  is normal, expected, high-frequency filtering behaviour, not a failure,
  and logging it would just be noise Guardian has to scan past.
- `runtime.functions.ts`: every remaining silent `throw` given a
  `logServerError` call first — BYOK key save/delete (Gemini + Groq),
  `updateUserSettings`, `setAgentToolEnabled`, `updateAgentSettings`'s
  previously-silent error branches (it logged success only before),
  `listAgentTools`, `listAgents`, `clearConversation`, `setActiveAgent`,
  `getAgentDetail`, `clearAgentConversations`'s error branches, both key
  status reads, `getUserSettings`.
- `notes.functions.ts`, `tasks.functions.ts`, `flow.functions.ts`,
  `schema.functions.ts`: every function given the same `logServerError`
  treatment — these had zero logging of any kind before (the *tool*
  versions of note/task CRUD already logged; the manual-UI-CRUD versions,
  used by the `/tasks`/`/notes` widgets directly, did not).

Explicitly left alone, on purpose: `GithubActivityPulse.tsx`'s empty
`catch {}` is a pre-existing, comment-documented deliberate decision
("decorative telemetry, not worth surfacing an error state for"), not a
bug — didn't touch it. `WeatherTelemetry.tsx` already has a visible
client-side error state and is low-stakes. flightRadar's `zoom_in`/
`area_too_large` results are expected UX states (user zoomed out too
far), not malfunctions — left unlogged.

Verified via `esbuild` transpile + `node --check` on all 12 touched files
(clean) — same standing sandbox limitation as every round in this
project, `bun install` never fully completed here (persistent tarball
`ConnectionClosed` errors), so no full `tsc`/`eslint`/`vite build` this
round either.

**Confirmed live 2026-07-21** by the user — shipped as PR #36, working.


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

### Third follow-up (2026-07-21): live per-tool-call detail + delegation labels

Requested after using it a while: prettier, more elaborate, and — the
real ask — actually show what an agent is *doing* (Orchestrator's current
action, what it delegated and to whom, what Analityk's doing), with the
description logic scaling automatically as Researcher/Producer and their
tools land later.

Real architectural constraint found before writing anything: `agent_runs.
output.tool_calls` was written exactly once, in bulk, at the very end of
`runOrchestrator` — so the tree could show "running" (pulsing) but
literally nothing about what was happening until the whole run finished.
"What is it doing right now" was structurally impossible with the old
write pattern, not just a missing frontend feature.

Shipped, in two tiers as scoped with the user (Poziom 1 + 2):

- **`runtime.server.ts`**: `agent_runs.output` now patched after *every*
  iteration's tool calls (not only in the final update), `status` staying
  `"running"` throughout — the tree can now show genuine live,
  blow-by-blow progress via its existing 3s poll, not just the complete
  picture after the fact.
- **`flow.functions.ts`**: `FlowRun.toolCalls` now carries each call's
  `args`, not just its `name` (the args were already being logged server-
  side, just never exposed to this endpoint). Added `FlowRun.delegations`,
  extracted separately from `delegate_to_agent` calls (`{toSlug, task}`)
  specifically so the delegated task text can render on the edge to the
  child agent rather than as just another generic tool chip on the parent.
- **`src/components/jarvis/toolDescriptions.ts`** (new) — a small,
  intentionally-flat `tool name -> human description` registry
  (`describeToolCall`), the mechanism that keeps this scaling with future
  agents: Researcher/Producer's new tools need exactly one line added
  here, nothing else in the tree changes. Unknown/future tools fall back
  to a plain `⚙️ {name}` chip rather than breaking or looking empty.
- **`AgentFlowTree.tsx`**: a running node's status line now shows the
  live description of its most recent tool call (e.g. "🔍 szuka w
  dokumentach: „co jest w umowie"") instead of a static "processing…";
  falls back to a new "myśli…" state specifically for the gap before the
  first tool call lands (previously indistinguishable from "doing
  something"). `ToolChips` now render rich per-call descriptions instead
  of raw tool names. A new `DelegationLabel` renders the delegated task
  text on the stem above whichever teammate it was sent to, sourced by
  scanning all currently-active runs for a `delegation.toSlug` match
  (not hardcoded to the Orchestrator specifically, so this stays correct
  without changes if a future agent ever gains delegation ability too).

Deliberately not built this round (scoped out, see "Poziom 3" discussion):
a bigger visual overhaul (radial hub layout, per-node click-to-expand
run history) — the user confirmed starting with the live-data plumbing
(Poziom 1+2) first; the purely-visual polish is a fast follow whenever
picked back up, since the tree's structure/rendering shape doesn't need
to change to add it.

Verified via `esbuild` transpile + `node --check` on all 4 touched files
(clean) — same standing sandbox limitation as every round in this
project (`bun install` never fully completes here), so no full
`tsc`/`eslint`/`vite build` this round.

**Confirmed live 2026-07-21** by the user — live per-tool-call trail and
delegation labels both working as intended.

### Fourth follow-up (2026-07-21): "Poziom 3" — radial hub layout + click-to-expand history

Requested next: make the tree prettier/more elaborate, specifically a
real hub-and-spoke layout (Orchestrator central, teammates radiating
around it) rather than the flat vertical-stem-plus-row layout, plus a
way to see an agent's recent run history. Interviewed on the hub-layout
approach before writing code — chose the fuller radial redesign
(trig-positioned nodes on an arc) over a cheaper "just make the
Orchestrator tile bigger" option, understanding it's more engineering.

**A real geometry bug was caught and fixed before shipping, not after**:
the first version's arc-width/radius/tile-size constants looked
reasonable on paper but numerically overlapped starting at 4 teammates
(verified with a standalone Python trig script, not by guessing) —
adjacent node centers ended up closer together than the tiles are wide.
Re-derived working constants via the same script (searched a grid of
arc-half-angle/radius/tile-width parameters for one that keeps every
adjacent-node chord distance ≥8% wider than the tile at that size,
through 8 teammates) before writing the final component. This directly
serves the "logika rozwija się z kolejnymi agentami" requirement — the
geometry was verified to hold as Researcher/Producer/Concierge get added,
not just eyeballed for today's 3 teammates.

Shipped, `src/components/jarvis/AgentFlowTree.tsx` fully restructured:
- Orchestrator centered near the top of a fixed-height container, visibly
  larger tile (`emphasis` styling — bigger padding/font/dot/glow).
  Teammates positioned via trig on an arc below it (`FlowSpoke` renders
  each connection as a div rotated to the right angle, with the existing
  `animate-flow-dot-travel` dot reused as-is inside it — the dot's local
  `top:0%→100%` animation automatically follows whatever angle its parent
  is rotated to, no new keyframe needed).
- **Explicit, reasoned deviation from a literal full 360° circle**: a
  true full-circle hub would force this compact "quiet"-tone HUD panel
  much taller than every other panel in the dashboard grid (needs room
  for nodes above/beside the hub too, not just below). Used a widening
  arc (50°–85° half-angle) below the hub instead — same "hub with
  radiating spokes" read, without breaking the dashboard's panel rhythm.
  Radius and teammate tile width both scale with roster size per the
  verified geometry above (fixed through 3 teammates, then radius grows/
  tile shrinks together), and mobile applies one flat 0.75 scale factor
  to both so the verified chord/tile-width ratio holds there too.
- **Delegation label placement also adapted, reasoned explicitly**: the
  original plan was a label following the travelling dot on each spoke,
  but at arbitrary fan angles there's no single "above the node" position
  that reads naturally for every teammate (a teammate positioned to the
  side doesn't have text "above" it read sensibly). Moved instead to a
  small list under the hub itself ("▸ deleguje do X: „task"") — reads
  naturally regardless of how many teammates or what angles they're at.
- **Click-to-expand run history** (new `RunHistoryPanel`): clicking any
  tile (now a real `<button>`) toggles a panel below the tree showing
  that agent's last 6 runs — status dot, a one-line summary (delegated
  task if it delegated, otherwise its last tool-call description), and
  latency/status. Pure client-side filter over the `runs` array the tree
  already fetches every 3s — no new data plumbing, no new server load.

**Could not visually verify this round** — same standing sandbox
limitation noted throughout this project (`vite.config.ts` depends on
private `@lovable.dev/*` build packages only resolvable inside the
Lovable-connected environment, and `bun install` never fully completes
here either) — this is a bigger risk than usual to ship unverified given
it's a real layout/geometry change, so the numeric verification above was
done specifically to compensate for not being able to see it render.
Verified via `esbuild`/`node --check` (clean) and careful manual review,
not a live screenshot. **Needs a live check**: confirm nodes don't
overlap at the current 3-teammate roster, the arc reads as a sensible
"hub" shape (not cramped or lopsided), and clicking a tile actually shows
its recent-run history.

### Fifth follow-up (2026-07-21): mobile overlap bugfix + reactor-badge redesign

User confirmed Poziom 3 live, then reported (with a screenshot) a real bug
on a mobile viewport: teammate nodes visibly overlapped each other and the
hub. Separately, asked for a visual redesign — replace the rectangular
tiles with something "computer-robotic", inviting genuinely different
graphics rather than reskinned boxes.

**Root cause of the overlap, found by re-deriving the geometry, not by
re-tuning constants**: the shipped Poziom-3 layout used pure circular
trig — every teammate at the same radius from the hub, only the angle
varying (`dx = r·sin(θ)`, `dy = r·cos(θ)`). My prior numeric verification
before shipping only checked adjacent-node *chord* distance, never
vertical clearance from the hub itself. At wide angles (needed for
horizontal separation as roster size grows, capped at 85°) `cos(θ)→0`,
so `dy→0` too — outer teammates ended up almost level with the hub
instead of below it, which is exactly the "riding up onto the hub"
overlap the screenshot showed. This was a gap in my own verification
method, not something the math check could have caught — it was checking
one necessary condition (spacing between neighbors) while silently
assuming a second, unchecked one (clearance from the hub) would hold.

**Fix — decoupled the two axes so both failure modes become impossible by
construction** instead of something to keep re-tuning by eye:
horizontal spread (`dx`) is now evenly spaced across teammates
independent of vertical position (can never collide sideways by
construction), and vertical drop (`dy`) is floored at
`hubRadius + nodeRadius + margin` for every teammate regardless of how
far out it sits horizontally (can never ride up into the hub), with a
small `bow` term added on top purely for a pleasant curved fan shape.
Re-verified numerically through 8 teammates (both desktop and the
0.75×-scaled mobile case) — this time checking hub-clearance and
neighbor-spacing together, the exact miss from last time.

Given a math-only check had just proven insufficient once already, went
further this round: built a standalone HTML/JS harness reproducing the
exact positioning formulas (not React — just plain divs/CSS, including
the connector lines) for 5 scenarios (the exact reported bug case — 3
teammates, mobile scale — plus 5-teammate and 1-teammate edge cases on
both viewports), and drove it with Playwright (Python, using the
pre-installed Chromium at `/opt/pw-browsers/chromium-1194/...` — `bun`
can't install here but `pip install playwright` could, different
registry) for an independent DOM `getBoundingClientRect()`-based overlap
check plus an actual screenshot, rather than trusting my own JS math a
second time. All 5 scenarios came back clean, and the screenshot
confirmed nodes read as a sensible fan shape with no crowding.

**A second real bug was caught by this same harness-building process**,
this time in the connector lines rather than the node positions: the
spoke `<div>` was anchored at `top: 0` of the container (the very top
edge), but the hub's actual center sits at `top: anchorY` (54px on
desktop, not 0) — so every line from hub to node would have rendered
floating, offset from both endpoints by `anchorY` pixels, never actually
touching the hub or the teammate it's supposed to connect. Fixed by
passing `anchorY` into `FlowSpoke` as its `top` origin instead of
hardcoding 0. Confirmed the fix visually — added spoke rendering to the
same test harness and rechecked the screenshot; lines now originate
exactly at the hub center and terminate exactly at each node.

**Visual redesign** (the "coś komputerowo robotyczne" ask): replaced the
old rectangular tile with a new `ReactorBadge` — a small SVG circular
badge, structurally identical to the existing `MiniArcReactor` centerpiece
(two rings + three rotating triangle polygons + a pulsing core dot) but
with `color`/`size` as explicit props so it can be retinted per node
status (grey=standby, blue=running, green=done, red=error) — something
`MiniArcReactor` itself can't do, since it's hardcoded to `--primary`.
Reuses the exact existing `animate-mini-reactor-spin`/`animate-pulse-core`
keyframes — no new CSS. Every agent node in the tree is now a small
"reactor" instead of a tile, which reads as coherent with the rest of the
HUD's arc-reactor visual language rather than as a bolted-on new style.

Also cleaned up the selection-ring styling while touching this file: an
earlier version overrode Tailwind's internal `--tw-ring-color` CSS
variable directly to retint a `ring-2` utility per-node — recognized as
fragile (relying on an undocumented Tailwind internal), replaced with an
explicit `boxShadow`-based ring instead.

Verified via `esbuild`/`node --check` (clean) plus the Playwright-driven
geometry/overlap/connector harness described above. **Still needs a live
check on both viewports** — the user explicitly said they can't check
desktop right now, so the desktop read is unverified beyond the numeric/
simulated harness; mobile is where the original bug was reported, so that
confirmation matters most and should come first when the user can test.

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

## 6. [F] RAG over personal documents (= Analityk) — **shipped 2026-07-20/21, confirmed working live**

Built per the build-order override above (6 → 11 → 12 ahead of Concierge).
Scope decided 2026-07-20 before writing any code: v1 covers **.txt/.md +
PDF only** (xlsx/csv deferred — no `papaparse`/`xlsx` needed yet), and
document management lives on its own **new `/documents` route** rather
than inside the per-agent console, since documents are a user-wide
resource, not agent-specific.

Extends the proven `memories`/`match_memories` pgvector pattern exactly:
`documents`/`document_chunks` tables (same `vector(768)`/HNSW shape),
`match_document_chunks` RPC (`SECURITY INVOKER` + `auth.uid()` filter,
identical to `match_memories`). Confirmed via a full codebase map before
writing anything (Agent Hub, the chat agent selector, and Agent Flow Tree
all read the `agents`/`agent_tools` tables live — a new `analityk` row
needs **zero frontend code changes** to appear in any of them; the
per-agent tool-toggle console at `/agent-hub/:slug` already accepts an
arbitrary slug, so Analityk's tools are toggleable there with no new UI
either). Voice/text reachability matches Guardian's existing model exactly
— always reachable via Orchestrator delegation, or by switching the active
agent in Agent Hub for direct text chat; there is no per-agent voice
target and building one was out of scope here.

**First use of Supabase Storage in this codebase** — no prior upload
precedent existed, so this shipped the whole pattern from scratch: a
private `documents` bucket, storage policies scoping every object path to
`${user_id}/...`, and a deliberately simple flow (client uploads bytes
directly to Storage under its own session, a server function only ever
handles metadata/extraction/embedding, never raw bytes over a server
function body — this app's server-function runtime has no existing
multipart/base64 handling and introducing one wasn't worth it for v1).

Shipped:
- `supabase/migrations/20260720120000_documents_rag.sql` — schema +
  Storage bucket/policies + `match_document_chunks`.
- `supabase/migrations/20260720120500_analityk_agent.sql` — seeds
  `list_documents`/`search_documents` tools, creates the `analityk` agent
  for every existing user (same 4-part shape as Guardian's migration),
  redeclares `handle_new_user()` for future users.
- `src/lib/agents/tools.server.ts` — `list_documents`, `search_documents`
  (same best-effort semantic-then-keyword-fallback shape as `recall`, two
  plain queries instead of an embedded join per this file's own existing
  discipline against hand-maintained embedded-relation types). `embedText`/
  `toVectorLiteral` exported for reuse (were private to this file before).
- `src/lib/documents/documents.functions.ts` — `createDocumentFn` (reserves
  a `documents` row + storage path), `processDocumentFn` (download →
  extract text [`unpdf` for PDF, chosen specifically because it targets
  edge/serverless runtimes with no native deps — matches this app's
  observed Cloudflare-Workers-shaped deployment] → paragraph-aware chunk →
  batch-embed → store), `listDocumentsFn`, `deleteDocumentFn`.
  **A real bug caught before shipping**: `tools.server.ts` is a
  `.server.ts` module; this file is a `.functions.ts` file, which — per
  `client.server.ts`'s own header comment — ships to the client bundle.
  A top-level `import { embedText } from ".../tools.server"` would have
  been exactly the unsafe pattern that comment warns against. Fixed to a
  dynamic `import()` inside the handler, matching the precedent already
  set by `runtime.functions.ts` doing the same for `runtime.server.ts`.
- `src/routes/documents.tsx` — upload (direct-to-Storage client upload,
  same HUD grid-list style as `tasks.tsx`), status list (uploading →
  processing → ready/error), delete. Sidebar entry added.

**Conservative caps, explicit and documented rather than silently
truncating** (same design language as flightRadar's `area_too_large`
discriminated result): `MAX_FILE_SIZE_BYTES = 3MB`,
`MAX_CHUNKS_PER_DOCUMENT = 40` — chosen tight on purpose, since this
environment's server-function execution budget is a real, previously-
confirmed constraint (flightRadar needed its timeout raised 10s → 25s for
a *single* external call). A document that would exceed the chunk cap
fails explicitly (`documents.status = 'error'`, human-readable message)
rather than silently processing only part of it. Raise the caps once real
processing latency is observed live — deliberately not guessed upfront.

Could not run a full `tsc`/`eslint`/`vite build` in the sandbox this was
built in (persistent `bun install` network/proxy flakiness, unrelated to
this code) — shipped on `esbuild` transpile + `node --check` on every
touched file plus manual review, same standing limitation as every
migration-touching change in this project.

### Follow-up (2026-07-21): two real bugs found live, both fixed same day

Both migrations were pasted into the Supabase SQL editor and the
`analityk` agent appeared correctly everywhere with zero frontend changes,
exactly as the pre-build codebase map predicted. Live testing then
surfaced two **separate** Orchestrator bugs — not anything wrong with the
document pipeline itself (upload → processing → `ready` worked correctly
first try):

1. **Delegation lost to the UI-action instinct.** Asking "co jest w
   dokumencie 1.pdf" made the Orchestrator call `perform_ui_action`
   (opening System Logs, then the fuel/telemetry panel on a retry)
   instead of delegating to Analityk. Root cause: `perform_ui_action`'s
   own instructions are deliberately aggressive ("match by MEANING, never
   refuse") to fight a base-model habit of falsely claiming no UI access
   — but the delegation guidance next to it only ever had one example
   (marketing → marketer), so the brand-new `analityk` target had nothing
   anchoring it and lost to the louder instruction. Fixed: added an
   explicit `analityk` example plus a direct rule ("a question about the
   CONTENT of something is not a UI command") to the delegation guidance
   in `runtime.server.ts`.
2. **A second, independent bug survived fix #1**: the Orchestrator now
   correctly delegated (confirmed in the Agent Ops live feed:
   `DELEGATING → ANALITYK`) and got a real answer — but a *separate*
   fallback classifier pass (a second Groq/Gemini call with no
   conversation history, only ever meant to catch "the model declared a
   tool but talked its way out of using it") still ran afterward, since
   its guard only checked `!uiAction`, not whether any OTHER tool had
   already run. It misclassified the bare text as a UI command and
   overwrote the correct delegated answer. Fixed: widened the guard to
   `!uiAction && toolCallLog.length === 0` — `toolCallLog` is pushed to
   unconditionally for every tool call including `delegate_to_agent`, so
   this reliably skips the classifier whenever the model already took
   real action, without needing to special-case delegation specifically.
   Ordinary chit-chat (no tool call) is unaffected — classifier still
   correctly says "none" for those.

**Confirmed live 2026-07-21** by the user: asking Analityk about an
uploaded document now correctly delegates and answers from the document
content, no stray UI-action hijack. Closes out this item.

### Second follow-up (2026-07-21): same class of bug recurred with a new phrasing

User reported (with a screenshot) that "Uruchom wszystkich agentów jako
demonstrację możliwości" made the Orchestrator call `perform_ui_action`
(`open_agents` → "Otwieram centrum agentów.") instead of doing anything
with the agents; rephrasing to "Uzyj wszysykich agentow, zademonstruj ich
możliwości" worked correctly (delegated to Marketer). Same root cause as
the first follow-up above, different trigger phrase — the fix shipped
then only added one more hardcoded example (document-content questions),
so it didn't generalize to this new phrasing, which matched `open_agents`
by literal keyword overlap ("agentów" ≈ "centrum agentów").

Rather than bolt on a third one-off example, replaced the narrow
document-content example with a **general disambiguation principle** in
`runtime.server.ts`'s delegation guidance: the mere presence of the word
"agent"/"agenci"/"agentów" in a request does not imply the navigational
`open_agents` action — that only applies when the user wants to see/open
the agents *screen*. If the user wants agents to actually **do**
something (demonstrate capabilities, use them, complete a task), that's
`delegate_to_agent`, never `perform_ui_action`, regardless of which UI
action name happens to share a keyword with the request. Also added the
reverse cross-reference to the (deliberately aggressive)
`uiActionInstructions` block so it explicitly yields to delegation when
both are available, and added guidance that a request for "all/multiple
agents" should result in delegating to several teammates in the same
turn (the tool loop already supports up to 12 iterations) rather than
delegating to one and calling it "a good start."

**Could not be tested live in this sandbox** (no working dev server or
Supabase connection here — same standing limitation as every prompt-only
change in this project) — verified via `esbuild`/`node --check` and
careful reading of the full resulting prompt text only. **Needs live
re-confirmation**, ideally with both the exact phrase that failed
("Uruchom wszystkich agentów...") and a couple of unrelated phrasings, to
check whether the general principle actually generalizes this time
rather than needing a fourth one-off patch.

### Third follow-up (2026-07-21): teammate nodes swapping position mid-render

User reported (two screenshots) that after delegating to a single named
agent ("Odpal analityka" — this itself worked correctly: the flow tree
showed a real `delegate_to_agent(analityk, "Rozpocznij pracę")` call, the
vague reply is just a consequence of the vague instruction, not a bug),
the Agent Flow Tree showed Strażnik and Analityk rendered almost directly
on top of each other, and Analityk visibly "suddenly changed position."

Re-derived the layout math for the exact 3-teammate case shown (Marketer/
Strażnik/Analityk, desktop) — the formula gives well-separated positions
with real margin, matching the harness verified in the previous round.
A *static* render should not look like this, which pointed at something
non-deterministic between polls (the tree refetches every 3s) rather
than the geometry formula itself.

**Root cause**: `getAgentFlow`'s roster query
(`src/lib/agents/flow.functions.ts`) ordered agents only by
`created_at`, with no tiebreaker. Guardian and Analityk are each seeded
by their own migration, and if a migration inserts its agent row inside
a single transaction, Postgres's `now()` is frozen for that whole
transaction — so ties are plausible, and even where they aren't,
Postgres does not guarantee stable repeat-query ordering without a fully
deterministic `ORDER BY`. Since the tree's `teammates` array is built
directly from this query's row order and positions are assigned purely
by array index, any reordering between polls reshuffles which screen
position each agent occupies — and because node position changes are
CSS-transitioned (`transition-all duration-500`), a reorder animates as
nodes visibly sliding across each other, exactly matching "the dot goes
to Marketer" and "Analityk suddenly changes position."

Fixed by adding a deterministic secondary sort key (`.order("slug", {
ascending: true })` after the existing `created_at` order) to both
`getAgentFlow`'s roster query and `listAgents`' roster query
(`runtime.functions.ts`, same instability risk for the Agent Hub grid,
fixed proactively for consistency even though not the one reported).
With a fully deterministic order, the teammate array — and therefore
every node's screen position — can no longer change between polls for
an unchanged agent roster.

Verified via `esbuild`/`node --check` on both touched files (clean).
**Could not reproduce or verify the fix live** in this sandbox (no
working dev server/Supabase connection) — needs live re-confirmation
that node positions now stay put across the 3s poll cycle instead of
swapping.

### Fourth follow-up (2026-07-21): mini-arc core CSS bug + system_check shadowing Guardian

User reported three things at once right after the previous fix went out:
Strażnik/Analityk still overlapping in the flow tree, the ReactorBadge's
pulsing core dot visibly shifting position while a node is active
("mini arc core przesuwa się podczas ładowania"), and asking Strażnik to
"wykonaj kontrolę systemu" getting only a generic "wykonuję kontrolę" with
no real findings.

**Confirmed and fixed, both real, root-caused from source (not
guessed):**

1. **Core-dot shift — a genuine, previously-dormant CSS bug.** The shared
   `pulse-core` keyframe (`src/styles.css`) animated `transform: scale(...)`
   directly. A CSS animation's declared `transform` fully replaces the
   element's static `transform` for the animation's whole duration rather
   than composing with it — so on both of its call sites
   (`MiniArcReactor.tsx`'s core dot and the new `ReactorBadge` in
   `AgentFlowTree.tsx`, both centered via `-translate-x-1/2
   -translate-y-1/2`), the moment `animate-pulse-core` starts, the
   centering translate is wiped and the dot snaps off-center by half its
   own size. This bug predates this session's work (it was already latent
   in `MiniArcReactor`, just not noticeable there — a 6px dot is off by
   only ~1.5px) — the new `ReactorBadge` just made it visible for the
   first time, on a bigger/more-scrutinized dot. Fixed by baking
   `translate(-50%, -50%)` into every keyframe step so the animation no
   longer discards it.
2. **`system_check` UI action shadowing Guardian's real diagnostics.**
   `system_check` (`VoiceCommandContext.tsx`) is a purely decorative,
   hardcoded line ("Wszystkie systemy sprawne... Temperatura rdzenia
   nominalna") with zero real content — it predates Guardian and was
   never wired to it. Guardian's actual tools (`guardian_scan_errors`,
   `guardian_run_stats`, `guardian_check_delegation`) DO produce a real
   report, but "wykonaj kontrolę systemu" matches `system_check`'s own
   trigger phrase almost exactly, so the Orchestrator kept calling the
   decorative action instead of delegating — same root cause as the two
   `open_agents`/`perform_ui_action` bugs above, different collision.
   Added an explicit rule to the delegation guidance in
   `runtime.server.ts`: when guardian is on the roster and the user asks
   for a system check/status/health report, always delegate to guardian
   instead of firing `system_check`.

**Not independently re-verified this round — deployment timing is the
prime suspect, not a remaining code bug:** the flow-tree overlap was
reported in the same batch of screenshots as everything else, right
after the ordering fix (previous follow-up) had just merged; the
reactor-badge visuals in that same screenshot already reflect the
earlier PR #40 redesign, so deploys ARE landing, but there's no way from
here to confirm whether *this specific* screenshot was taken before or
after the ordering fix actually redeployed. Re-checked the geometry math
again for the exact 3-teammate case shown and it's still clean given a
stable order, so no separate geometry bug was found. **Needs a live
re-check specifically for this**: if the overlap persists after a hard
refresh (giving the deploy time to land), it's a real remaining bug and
needs the actual live `agents` row `created_at` values inspected next;
if it's gone, it was deploy lag.

### Fifth follow-up (2026-07-21): stopped patching system_check by text, removed it by construction

The Guardian/`system_check` collision survived the previous fix: user
asked "Zapytaj strażnika czy wszystko działa poprawnie" (explicitly
naming Strażnik!) and still got the canned "Wykonuję kontrolę systemu."
with no real content. That's the fourth distinct phrasing (after "co
jest w dokumencie", "uruchom wszystkich agentów", "wykonaj kontrolę
systemu") to defeat a textual carve-out added specifically for the
previous one — a real pattern: the aggressive, unconditional "always
call perform_ui_action, match by meaning" instruction reliably out-argues
any textual exception, regardless of how it's worded or how obviously
the user named a specific agent.

Stopped trying to win that wording race. `system_check` is a hardcoded,
zero-content decorative line that predates Guardian and duplicates
nothing Guardian can't already do better (for real). Once Guardian is on
the roster, the decorative option is strictly redundant *and actively
harmful* — a fake "all good" is worse than useless when a genuine
diagnostic exists one delegation away. Instead of one more instruction,
removed `system_check` from the *declared* action enum outright whenever
an enabled `guardian` teammate exists (`src/lib/agents/runtime.server.ts`,
computed once as `effectiveUiActions`/`effectiveUiActionsWithNone` and
threaded into all three places the enum is declared: the main
`perform_ui_action` tool, and both the Groq and Gemini classifier
fallback passes). With the option gone from the schema, the model has no
way to select it — the collision is now impossible by construction,
matching how the Agent Flow Tree geometry bug was fixed earlier in this
session (structural fix over repeated prompt tuning). Every other UI
action (navigation, sleep/shutdown/reboot, etc.) is untouched — this
only ever removes the one redundant action, and only when its
non-redundant replacement is actually available.

Verified via `esbuild`/`node --check` (clean). **Needs live
re-confirmation** — same standing limitation as every prompt/runtime
change this session (no working dev server/Supabase connection here):
confirm that asking Guardian (by name or by intent) to check the system
now actually delegates and returns real findings instead of the canned
line, across a few different phrasings this time, not just the one
that was just reported.

**Confirmed live 2026-07-21**: user asked Guardian to check the system
and got a real, substantive report ("system generalnie działa... 6%
współczynnikiem błędów dla Orchestratora... Orchestrator wymaga
kalibracji w konstrukcji wywołań narzędzi"), not the canned line — the
enum-removal fix worked. This also validated that Guardian's diagnostic
tools read genuinely real data: checked `runtime.server.ts` and
confirmed there IS a real Gemini→Groq emergency failover for the main
reasoning turn (not just the classifier pass, `catch (geminiErr)` block
around line 441) that gets logged to `system_events` on both success and
failure — so Guardian's report about Gemini overload causing occasional
malformed `perform_ui_action`/`delegate_to_agent` calls from the Groq
fallback is an accurate reading of real logs, not a hallucination. Left
as-is for now (Guardian doing its job correctly is the win here) —
whether to invest in hardening the Groq fallback path itself (stricter
tool-call validation/retry) is a separate, open question for the user to
prioritize, not something to unilaterally change.

### Sixth follow-up (2026-07-21): tool chips spilling into the neighboring node's lane

Same batch of feedback also showed an active node's tool-call chip
("SKANUJE LOGI BŁĘDÓW") visibly overlapping the next node's label.
Confirmed and fixed for real this time: `ToolChips` used a fixed
`max-w-[180px]` container centered on its own node, but adjacent
teammates are only ~76px apart at the current roster size (3) — so a
node's chip row could spill ~90px each side, well past a neighbor's
center. Capped chip width to a fraction of the *actual* computed
inter-node `spacing` instead of a hardcoded constant, so it scales down
automatically as more teammates are added and can't structurally reach a
neighbor's column. Also added a small height buffer to `containerHeight`
so an active node's chip row doesn't get clipped against the panel's own
bottom edge.

Also investigated a second thing from the same screenshot: what looked
like two full `ReactorBadge` shapes stacked near Strażnik's slot (not
chip pills — actual triangle-in-ring badges). Went as far as pixel-level
forensics on the screenshot itself (color-threshold centroid detection
via Python/PIL) to try to pin this down, and ruled out every code-level
cause found by reading the source: not the `pulse-core` transform bug
(already fixed), not a duplicate `<AgentFlowTree>` mount (only one call
site, `routes/index.tsx`), not a key-based remount (`key={t.slug}` is
stable), not `activeBySlug` producing two entries for one slug (it's a
`Map`, physically can't), not a 4th/5th hidden agent (only 4 agent slugs
exist across all migrations). **Could not reach a conclusive code-level
diagnosis from screenshots alone** — this is being left open rather than
guessed at with a 6th speculative patch, given three of the last five
fixes in this arc were reactive one-off guesses that each got defeated.
**Needs targeted live diagnostic info next**, ideally one of: whether it
happens every time a node goes active or only sometimes, whether a hard
refresh clears it instantly, or (most conclusive) a browser DevTools
Elements-panel check for whether there are genuinely two DOM nodes at
that moment.

## 7. [W] Situation Room — **shipped 2026-07-17, flight radar confirmed live 2026-07-20**

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

### Follow-up (2026-07-17): live feedback — "this radar is weak, what are the green dots" + weather had no sky condition or location label

User asked for something real to look at instead of abstract dots, and
for weather to actually say whether it's sunny/cloudy and for where.
Interviewed on the radar direction: chose Flight Radar now (smaller
scope), real weather-precipitation radar on an actual map later as a
separate, bigger project (new mapping library, different visual language
from the rest of the HUD — not a quick add-on).

- **`src/lib/geo/flightRadar.ts`** — real ADS-B aircraft via OpenSky
  Network's free, keyless `states/all` endpoint, bounding-boxed around the
  real geolocation fix (150km range, padded box so circular-radar edges
  aren't clipped by the square bbox). Real bearing (`bearingDeg`) and
  real distance (`haversineKm`) computed from lat/lon — no hash-derived
  placeholder angle this time. Color by altitude band (low = amber,
  mid = cyan, high = green). Verified the OpenSky response shape and every
  field index against a live `curl` response (not assumed from memory of
  the docs) before writing the parser.
- Radar's `contacts` now come from `useFlightContacts` (30s poll,
  disabled until a real fix is locked) instead of `system_events` —
  `SystemPulseStream` (unchanged) remains the right home for that data as
  a ticker, not as abstract radar blips.
- **`WeatherTelemetry.tsx`**: added a `SKY` row (Open-Meteo's
  `weather_code`, WMO table mapped to short labels like "PARTLY CLOUDY" /
  "THUNDERSTORM") and a location name in the panel title via a free,
  keyless reverse-geocode (BigDataCloud's client endpoint) — so it reads
  "WEATHER // Warsaw, Poland" instead of an unlabeled panel. Verified both
  APIs' exact response field names against live `curl` calls.

### Second follow-up (2026-07-17): "still looks like a radar, no aircraft visible, I want a real map I can pan/zoom"

Screenshot showed `AIRCRAFT: 0` — assumed at the time to be the OpenSky
integration working correctly (genuinely nothing in range over Zduńska
Wola). **That assumption turned out to be wrong** — see the third
follow-up below, where it's actually a CORS bug that made the count
permanently 0 in any real browser. At this point in the timeline the
empty stylized SVG radar read as "broken" rather than "empty" regardless,
and it wasn't pannable/zoomable at all, so it got replaced outright with
a real Leaflet map (dark CARTO tiles) instead of layering fake data on
top of it:

- **`src/components/jarvis/TacticalMap.tsx`** — vanilla Leaflet (no
  react-leaflet needed; `leaflet` was already a dependency, unused, and
  `styles.css` already had a `.geo-map` dark/cyan tile-filter class
  prepared for exactly this, apparently left over from an earlier attempt
  that got swapped for the SVG radar). Real pan (drag) and zoom
  (scroll/pinch/double-click) — Leaflet's defaults, no extra work needed.
  Aircraft plotted at their actual lat/lon as rotated triangle markers
  (rotation = real heading), colored by altitude band; hover shows
  callsign/altitude/speed/country. A glowing dot marks the real position.
- **Real bug caught before shipping**: Leaflet touches `window` at
  module-load time, which crashed this app's SSR (every route is
  server-rendered) with `ReferenceError: window is not defined` the
  moment it was statically imported — confirmed via a live sandbox dev
  server run, not assumed. Fixed by making the import client-only: a
  dynamic `import("leaflet")` inside a `useEffect`, keeping only `import
  type * as LeafletNS from "leaflet"` at the top level (type-only imports
  are erased at compile time, so they never reach the SSR bundle). Fixed
  and reverified — the crash was gone and the map rendered correctly
  (confirmed home marker at the mocked coordinates, HUD text overlays
  stacking correctly over the map, Leaflet's own attribution control)
  before this shipped, not after.
- `flightRadar.ts` simplified to return raw `Aircraft` (lat/lon/heading)
  instead of the old radar-projected `angleDeg`/normalized `distance` —
  a real map needs real coordinates, not a bearing-and-range projection.
  `TacticalRadar.tsx` (now fully unused) deleted.
- Map tiles didn't load in this sandbox's screenshot for the same
  established reason as weather/GitHub — the sandbox browser doesn't
  trust the outbound proxy's TLS cert — but the map container, controls,
  and marker positioning all verified correctly against the real (mocked)
  coordinates.

A real precipitation weather radar overlay (RainViewer tiles on this same
map) is now a much smaller add-on than originally scoped, since the real
map/Leaflet groundwork is already in place — worth revisiting sooner than
"separate big project" implied earlier.

### Third follow-up (2026-07-17): map showed pure black, then two real bugs found live

First report: map area was solid black. Root cause (verified, not
guessed): `.geo-map`'s CSS filter was written to invert **light**
OpenStreetMap tiles into a dark HUD look; `TacticalMap` uses CARTO's
`dark_all` tiles, which are already dark, so the same filter crushed them
to near-black. Downloaded a real CARTO tile and rendered it through both
the old and new filter via a local Playwright page (no network needed) —
old = solid black, new (`saturate(1.3) hue-rotate(170deg)`, no
brightness/contrast reduction) = clearly visible. Fixed in `styles.css`.

Second report, after the fix: map itself was visible but zoomed out to a
whole-world view, and `AIRCRAFT: 0` again. Two separate real bugs, not
one:

1. **CORS** — OpenSky Network's REST API doesn't send an
   `Access-Control-Allow-Origin` header for third-party origins (checked
   live: `curl -D -` shows `access-control-allow-origin:
   https://opensky-network.org` — literally only its own domain). A
   browser silently blocks the response no matter what, in every real
   deployment — this was never actually working from the browser, and
   the earlier "genuinely 0 aircraft nearby" read of the first screenshot
   (above) was wrong. The original `curl`-based verification during
   development didn't catch this because `curl` doesn't enforce CORS at
   all — it's purely a browser mechanism. Fixed by routing through a new
   `src/lib/geo/flightRadar.functions.ts` server function
   (`fetchNearbyFlightsFn`, same `requireSupabaseAuth` pattern as every
   other server function in this app) — server-to-server calls have no
   CORS restriction. `situation-room.tsx` now calls it via `useServerFn`.
2. **World-zoom** — near-certainly Leaflet's default `scrollWheelZoom`
   hijacking normal page-scroll as a zoom gesture the moment the cursor
   passes over the map (a well-known Leaflet footgun on scrollable
   pages). Fixed with the standard "click to activate scroll-zoom"
   pattern (`scrollWheelZoom: false` at init, enabled on click, disabled
   on mouse-leave) — pinch and double-click zoom are unaffected. Also
   fixed a related latent bug while in this code: the home-marker effect
   only called `map.setView(...)` on first marker creation, so if the
   real geolocation fix arrived after Leaflet had already centered on the
   `FALLBACK` coordinates, the marker would silently jump to the real
   position but the viewport would stay put — now every `lat`/`lon`
   change recenters the view too.

Could not verify the CORS fix end-to-end in this sandbox — server
function RPC calls don't execute here regardless of auth (an established,
unrelated sandbox limitation from earlier in this project) — verified
instead that the build/typecheck/lint are clean and that the map still
mounts without errors. The `curl`-based CORS header check is real,
independent evidence the fix addresses the actual cause; genuine
confirmation that `AIRCRAFT` now shows nonzero counts needs a live check
by the user once deployed.

### Fourth follow-up (2026-07-17/18): two more real errors read straight from live System Logs, then a real design gap

The error-surfacing added above paid off immediately — every subsequent
round was diagnosed from the actual logged error instead of another
guess:

1. **`The operation was aborted`** — this codebase's own 10s
   `AbortController` timeout firing on every single poll. A direct `curl`
   to the same OpenSky endpoint responded in under 2s from this sandbox,
   so the deployed server's network path to OpenSky (most likely
   Cloudflare Workers egress, given this app's build target) is evidently
   much slower than that. Raised to 25s with real headroom.
2. **`opensky_http_522`** — Cloudflare's own "couldn't reach the origin
   in time" status. 5/5 fresh `curl` requests immediately after all
   succeeded in under 1s each, and OpenSky's response headers include
   `x-rate-limit-remaining` confirming the anonymous tier is capped at
   400 requests/day — confirming this was a transient origin hiccup, not
   a persistent outage, but also surfacing a real latent risk: the 30s
   poll interval could exhaust that daily quota in ~3 hours of one
   continuously open tab. Added `retry: 2` (so one bad poll doesn't flash
   an error) and raised the interval to 90s.

Then a live report that wasn't a bug at all: user zoomed out to see the
whole world and panned around looking for aircraft, found none anywhere.
Root design gap: aircraft were only ever fetched within a fixed 150km
radius of the user's own position, regardless of where the map was
panned/zoomed to — so exploring elsewhere on the map could never show
anything, by construction. Interviewed on the fix: rebuilt as a real
Flightradar24-style viewport-driven tracker instead of a fixed-radius one.

- `flightRadar.ts` reworked: `fetchFlightsInBounds(bounds)` takes an
  explicit `{lamin, lomin, lamax, lomax}` box (Leaflet's own
  `map.getBounds()`) instead of computing one from a lat/lon + fixed
  radius. Returns a `FlightQueryResult` discriminated union (`{ok:true,
  aircraft}` vs `{ok:false, reason:"area_too_large"}`) instead of always
  throwing, so "you're zoomed out too far" reads as a distinct, expected
  state rather than an error.
- `MAX_QUERY_SPAN_DEG = 15` caps the queryable area — refuses to fetch
  (returns the `area_too_large` result) above that span instead of ever
  sending a near-whole-world query to OpenSky, protecting the 400/day
  anonymous quota from being blown by one zoomed-all-the-way-out request.
- `TacticalMap.tsx` now owns the fetch itself (via `moveend`/init
  Leaflet listeners updating a `bounds` state, driving the query) since
  it's the one holding the Leaflet instance the viewport comes from —
  reports status back to `situation-room.tsx` via an `onStatusChange`
  callback (`{kind:"ok"|"error"|"zoom_in", ...}`) rather than the parent
  owning a now-meaningless fixed lat/lon query.
- HUD readout shows a distinct amber "AIRCRAFT: ZOOM IN TO LOAD" for the
  `zoom_in` state, separate from the red "UPLINK ERROR" state — genuinely
  different situations, no longer conflated.

Verified in this sandbox via a live Playwright render simulating a mouse
drag to pan the map (triggering the new `moveend` bounds-update path) —
no crash, no new hydration/SSR errors beyond the pre-existing unrelated
one, layout and HUD overlays intact. Could not verify real aircraft
appear (same RPC-doesn't-execute-here sandbox limitation as before) —
needs a live check once deployed.

### Fifth follow-up (2026-07-20): still 0 aircraft — OpenSky dropped for adsb.lol

Live report: System Pulse full of `OPENSKY FETCH FAILED: OPENSKY_HTTP_522`
on every poll — no longer transient. Diagnosis: the same endpoint answered
200 in ~0.5s, 5/5 attempts, from an ordinary host at the same moment, so
OpenSky itself was fine — the 522 (Cloudflare edge unable to reach
OpenSky's origin) hit only the deployed server's egress path
(Cloudflare-to-Cloudflare). Not fixable from our side by any amount of
timeout/retry tuning, so the provider was swapped: **adsb.lol** (free,
keyless community readsb API — verified live: 42 aircraft within 100nm of
the user's position, ~1s response, richer fields than OpenSky).

- `flightRadar.ts` rewritten for adsb.lol's `v2/point/{lat}/{lon}/{nm}`
  (point + radius, max 250nm — no bbox endpoint): queries the circle
  circumscribing the viewport, then trims the result back to the exact
  bounds. `MAX_QUERY_SPAN_DEG` lowered 15 → 8 accordingly (250nm covers
  ~8° span at mid-latitudes) — the "zoom in to load" UX is unchanged.
  Units converted at the boundary (feet→m, knots→km/h); field mapping
  verified against a live response, not assumed. `Aircraft.originCountry`
  (OpenSky-only) replaced with `registration`/`typeCode` — the map tooltip
  now shows airframe type + registration instead of country.
- Server-function route kept deliberately even though CORS was the
  original reason: provider stays swappable, failures keep landing in
  `system_events` (which is exactly how this bug was diagnosed).
- Same sandbox limitation as every round: server-function RPC doesn't
  execute here, so end-to-end needs a live check after deploy — but the
  upstream API itself was verified live this time, which the original
  OpenSky round never managed from a browser-equivalent path.

### Sixth follow-up (2026-07-20): still 0 aircraft — adsb.lol was rate-limiting

Live report, same day: System Pulse now full of `FLIGHT DATA FETCH FAILED:
ADSB_HTTP_429` instead of the old 522. Diagnosis followed the same pattern
as every round before it: 6/6 rapid requests to the exact same adsb.lol
endpoint from an ordinary host here never hit a rate limit at all, so the
429 is specific to the deployed server's egress path — Cloudflare Workers
shares its IP pool across many tenants' traffic, and adsb.lol's own docs
describe its limits as "dynamic based on environment load" rather than a
fixed per-caller quota, so this isn't necessarily even *our* request rate
tripping it.

Root decision: stop chasing single points of failure one at a time. Added
real **automatic failover between two independent free ADS-B mirrors**
(adsb.lol, then airplanes.live) — same shape as the existing Gemini/Groq
failover elsewhere in this codebase (item 5). Verified airplanes.live live
first: identical `{ac: [...]}` readsb-derived response shape, same field
names, same 250nm point-radius query cap — confirmed field-by-field before
wiring it in, not assumed from the family resemblance. `fetchFlightsInBounds`
now tries providers in order per request and returns whichever answers.

Could not get real dependencies installed in this sandbox this round
(`bun install` repeatedly failed with `ConnectionClosed` mid-download on
unrelated packages, and the sandbox container itself restarted multiple
times mid-install — sandbox network/infra flakiness, not a code issue) —
full `tsc --noEmit`/`vite build` unavailable. Verified instead via an
`esbuild` transpile + `node --check` syntax pass on the touched file
(clean, no errors) and by re-reading the diff directly against both
providers' live-confirmed response shapes. **Needs the normal
tsc/eslint/build gate run once dependencies install cleanly**.

**Confirmed live 2026-07-20**: `AIRCRAFT` now shows real nonzero counts on
the deployed map after this fix — closes out the whole flight-radar arc
that started at item 7's second follow-up.

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

## 11. [W] Researcher agent — deep multi-step web research

Formalizes the idea already noted in `CODEX.md` as the queued second-
wow-gadget slot (previously only mentioned there, not tracked here as its
own item — gap caught 2026-07-20). Complements Marketer (which is
marketing-copy-focused, single-shot) with genuine multi-step research:
follow-up searches, cross-checking sources, synthesizing findings —
reuses the existing `web_search`/`fetch_url` tools already bound to the
Orchestrator, no new tool plumbing required, just a new agent + persona
plus (optionally) a few more search/fetch round-trips per turn than
Marketer typically needs.

Scoped to land **after RAG/Analityk (item 6)** — grounding research
against the user's own documents, not just live web search, is what
makes this genuinely differentiated rather than "Marketer but wordier."
Comes **before Producer (item 12)**: the flagship demo for both agents is
"zrób mi prezentację w nowoczesnym stylu na temat X" — Researcher gathers
and structures the content, Producer compiles it into the actual file.
Orchestrator delegates content-gathering to Researcher, then delegation
to Producer, all via the existing `delegate_to_agent` +
`agent_runs.parent_run_id` chain (proven since Strażnik) — visible live
in Agent Flow Tree with zero new orchestration work.

Wow potential: a live "research trace" panel while it runs — sources
being fetched/read/synthesized in real time, in the same spirit as Agent
Flow Tree's travelling-dot delegation animation, which already proved
that kind of live-process visualization reads well in this HUD.

## 12. [W] Producer agent — document/presentation generation (pptx/docx/pdf)

Content-agnostic "compiler" agent, deliberately not bolted onto Marketer:
generating a file is a generic capability, not a marketing specialization,
and this app's agent philosophy keeps each agent single-purpose (Guardian
= monitoring, Marketer = copywriting). Enables the pipeline discussed
2026-07-20: Orchestrator delegates content-gathering (Marketer and/or
Researcher, item 11) → delegates assembly to Producer. No new
orchestration needed — `delegate_to_agent` + `agent_runs.parent_run_id`
(proven working since Strażnik) already supports exactly this chain, and
it renders live in Agent Flow Tree for free.

Scope, per explicit decision: **one agent, all three formats** — pptx,
docx, and pdf, not a single-format MVP. TypeScript-first per this repo's
established rule (no Python service unless something genuinely requires
it): `pptxgenjs` (pptx), `docx` (Word), `pdf-lib` (PDF) — all pure-JS, no
native dependencies, runnable inside the existing Supabase Edge Function
runtime. Three format-specific tools bound to the agent (or one
`generate_document` tool taking a `format` param) — decide at build time
based on how different the input shapes end up being once actually
building this.

**The one genuinely new architectural piece**: no tool in this app has
ever produced a file before — every tool so far returns text/data through
the same JSON tool-call channel. Needs Supabase Storage (a bucket +
signed URLs) to persist the generated file and hand back a download link
in chat instead.

Ordered after Researcher (item 11) per the "zrób mi prezentację o X" demo
logic: Researcher gathers content, Producer compiles it. Doesn't
strictly *require* Researcher to exist first at a technical level — could
ship standalone and take input from Marketer or directly from the
Orchestrator's own turn — but the intended flagship demo needs both, so
build order follows that.

---

## Long-shot / not scheduled

- **Local device bridge** (desktop automation, local Ollama) — needs a new
  architectural piece (a local companion process talking to
  `device_commands`) before either feature is attemptable at all. Don't
  start this without deciding on the bridge first — see `CODEX.md`
  Architecture constraints.

- **Developer agent — dispatch to a Claude Code Routine** (discussed
  2026-07-20). Explicitly *after* Producer, not before — noted here so the
  idea isn't lost, not queued as a numbered item yet.

  Real mechanism, not speculative: Claude Code Routines support an **API
  trigger** — `POST https://api.anthropic.com/v1/claude_code/routines/{id}/fire`
  with a bearer token — which starts a full, isolated Claude Code cloud
  session (real shell, real repo creation/push, real test execution) and
  returns `{session_id, session_url}` immediately. This is the realistic
  path for "write me a new app, test it, fix bugs" — JARVIS itself never
  gets code/filesystem access (keeps the rule already established for
  Guardian and every other in-app agent intact), it only dispatches to a
  fully separate Anthropic-managed sandbox.

  Shape, if/when picked up: one new tool (`dispatch_build_task` or
  similar) — a single authenticated `fetch`, same complexity class as the
  existing `flightRadar.functions.ts` server function. Bearer token stored
  via the same BYOK pattern as the Groq key (`user_secrets`). Requires a
  **one-time manual setup outside this codebase**: create the Routine
  itself at `claude.ai/code/routines` with a self-contained prompt (can't
  be authored dynamically by JARVIS), add its API trigger, generate the
  token. JARVIS's tool call only ever supplies the `text` field — the
  actual task spec — per dispatch.

  Real constraints to design around, not glossed over:
  - **Experimental/beta** (`experimental-cc-routine-2026-04-01` header) —
    request/response shape and limits may change.
  - **Draws down the user's own Claude subscription usage** (daily
    routine-run cap), not a separate free/metered API budget like Groq —
    a real cost consideration, not "free infrastructure."
  - **Fire-and-forget, not synchronous** — the `/fire` call returns a
    session URL immediately; there's no confirmed API to poll/read the
    finished result back into JARVIS's own chat. First version means
    JARVIS hands back a link and the user opens/reviews/tests it
    themselves — "JARVIS watches it finish and reports back" is not
    currently buildable without a further, unconfirmed capability.
