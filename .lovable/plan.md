Plan wdrożenia ochrony przed zapętleniem Gemini 429:

1. **Wake Word tylko dla mikrofonu**
   - W `VoiceCommandContext.tsx` rozdzielę obsługę wejścia na dwa tryby:
     - `routeVoiceTranscript()` dla mikrofonu,
     - `routeText()` dla czatu.
   - Mikrofon zaakceptuje tylko frazy zaczynające się od `Jarvis`, `Jarvis,`, `Jarvis...`, niezależnie od wielkości liter.
   - Po wykryciu wake word usunę samo słowo `Jarvis` i do Gemini trafi wyłącznie właściwa komenda, np. `otwórz monitor cen paliw`.
   - Frazy bez wake word zostaną całkowicie zignorowane: bez wpisu do czatu, bez `speak()`, bez API.

2. **Filtr szumów po wake word**
   - Dodam walidację komendy głosowej po odcięciu `Jarvis`:
     - minimum 3 znaki,
     - ignorowanie wypełniaczy/szumów typu `eee`, `yyy`, `yym`, `umm`, `hmm`, pojedynczych sylab i pustych komend.
   - Jeśli komenda nie przejdzie filtra, nie zostanie wysłana do Gemini.

3. **Globalny throttle 3 sekundy dla zapytań do Gemini**
   - Dodam wspólną blokadę czasową w `VoiceCommandContext.tsx` dla prawidłowych komend z mikrofonu i czatu.
   - Po wysłaniu jednej komendy do Gemini kolejne żądanie będzie ignorowane przez 3 sekundy.
   - Czat nadal nie będzie wymagał słowa `Jarvis`, ale będzie respektował throttle, żeby nie dało się przypadkowo spamować API.
   - W czacie przy zablokowanym wysłaniu zatrzymam stan „typing”, aby UI nie zostawał w sztucznym ładowaniu.

4. **Ochrona automatycznych triggerów w tle**
   - Sprawdzę miejsca automatycznie wywołujące Gemini:
     - `GlobalIntelFeed.tsx`,
     - `StarkLogin.tsx`,
     - `SubSystemGrid.tsx`.
   - W `GlobalIntelFeed` wzmocnię obecny `ranRef` i interwał tak, aby auto-fetch nie wykonywał się wielokrotnie przy remountach/StrictMode w tej samej sesji.
   - Dla kliknięć modułów dodam jednorazowy guard per moduł/kliknięcie inicjalizacji, żeby szybkie podwójne tapnięcia nie generowały wielu wypowiedzi.
   - Login greeting pozostanie pojedynczym triggerem na udane logowanie.

5. **Bez zmiany logiki czatu i akcji UI**
   - Zachowam obecne zachowanie: tekst z `Transmit Instruction` nadal przechodzi przez ten sam Gemini → `action` → fizyczna akcja UI pipeline.
   - Wake word nie będzie wymagany w czacie.

6. **Weryfikacja**
   - Sprawdzę typy/build.
   - Przetestuję logiczne przypadki:
     - mikrofon: `Dzisiaj będzie pogoda` → ignoruj,
     - mikrofon: `Jarvis, open fuel` → wyślij `open fuel`,
     - mikrofon: `Jarvis eee` → ignoruj,
     - czat: `Podaj przepis na sernik` → działa bez `Jarvis`,
     - szybkie ponowne wysłanie w ciągu 3 sekund → brak kolejnego Gemini requestu.