## Change

`src/lib/ai/jarvisBrain.ts` line 11 — replace the model id in the endpoint URL only:

```
- https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
+ https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
```

No other files reference `gemini-2.0-flash`. No other logic, prompts, UI, or files change.

## Answer about your API key security

**No — this app is not connected to Supabase / Lovable Cloud, and your Gemini key is NOT secured server-side.** The entire Gemini integration lives in the frontend:

- `src/lib/ai/jarvisBrain.ts` calls `https://generativelanguage.googleapis.com/...?key=YOUR_KEY` directly from the browser.
- The key is read from `localStorage["jarvis_gemini_api_key"]` (pasted in Settings) or `import.meta.env.VITE_GEMINI_API_KEY` — both end up bundled/visible in client JS and visible in DevTools → Network on every request.
- Anyone using your published site, or inspecting network traffic, can read the key out of the request URL. On a personal device with only your own key in `localStorage`, the practical risk is limited to you, but on the published URL anyone who pastes their own key is also exposing it to themselves only — the architecture itself is client-side.

If you want it actually secured, the proper fix (separate task, not part of this surgical change) is: enable Lovable Cloud, move the Gemini call into a server function / edge function that holds the key as a server secret, and have the browser call your function instead of Google directly. Want me to plan that next?
