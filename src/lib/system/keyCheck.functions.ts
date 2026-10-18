// Test kluczy dostawców z zakładki ustawień.
//
// Każdy klucz dostaje najtańsze możliwe zapytanie, które naprawdę go
// sprawdza: listę modeli (Gemini, Groq), profil (GitHub), jedno wyszukanie
// (Custom Search, 1 ze 100 darmowych dziennie). Anthropic dostaje
// jednotokenową wiadomość na najtańszym modelu, bo lista modeli przechodzi
// także przy pustym koncie, a brak środków to dokładnie ta awaria, którą
// trzeba wyłapać.
//
// Klucze nie opuszczają serwera — klient dostaje tylko werdykt.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { classifyKeyFailure, REASON_FIX, REASON_LABEL, type ProviderId } from "./providerKeys";

export type KeyCheck = {
  provider: ProviderId;
  status: "ok" | "missing" | "broken" | "unknown";
  /** Krótko, po polsku: co wyszło. */
  detail: string;
};

const TIMEOUT_MS = 10_000;
const ANTHROPIC_PROBE_MODEL = "claude-haiku-4-5";

type Probe = { status: number | null; body: string };

async function probe(url: string, init?: RequestInit): Promise<Probe> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: res.status, body: res.ok ? "" : (await res.text()).slice(0, 600) };
  } catch (err) {
    return { status: null, body: err instanceof Error ? err.message : String(err) };
  }
}

function verdict(provider: ProviderId, p: Probe): KeyCheck {
  if (p.status !== null && p.status >= 200 && p.status < 300)
    return { provider, status: "ok", detail: "Działa." };
  const reason = classifyKeyFailure(provider, p.status, p.body);
  if (reason)
    return {
      provider,
      status: "broken",
      detail: `${REASON_LABEL[reason]}. ${REASON_FIX[reason]}`,
    };
  return {
    provider,
    status: "unknown",
    detail:
      p.status === null
        ? `Brak połączenia z dostawcą (${p.body}). Spróbuj ponownie za chwilę.`
        : `Dostawca odpowiedział HTTP ${p.status} — to raczej chwilowy problem po jego stronie.`,
  };
}

const missing = (provider: ProviderId): KeyCheck => ({
  provider,
  status: "missing",
  detail: "Brak zapisanego klucza.",
});

export const testProviderKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KeyCheck[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_secrets")
      .select(
        "gemini_api_key, anthropic_api_key, groq_api_key, google_cse_api_key, google_cse_cx, github_token",
      )
      .eq("owner_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const gemini = data?.gemini_api_key?.trim();
    const anthropic = data?.anthropic_api_key?.trim();
    const groq = data?.groq_api_key?.trim();
    const cseKey = data?.google_cse_api_key?.trim();
    const cseCx = data?.google_cse_cx?.trim();
    const github = data?.github_token?.trim();

    return Promise.all([
      gemini
        ? probe(
            `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(gemini)}`,
          ).then((p) => verdict("gemini", p))
        : missing("gemini"),
      anthropic
        ? probe("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": anthropic,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: ANTHROPIC_PROBE_MODEL,
              max_tokens: 1,
              messages: [{ role: "user", content: "ping" }],
            }),
          }).then((p) => verdict("anthropic", p))
        : missing("anthropic"),
      groq
        ? probe("https://api.groq.com/openai/v1/models", {
            headers: { Authorization: `Bearer ${groq}` },
          }).then((p) => verdict("groq", p))
        : missing("groq"),
      cseKey && cseCx
        ? probe(
            `https://www.googleapis.com/customsearch/v1?num=1&q=test&key=${encodeURIComponent(cseKey)}&cx=${encodeURIComponent(cseCx)}`,
          ).then((p) => verdict("google_cse", p))
        : missing("google_cse"),
      github
        ? probe("https://api.github.com/user", {
            headers: {
              Authorization: `Bearer ${github}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "jarvis-key-check",
            },
          }).then((p) => verdict("github", p))
        : missing("github"),
    ]);
  });
