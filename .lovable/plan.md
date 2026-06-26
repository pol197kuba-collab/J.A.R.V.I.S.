
# Plan — naprawa naturalności rozmowy z JARVIS-em (v2, z wzmocnieniami)

Na screenie odpowiedzi „Understood. Standing by." i „Acknowledged, Mr. Slawinsky." to **dosłowne stringi z `FALLBACK_GENERIC`** w `src/lib/ai/jarvisBrain.ts`. `askJarvis()` nie dociera do Gemini albo nie parsuje odpowiedzi — i robi to całkowicie po cichu (`catch { return fb(); }`). Drugi problem: każde zapytanie idzie **bez historii rozmowy**, więc JARVIS nie pamięta poprzednich tur.

## 1. `src/lib/ai/jarvisBrain.ts` — diagnostyka, pamięć, twardszy parser

- Rozszerzyć `BrainInput` o `history?: Array<{role:"user"|"jarvis"; text:string}>`.
- Mapować historię na `contents` Gemini: `user → role:"user"`, `jarvis → role:"model"`, każda jako `{parts:[{text}]}`. Bieżący prompt doklejany na końcu jako `role:"user"`.
- **Widoczne błędy** zamiast cichego fallbacku:
  - `console.warn("[brain] gemini failed", status, bodyText)` przy `!res.ok`.
  - `console.warn("[brain] parse failed", text)` gdy `tryParseJson` zwraca null.
- **Twardszy parser**: gdy odpowiedź jest plain-textem bez JSON-a, zwracać `{action:"none", speech:text}` zamiast fallbacku (typowa przyczyna „Acknowledged…" przy „daj przepis na ciasto").
- `maxOutputTokens` 600 → **1200** (przepisy/kod się ucinały).
- **System prompt — wzmocnienie #1 (rygor JSON)**: dodać twardą instrukcję, że klucze MUSZĄ być małymi literami i dokładnie `"action"` / `"speech"` — żadnych `Action`, `SPEECH`, `reply`, `text`. Dorzucić przykład poprawny + przykład niepoprawny.
- System prompt — utrzymać zakaz markdown code-fences, długie odpowiedzi w `speech` jako plain text.

## 2. `src/lib/ai/chatBus.ts` — helper pamięci (wzmocnienie #2)

- Eksport `getRecentHistory(n=10)` czytający `localStorage["jarvis_chat_history"]` (ten sam klucz, którego używa `ChatPanel`).
- **Filtr czystej historii**: pomijać puste teksty oraz wszystko, co wygląda na surowy JSON z potoku (`{` … `"action"` … `"speech"` … `}`). Do Gemini trafia wyłącznie czysty tekst użytkownika i czysty `speech` asystenta — bez śmieci protokolarnych.
- Trzymać tylko ostatnie `n` (default 10) wpisów po filtracji.

## 3. `src/components/jarvis/VoiceCommandContext.tsx` — przekaż historię

- Przed wywołaniem `askJarvis` w `route()` wywołać `getRecentHistory(10)` i przekazać jako `history`.
- Nic więcej nie ruszać (throttle, wake-word, queue, fire — bez zmian).

## 4. Widoczna diagnostyka braku klucza (UX)

- Gdy `hasGeminiKey()` jest `false`, `route()` jednorazowo (per sesja, flag w ref) emituje na chat: „⚠ AI core offline — add Gemini key in Settings to enable natural conversation." Zamiast w nieskończoność produkować „Standing by."

## Poza zakresem

- Throttle (3s mic / 1.5s chat), wake-word, STT lifecycle, sidebar, sub-systems — bez zmian.
- Migracja na Lovable AI Gateway — nie ruszamy (klucz Gemini wklejany w Settings).

## Weryfikacja

1. Klucz wpięty, „co u ciebie" → JARVIS odpowiada w charakterze.
2. „daj przepis na ciasto" → pełny przepis ze składnikami i krokami (zachowane `\n` dzięki `whitespace-pre-wrap`).
3. „a teraz coś bez jajek" → odnosi się do poprzedniego przepisu (test pamięci).
4. W konsoli `localStorage.getItem("jarvis_chat_history")` po kilku turach — żadnych stringów `{"action":...}` w polach `text` przekazywanych do Gemini.
5. Brak klucza → jedna systemowa linijka w czacie zamiast cichych fallbacków.
6. Wymuszony błąd (zły klucz) → w konsoli `[brain] gemini failed 400 …`.
