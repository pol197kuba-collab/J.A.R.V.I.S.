## JARVIS Vision — Etap 1: warstwa wizualna

Nowy moduł `/vision` z podglądem kamery w stylu HUD. Bez AI, bez backendu, bez nowych zależności.

### Nowe pliki

**`src/routes/vision.tsx`**
- `createFileRoute("/vision")` z pełnym `head()` (title, description, og:*).
- Renderuje `<VisionScanner />` w spójnym wrapperze (wzorem `geo-tracking.tsx`).

**`src/components/jarvis/VisionScanner.tsx`**
- `getUserMedia({ video: { facingMode: { ideal: "environment" } } })` — tylna kamera na mobile, fallback na dowolną na desktopie.
- Cleanup: zatrzymanie wszystkich tracków przy unmount.
- Stany: `loading | ready | denied | unavailable` — komunikaty HUD (`font-display`, uppercase, tracking-wide, kolory `--primary`/`--warning`/`--destructive`, mrugająca kropka).
- Owinięcie w `HudPanel` z `title="OPTICAL FEED // LIVE"` + `HudTag`.
- Overlay skanera: cztery narożne bracket-y (celownik) w primary + glow, animowana pozioma linia skanująca (translateY 0→100%→0, ~3s infinite), subtelny inner glow.
- Przycisk **SCAN** pod ramką (styl spójny z `RebootButton`/`DeactivateButton`, font-display uppercase, border+glow primary), disabled gdy nie `ready`.
- onClick: `audio.playClick()`, `canvas.drawImage(video)` → `toDataURL("image/jpeg", 0.85)` → `setLastCapture(...)`, animacja flash ~450ms (biały overlay fade + pulse ramki). Thumbnail ostatniej klatki w rogu.
- `lastCapture` trzymany w state — gotowy pod etap 2.

### Edycje

**`src/components/jarvis/AppSidebar.tsx`**
- Nowa pozycja: `{ title: "Vision", url: "/vision", icon: Eye }` (Eye z `lucide-react`), między "Geo-Tracking" a "System Logs". Ten sam styl i handler co reszta.

**`src/styles.css`**
- Keyframes + utility: `vision-scan` (linia skanująca) i `vision-flash` (capture flash).

### Responsywność
- Kontener kamery `aspect-[3/4]` na mobile portrait, `aspect-video` od `md`, `max-h-[70vh]`. Button SCAN sticky w obrębie panelu — cały widok mieści się na telefonie (uwzględniam projektową regułę `short:`).

### Nie dotykam
- `runtime.server.ts`, `runtime.functions.ts`, `persona.ts`, `jarvisBrain.ts`, `models.ts`, migracji, secretów.
- `geo-tracking.tsx` zostaje.
- Bez nowych npm packages.
- Zero integracji AI od Lovable (żadnego AI Gateway) — nigdzie w projekcie.

### Etap 2 (poza tym planem)
Ręczna integracja z Gemini bezpośrednio w `runtime.server.ts` (własne wywołanie API), wysyłka `lastCapture` i render odpowiedzi w HUD.
