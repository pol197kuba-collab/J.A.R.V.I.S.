# Plan — Pełna inteligencja konwersacyjna JARVIS-a (zatwierdzony)

Throttle: mikrofon **3 s** (bez zmian), czat **1.5 s** (skrócony, świadome działanie).

## 1. `src/lib/ai/jarvisBrain.ts` — głębszy system prompt + dłuższe odpowiedzi

- Przepisać `SYSTEM_PROMPT`:
  - „You ARE J.A.R.V.I.S. — Tony Stark's AI". Brytyjska elegancja, dry wit, lojalność, zwroty „Mr. Slawinsky" / „Sir" (EN) i „Panie Slawinsky" (PL). Zakaz wychodzenia z roli i mówienia, że jest modelem językowym.
  - Bilingual auto-detect (per wiadomość).
  - Bezwzględny nakaz **pełnych, merytorycznych odpowiedzi**: przepisy (składniki + kroki), kod (zwięzły działający snippet w polu `speech`, bez code-fence), żarty (faktycznie opowiedzieć), wyjaśnienia, small-talk. Odmowa benign requestu = błąd.
  - Format JSON `{action, speech}` zachowany. `action` używać **tylko** gdy user wprost prosi o otwarcie/zamknięcie/shutdown; w innych przypadkach `"none"` + cała treść w `speech`.
  - Długość: small-talk 1–2 zdania; merytoryczne odpowiedzi do ~1200 znaków. Nawet przy akcji UI — krótka linijka w `speech`.
- `maxOutputTokens` 200 → **600**.
- `BrainInput` dostaje opcjonalne `source?: "voice" | "chat" | "system"` (przekazywane jako kontekst do user-message, nie do system prompta).
- Po `tryParseJson` dodać `console.debug("[brain] reply", parsed)`.

## 2. `src/components/jarvis/VoiceCommandContext.tsx` — nie gubić `speech`

- Wyodrębnić stałe throttle:
  ```ts
  const GEMINI_VOICE_THROTTLE_MS = 3000;
  const GEMINI_CHAT_THROTTLE_MS  = 1500;
  ```
  `route()` dostaje 2. argument `source: "voice" | "chat"` (default `"voice"` dla kompatybilności) i wybiera próg throttle wg źródła. Queue/dedup logika bez zmian.
- `routeFromMic` → `route(cmd, "voice")`; `routeText` (publiczne API z kontekstu) → `route(text, "chat")`.
- Do `askJarvis` przekazywać `source` (`"voice"` / `"chat"`) i odpowiednio sformatowany prompt („User said via microphone:" vs „User typed in chat:").
- **Klucz**: na końcu `route()` zagwarantować, że `reply.speech` zawsze trafia do TTS — nawet gdy żadna akcja nie pasuje:
  ```
  if (mapped)      fire(mapped, reply.speech)
  else if (local)  fire(local.action, reply.speech)
  else if (reply.speech) speak(reply.speech)
  ```
  (już prawie tak jest — potwierdzić i nie wprowadzać regresji). `emitChat("jarvis", reply.speech)` pozostaje wcześniej, więc czat zawsze widzi pełną odpowiedź.
- W `fire()` case `"dashboard"`: też wymawiać `spokenLine` jeśli przyszedł (obecnie milczy).

## 3. `src/components/jarvis/ChatPanel.tsx` — czytelność długich odpowiedzi

- Bańce wiadomości dodać `whitespace-pre-wrap break-words` aby przepisy/kod zachowały podziały linii i wcięcia. Bez innych zmian.

## Poza zakresem
- Wake-word, debounce, STT lifecycle, sub-systems, sidebar — bez zmian.
- Lokalne regexy `COMMANDS` zostają jako safety-net dla intencji UI; nigdy nie generują tekstu (tekst zawsze z Gemini lub fallbacku).
- Brak nowych paczek.

## Weryfikacja
1. Głos: „Jarvis, opowiedz mi żart" → żart w czacie + TTS, bez nawigacji.
2. Czat: „Podaj przepis na szarlotkę" → pełna lista składników + kroki w bańce, TTS czyta.
3. Czat: „Napisz krótki skrypt w Pythonie liczący liczby pierwsze do 50" → kod w bańce z zachowanymi wcięciami.
4. „Jarvis open fuel" → otwiera Fuel Monitor + JARVIS mówi swoją linijkę.
5. Dwie wiadomości czatu w odstępie 1.6 s → obie przechodzą (throttle 1.5 s).
6. Brak klucza → fallback generyczny działa jak dotąd.

Czekam na build mode, wdrażam od razu.
