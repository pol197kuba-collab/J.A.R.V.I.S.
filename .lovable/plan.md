## Problem
Console is empty — no STT logs at all. The recognition object lifecycle events (`onstart`, `onerror`, `onend`) currently have no logging, and `onresult` only logs after the debounce flushes. If the engine never starts (autostart-without-gesture, permission block, or silent throw), we have zero visibility.

Additionally, the wake-word regex uses `\b...\b` word boundaries with global flag plus a persistent `lastIndex`, which is fragile across calls and rejects Polish phonetic variants like "dżarwis" written without the space-boundary STT produces.

## Fix Plan (single file: `src/components/jarvis/VoiceCommandContext.tsx`)

### 1. Lifecycle logging on `recognition`
Add unconditional logs so we can see the engine's state in DevTools:
```ts
rec.onstart = () => console.log("=== STT ENGINE STARTED ===");
rec.onerror = (err) => console.error("=== STT ENGINE ERROR ===", err);
// keep existing onend behavior but log first:
const prevOnEnd = ...;
rec.onend = () => { console.log("=== STT ENGINE ENDED ==="); /* existing flush + restart */ };
```
Also log at the call site:
- before `rec.start()`: `console.log("[voice] calling rec.start()")`
- inside the catch of `rec.start()`: `console.error("[voice] rec.start() threw", e)`
- when the effect runs / cleans up: `console.log("[voice] effect: enabled=", enabled, "ctor=", !!Ctor)`

### 2. Raw `onresult` visibility
First line of `onresult`:
```ts
console.log("RAW EVENT RECEIVED", e.results, "resultIndex=", e.resultIndex);
```
Placed BEFORE the buffer/debounce logic so events are logged even if debounce later swallows them.

### 3. Tolerant wake-word regex
Replace the global, word-boundary regex with a simple case-insensitive contains-match (no `g` flag, no `lastIndex` state):
```ts
const WAKE_WORD_RE = /(jarvis|jervis|d[zż]arwis|[zż]arwis|dziarwis|czarwis)/i;
```
Rewrite `stripWakeWord` to find the LAST occurrence via a single non-global scan loop (or `.lastIndexOf` on a normalized string), returning the substring after the match. Fall back to returning the trimmed phrase if no wake word matches (kept null-return for ignore path, same as today).

### 4. Start gesture safety
Confirm `rec.start()` is invoked from the effect that runs in response to `setEnabled(true)` (which is itself triggered by the user clicking `HeaderVoiceToggle`). This preserves the user-gesture chain. Add a console log if `enabled` flips true but `Ctor` is null (browser unsupported) so the silence is explained.

### 5. Don't let debounce hide events
Keep the 900ms flush, but the `RAW EVENT RECEIVED` log fires unconditionally before any buffer manipulation. Also log each appended final segment:
```ts
if (r.isFinal) console.log("[voice] final segment:", text);
```

## Out of scope
- No changes to Gemini routing, throttle, ChatPanel, or UI.
- No package installs.

## Verification
After the patch, opening the app and toggling the mic should produce, in order:
1. `[voice] effect: enabled= true ctor= true`
2. `[voice] calling rec.start()`
3. `=== STT ENGINE STARTED ===`
4. On any sound: `RAW EVENT RECEIVED [...]`
5. `=== STT ENGINE ENDED ===` (then auto-restart loop)

If step 3 never appears, the browser is blocking start (permissions or non-gesture context) and we'll know exactly where to look next.
