
# Krok 2 — Agent Runtime (silnik AI)

Cel: dołożyć do J.A.R.V.I.S. serwerowy „Agent Runtime" — fundament pod Orchestratora i przyszłe agenty (Architect, Developer, itd.) opisane w `CODEX.md`. Równolegle: pierwsze realne opcje w `Settings` i pierwszy krok odchodzenia od mocków.

---

## 0. Koszty — najważniejsze na start

Chcesz maksymalnie darmowo. Trzy realistyczne opcje silnika LLM:

| Opcja | Koszt dla Ciebie | Uwagi |
|---|---|---|
| **A. Twój klucz Google Gemini (BYOK)** — już masz go w `localStorage` | **0 zł** (darmowy tier Gemini) | Rekomendowane na teraz. Trzeba go tylko przenieść tak, żeby dosięgnął serwera. |
| B. Lovable AI Gateway (`LOVABLE_API_KEY`) | **Płatne z Twoich kredytów Lovable** | Wygodne, ale nie „darmowe". Wymagałoby Twojej zgody. |
| C. Lokalny model (Ollama itp.) | 0 zł | Wymaga Twojego komputera jako backendu — nie działa z Lovable Cloud. |

**Propozycja: A (BYOK).** Nic płatnego się nie włącza. Jeśli w przyszłości zechcesz przejść na B (np. dla streamingu / lepszych modeli / limitów), zaproponuję to osobno i **zapytam przed włączeniem**.

Pytanie do potwierdzenia po planie: **czy zaczynamy od A**, czy chcesz od razu B?

---

## 1. Jak to będzie działać (architektura)

Zgodnie z `CODEX.md`: modularny monolit, agenci to komponenty, Orchestrator koordynuje, nie ma logiki biznesowej w UI.

```text
                ┌─────────────────────────────────────┐
   UI (React)   │ ChatPanel / VoiceCommandContext     │
                └───────────────┬─────────────────────┘
                                │ createServerFn (RPC)
                                ▼
                ┌─────────────────────────────────────┐
                │ Agent Runtime  (serwer, TanStack)   │
                │  ├─ Orchestrator  (routing zadań)   │
                │  ├─ Agent Registry (kim są agenci)  │
                │  ├─ LLM Provider  (Gemini adapter)  │
                │  ├─ Tool Registry (echo, time, ...) │
                │  └─ Memory (Supabase: runs/messages)│
                └───────────────┬─────────────────────┘
                                │
                                ▼
                       Supabase (Lovable Cloud)
                       agents / runs / run_messages
```

Ścieżka jednego żądania:
1. UI woła `runAgent({ agentId, input })` (server function).
2. Orchestrator znajduje agenta w rejestrze, ładuje jego rolę + narzędzia + pamięć krótkoterminową z DB.
3. LLM Provider (adapter Gemini) wykonuje wywołanie modelu — na razie **jeden krok, bez tool-callingu**, żeby nie budować za dużo na raz.
4. Odpowiedź + metadane (tokens, latency, status) zapisywane w `runs` / `run_messages`.
5. UI dostaje wynik i renderuje w istniejącym `ChatPanel` / kafelku Agent Hub.

**Co dostajemy już teraz:** realne uruchamianie agenta z DB, historia rozmów w bazie, fundament do rozbudowy o tool-calling, multi-agent, planer i Orchestratora sensu stricto — bez rewrite'u.

