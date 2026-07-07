
# Agent Hub — konsola agenta z edycją ustawień

Rozbudowa modułu `Agent Hub` tak, żeby każda karta agenta była klikalna i otwierała pełny **Agent Console** — uniwersalny widok działający dla Orchestratora oraz każdego kolejnego agenta, który pojawi się w rejestrze. Zero mocków — dane z `agents`, `agent_runs`, `agent_tools`, `tools`, `conversations`, `memories`, `event_log`. Dodatkowo: możliwość zmiany ustawień agenta z poziomu konsoli — analogicznie do tego, co dzisiaj mamy w `Settings`.

## Propozycja danych w konsoli agenta

**Identity / status (nagłówek)** — nazwa, slug, rola, opis, model, `is_enabled`, `status`, duży sygil-reaktor agenta, uptime od `created_at`, `updated_at` (last config change).

**Telemetria pracy (agregaty z `agent_runs`)** — runs total / 24h / 7d, success rate, avg + p95 latency, suma tokenów in/out, ostatni run, sparkline runs/godz (24h).

**Live activity** — lista aktualnie `running` / `pending` runs, feed 20 ostatnich runs (rozwijalne do pełnego JSON `input`/`output`).

**Narzędzia (`agent_tools` + `tools`)** — lista wpiętych toolów z toggle enable/disable + licznik użyć 24h/7d parsowany z `output.toolCalls`.

**Pamięć & kontekst** — liczba `conversations` + ostatnia aktywność, liczba `memories` per `kind`, link „otwórz w chacie".

**Event log** — filtrowany po `agent_id`/`source = slug` z `event_log` + `system_events`.

## Ustawienia agenta (NOWE — analogicznie do `/settings`)

Osobna sekcja `Agent Settings` wewnątrz konsoli, w tej samej estetyce HUD. Wszystkie zmiany zapisywane per-agent do `agents.config` (jsonb) i kolumn `agents.model` / `agents.is_enabled` / `agents.description`, więc każdy nowy agent automatycznie dostaje ten sam edytor. Zakres:

- **Identity & role** — edycja `name`, `role`, `description` (inline edit z zapisem on-blur, walidacja długości).
- **Model & routing** — wybór modelu (`gemini-2.5-flash` / `gemini-2.5-pro`) — nadpisuje globalny `defaultModel` z `user_settings` per-agent. Toggle „inherit from global" (gdy on, `agents.model = null` i runtime bierze z user_settings).
- **Behaviour (`agents.config` jsonb)** — pola przechowywane w `config`:
  - `systemPromptOverride` (textarea, opcjonalny — nadpisuje personę tylko dla tego agenta)
  - `temperature` (slider 0–1)
  - `maxOutputTokens` (number)
  - `maxToolIterations` (number, obecnie hardcoded MAX_TOOL_ITERATIONS)
  - `voice.language` (`auto|en|pl`) i `voice.enabled` — per-agent override globalnego głosu z `user_settings`
- **Tools** — istniejąca lista `listAgentTools` z toggle per-tool przenoszona z `/settings` do konsoli agenta (jedno źródło prawdy dla tego agenta). W `/settings` sekcja tool bindings zostaje jako skrót, ale link „Manage in Agent Console" przekierowuje do właściwej strony.
- **Lifecycle** — toggle `is_enabled` (kill-switch), przycisk „Reset stats" (miękkie oznaczenie w event_log, bez kasowania runs), przycisk „Clear conversation history" z confirmem (usuwa `conversations` + `messages` tego agenta).

Wszystkie zapisy przez jeden nowy `updateAgentSettings({ slug, patch })` server function z walidacją Zod, `requireSupabaseAuth`, scope po `userId`. Zmiany invalidują `queryClient` (`["agents"]`, `["agent", slug]`).

## Zakres implementacji

**Backend (dwie nowe funkcje w `src/lib/agents/runtime.functions.ts`):**
- `getAgentDetail({ slug })` — jedno RPC zwraca: `agent`, `stats` (agregaty runs 24h/7d/all, avg/p95 latency, tokens), `recentRuns` (20 ostatnich z pełnym JSON), `activeRuns`, `tools` (reuse listAgentTools), `conversations` (count + last 3), `memories` (count per kind), `events` (30 ostatnich).
- `updateAgentSettings({ slug, patch })` — patch dla `name/role/description/model/is_enabled/config.*` z Zod, upsert do `agents`.
- (Pomocniczo) `resetAgentStats({ slug })` i `clearAgentConversations({ slug })` jako osobne akcje.

Zero zmian w schemacie — wszystko mieści się w istniejącej kolumnie `agents.config` (jsonb).

**Frontend:**
- `src/routes/agent-hub.$slug.tsx` — nowa strona konsoli. Layout: nagłówek z sygilem + status, siatka `HudPanel`-i (Telemetry, Live Runs, Tools, Memory, Event Log, **Agent Settings**). Animacja wejścia `animate-hud-tile-in` z opóźnieniami.
- Karty w `agent-hub.tsx` opakowane w `<Link to="/agent-hub/$slug" params={{ slug }}>`, hover podkręca `--glow-primary`.
- Nowy komponent `AgentReactorSigil` — bazuje na `ArcReactorTriangle`/`MiniArcReactor`, deterministyczna wariacja z hasha `slug` (kolor akcentu, liczba pierścieni, prędkość rotacji). Każdy nowy agent dostaje unikalny sygil „za darmo".
- `AgentSettingsPanel` — reużywalny komponent z sekcjami Identity / Model / Behaviour / Tools / Lifecycle. Zapis on-blur (`useMutation` → `updateAgentSettings`) z inline statusem „saved ✓ / saving…". Design 1:1 z `/settings` (HudPanel, HudTag, monospace, semantyczne tokeny).
- `RunDetailDialog` — viewer JSON dla `input`/`output` konkretnego runa (Radix Dialog w skinie `hud-panel`).
- Pusty stan każdej sekcji w stylistyce JARVIS-a.

**Poza zakresem tej iteracji:** tworzenie nowych agentów z UI, ręczne triggerowanie runów, wykresy > sparkline, uprawnienia per-tool per-user.

**Stylistyka:** zgodnie z `CODEX.md` i `styles.css` — semantyczne tokeny, `font-display`, `hud-corner`, `HudTag`, glow z `--glow-primary`. Sygil jako centralny akcent wizualny każdej konsoli.
