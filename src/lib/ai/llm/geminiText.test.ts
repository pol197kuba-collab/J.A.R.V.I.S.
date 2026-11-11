import { afterEach, describe, expect, it, vi } from "vitest";
import { callGeminiText } from "./geminiText";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const req = { apiKey: "k", model: "gemini-2.5-flash", system: "s", user: "u", timeoutMs: 5000 };

function reply(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("callGeminiText", () => {
  it("wyłącza myślenie wewnątrz generationConfig — inaczej zjada budżet odpowiedzi", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(reply({ candidates: [{ content: { parts: [{ text: "[]" }] } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await callGeminiText(req);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(body.thinkingConfig).toBeUndefined();
  });

  it("zwraca tekst i pomija części-myśli", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        reply({
          candidates: [
            { content: { parts: [{ text: "rozważam…", thought: true }, { text: '[{"a":1}]' }] } },
          ],
        }),
      ),
    );
    expect(await callGeminiText(req)).toEqual({ ok: true, text: '[{"a":1}]' });
  });

  it("ucięta odpowiedź to porażka z nazwanym powodem, nie cichy null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        reply({
          candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '[{"a"' }] } }],
        }),
      ),
    );
    const r = await callGeminiText(req);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("MAX_TOKENS");
  });

  it("błąd HTTP niesie status i początek treści", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(reply({ error: { message: "API key not valid" } }, false, 400)),
    );
    const r = await callGeminiText(req);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("HTTP 400");
      expect(r.reason).toContain("API key not valid");
    }
  });
});