**Czego świadomie NIE robimy w tym kroku** (żeby zostać w zasadzie „simple today, scalable tomorrow"):
- multi-step tool loop / agent-as-graph,
- streaming SSE,
- pamięć wektorowa,
- planer (agent Architect będzie osobnym krokiem),
- system uprawnień per-tool.

Każde z powyższych to naturalny kolejny krok, do którego runtime jest już przygotowany.

---

## 2. Zmiany w bazie (Lovable Cloud)

Nowa migracja z 3 tabelami + GRANT + RLS (wszystko scope'owane po `auth.uid()`):

- `public.agents` — `id`, `owner_id`, `slug` (`orchestrator`, `architect`, `developer`…), `name`, `role`, `system_prompt`, `model` (domyślnie `gemini-2.5-flash`), `enabled`, timestamps. Seedujemy jednym rekordem: `orchestrator` z promptem „koordynujesz odpowiedzi J.A.R.V.I.S.".
- `public.agent_runs` — `id`, `owner_id`, `agent_id`, `status` (`queued|running|done|error`), `input`, `output`, `error`, `tokens_in`, `tokens_out`, `started_at`, `finished_at`.
- `public.agent_run_messages` — `id`, `run_id`, `role` (`system|user|assistant|tool`), `content`, `created_at` (do przyszłej pamięci konwersacyjnej).

Sekret klucza Gemini: nowa tabela `public.user_secrets` (`owner_id`, `gemini_api_key`, RLS: właściciel). Klucz nadal wpisujesz w Settings, ale trafia do DB — dzięki temu server function może go użyć bez wystawiania czegokolwiek do przeglądarki.

Wszystko z `GRANT ... TO authenticated` + `service_role`, RLS w formie `owner_id = auth.uid()`.

---

## 3. Kod aplikacji

Nowe pliki (serwer):
- `src/lib/agents/registry.functions.ts` — `listAgents`, `getAgent`.
- `src/lib/agents/runtime.functions.ts` — `runAgent({ agentId, input })` (główne API).
- `src/lib/agents/runtime.server.ts` — logika Orchestratora + wywołanie LLM (nie eksportowana do klienta).
- `src/lib/agents/providers/gemini.server.ts` — cienka warstwa nad REST Gemini, używa klucza z `user_secrets`.

Wszystkie chronione middleware `requireSupabaseAuth`; klucz Gemini nigdy nie wraca do klienta.

Frontend:
- `Agent Hub` (`src/routes/agent-hub.tsx`) — zamiast mocków z `data/mock.ts` pokazuje agentów z DB (`useSuspenseQuery`), status z ostatnich runów.
- `ChatPanel` / `VoiceCommandContext` — obok obecnej ścieżki „bezpośrednio do Gemini z przeglądarki" (BYOK w localStorage) dodajemy przełącznik: gdy user ma zapisany klucz w DB, chat routuje przez `runAgent` (serwer). Fallback do dzisiejszej ścieżki zostaje — nic się nie psuje.

Mocki: **etap 1** — tylko `agents` z `data/mock.ts` znika (zastąpione DB). `activeTasks`, `systemStats`, `systemLogs`, `bootLogs`, `threatStream` zostają na razie — usuniemy je w kolejnych krokach, wraz z pojawianiem się realnych źródeł (np. `activeTasks` = realne `agent_runs`).

---

## 4. Realne Settings

Ekran `src/routes/settings.tsx` przestaje być listą ozdobników. Zostawiamy design (HudPanel), zmieniamy treść na to, co **faktycznie coś robi**:

- **AI Core** (rozbudowa istniejącej sekcji):
  - Klucz Gemini — zapisywany do `user_secrets` (serwer), z lokalnym cache; status „linked" pobierany z serwera.
  - Wybór domyślnego modelu (`gemini-2.5-flash` / `gemini-2.5-pro`) — zapis do `profiles` lub `user_settings`.
  - Toggle „Route chat through Agent Runtime" (on = serwer, off = obecna ścieżka BYOK z przeglądarki).
- **Audio** — zostaje, już jest realne.
- **Voice Interface** — realny toggle wake-word (steruje `VoiceCommandContext`) + wybór języka odpowiedzi (PL/EN/auto).
- **Profile** — display name z `profiles`, edytowalne.
- **Sekcje mockowe** (Security / Integrations / Discord itd.) — **usuwamy** z tego widoku i przenosimy do `docs/roadmap.md` jako „planned", żeby nie udawać funkcjonalności, której nie ma. Zgodnie z Twoją prośbą o odejście od mocków.

Wszystkie zmiany zapisywane do nowej tabeli `public.user_settings` (`owner_id` PK, `chat_routing`, `voice_language`, `wake_word_enabled`, `default_model`) z RLS.

---

## 5. Kolejność wykonania

1. Migracja: `agents`, `agent_runs`, `agent_run_messages`, `user_secrets`, `user_settings` (+ GRANT + RLS) + seed agenta `orchestrator`.
2. Serwerowy runtime + provider Gemini (BYOK z `user_secrets`).
3. Refactor `Settings` na realne opcje (bez mocków).
4. Podpięcie `ChatPanel` pod `runAgent` (za feature-flagą z Settings).
5. `Agent Hub` czyta z DB.
6. Ręczna weryfikacja: login → Settings (wpisanie klucza + włączenie routing) → chat → widoczny run w Agent Hub.

---

## 6. Co wymagałoby Twojej decyzji przed dalszymi krokami

- Zmiana silnika na Lovable AI Gateway (płatne z kredytów) — zapytam osobno.
- Streaming odpowiedzi (SSE) — działa lepiej z Gateway, więc wróci przy powyższym pytaniu.
- TTS przez chmurę zamiast wbudowanego Web Speech — płatne, poproszę o zgodę.

Na tym etapie **nic płatnego się nie włącza**.
