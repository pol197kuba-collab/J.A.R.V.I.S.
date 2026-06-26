## Plan

### 1. Voice pipeline cleanup (`src/components/jarvis/VoiceCommandContext.tsx`)

- Replace `WAKE_WORD_RE` with the user's exact regex:
  `const WAKE_WORD_RE = /(jarvis|jervis|dżarwis|dzarwis|żarwis|ziarwis|dziarwis|czarwis)/i;`
- In `stripWakeWord`: build a global clone, find the LAST match, return `transcript.slice(lastEnd).replace(/^[\s,.:;!?-]+/, "").trim()`. If no match, return `null`.
- In `flush()`: call `speechBuffer.trim()` (already done) — keep, but also `.trim()` again right before routing.
- In `routeFromMic`: after `stripWakeWord`, run `.trim()` on the command before the noise check (defensive — already done by stripWakeWord, but make explicit).
- In `route()`: just before `askJarvis(...)`, add:
  `console.log("=== SENDING TO GEMINI VOICE CORE ===", transcript);`
- No changes to throttle, debounce, lifecycle logs, or chat path.

### 2. Central command directory

New file `src/data/commandDirectory.ts` exporting a typed list:

```ts
export type CommandEntry = {
  action: JarvisAction;        // from jarvisBrain
  label: string;               // "Open Dashboard"
  phrases: string[];           // example voice/chat phrases
  description: string;         // what it does in the UI
  category: "Navigation" | "Interface" | "System";
};
export const COMMAND_DIRECTORY: CommandEntry[] = [ ... ];
```

Covers every action: `open_dashboard, open_fuel, open_calculator, open_jobfit, open_telemetry, open_menu, close_menu, system_check, sleep, shutdown`.

### 3. Command Directory UI

Add a new section to `src/routes/settings.tsx` (rather than a new route — keeps nav tidy) titled **"JARVIS COMMAND DIRECTORY"** rendered as another `HudPanel`:

- Cyberpunk table: monospace, neon cyan borders, scanline header row.
- Columns: `Action` (code chip), `Label`, `Example phrases` (chip list), `Description`, `Category` tag.
- Data sourced from `COMMAND_DIRECTORY` so future additions auto-render.
- Add a small filter input ("FILTER COMMANDS //") that narrows by label/phrase/description (pure client state).

No new route needed; the existing Settings page already has a HudPanel layout. If a dedicated route is preferred, this can be moved later by importing the same component.

### Out of scope
- Throttle, debounce, wake-word lifecycle architecture (working per RAW logs).
- ChatPanel, Gemini brain, or action mapping logic.
- No new packages.

### Verification
- Toggle mic, say "Jarvis open fuel" → console shows `=== SENDING TO GEMINI VOICE CORE === open fuel` and the Fuel Monitor opens.
- `/settings` route shows the new Command Directory panel listing all 10 actions; filter input narrows the rows live.
