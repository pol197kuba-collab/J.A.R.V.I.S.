// Zgodność zapytań z generacjami modeli Gemini (strona Google „What's new in
// Gemini 3.6”, sprawdzona 2026-11-13): od Gemini 3.6 Flash / 3.5 Flash-Lite
// i we wszystkich kolejnych modelach (3.8, 4.x):
//   - `temperature`, `top_p`, `top_k` są wycofane — dziś ignorowane, w
//     kolejnych modelach HTTP 400;
//   - `thinkingBudget` zastępuje `thinkingLevel`;
//   - tura z rolą „function” (wyniki narzędzi) → HTTP 400; idzie jako „user”.
// Wołamy wiele miejsc (agent, wyszukiwanie, wizja, brief), więc dostosowanie
// jest w JEDNYM punkcie: callGemini przepuszcza treść przez tę funkcję.
// Starsze modele (2.x) dostają zapytanie bez zmian.

/** Gemini 3.x / 4.x i nowsze — modele z nowym zestawem parametrów. */
export function isModernGemini(model: string): boolean {
  const m = /^gemini-(\d+)(?:\.(\d+))?/i.exec(model.trim());
  if (!m) return false;
  const major = Number(m[1]);
  return major >= 3;
}

const SAMPLING_KEYS = ["temperature", "topP", "topK", "top_p", "top_k"] as const;

export function adaptGeminiBody(
  model: string,
  body: Record<string, unknown> | string,
): Record<string, unknown> | string {
  if (!isModernGemini(model)) return body;
  const parsed: Record<string, unknown> =
    typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : body;
  let out: Record<string, unknown> = parsed;
  let changed = false;

  // Rola „function” (wyniki narzędzi) — 3.x zwraca HTTP 400 „Role 'function'
  // is not supported” (zgłoszenie 2026-11-13). functionResponse idzie w turze
  // „user”, tak jak w dokumentacji function calling.
  if (Array.isArray(parsed.contents)) {
    const contents = parsed.contents as Array<Record<string, unknown>>;
    if (contents.some((c) => c?.role === "function")) {
      out = {
        ...out,
        contents: contents.map((c) => (c?.role === "function" ? { ...c, role: "user" } : c)),
      };
      changed = true;
    }
  }

  const gc = parsed.generationConfig;
  if (gc && typeof gc === "object") {
    const next: Record<string, unknown> = { ...(gc as Record<string, unknown>) };
    for (const k of SAMPLING_KEYS) delete next[k];
    const thinking = next.thinkingConfig as { thinkingBudget?: number } | undefined;
    if (thinking && typeof thinking === "object" && "thinkingBudget" in thinking) {
      // „Bez myślenia” (budżet 0) = niski poziom; każdy inny budżet —
      // domyślny poziom modelu (pole pomijamy).
      const { thinkingBudget, ...rest } = thinking;
      if (thinkingBudget === 0) next.thinkingConfig = { ...rest, thinkingLevel: "low" };
      else if (Object.keys(rest).length > 0) next.thinkingConfig = rest;
      else delete next.thinkingConfig;
    }
    out = { ...out, generationConfig: next };
    changed = true;
  }

  if (!changed) return body;
  return typeof body === "string" ? JSON.stringify(out) : out;
}
