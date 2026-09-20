// Lista modeli dostępnych dla KLUCZY TEGO UŻYTKOWNIKA, pobierana z API
// dostawców zamiast utrzymywana ręcznie w repo.
//
// Klucze są BYOK i nigdy nie mogą trafić do przeglądarki, więc odpytanie
// idzie przez server function. Wynik jest cache'owany w procesie: lista
// modeli zmienia się raz na tygodnie, a dropdown otwiera się przy każdym
// wejściu w Ustawienia i w Centrum Agentów.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ANTHROPIC_MODELS, GEMINI_MODELS, type ModelOption } from "./models";
import { mergeModelLists, parseAnthropicModelList, parseGeminiModelList } from "./modelCatalog";

const CACHE_TTL_MS = 15 * 60_000;
const TIMEOUT_MS = 10_000;

/**
 * Skąd pochodzi lista danego dostawcy — pokazywane w Ustawieniach, żeby
 * „widzę stare modele" dało się odróżnić od „nie ma klucza" bez zaglądania
 * w logi.
 */
export type CatalogStatus = "live" | "fallback" | "no_key";

export type ModelCatalog = {
  models: ModelOption[];
  gemini: CatalogStatus;
  anthropic: CatalogStatus;
  /** Komunikat błędu, gdy API odpowiedziało, ale nie tym, czym trzeba. */
  errors: string[];
  fetchedAt: string;
};

type CacheEntry = { at: number; value: ModelCatalog };
const cache = new Map<string, CacheEntry>();

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", ...headers },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const listAvailableModels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ModelCatalog> => {
    const { supabase, userId } = context;

    const cached = cache.get(userId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const { data: secret } = await supabase
      .from("user_secrets")
      .select("gemini_api_key, anthropic_api_key")
      .eq("owner_id", userId)
      .maybeSingle();

    const geminiKey = secret?.gemini_api_key?.trim() || null;
    const anthropicKey = secret?.anthropic_api_key?.trim() || null;
    const errors: string[] = [];

    let geminiLive: ModelOption[] = [];
    let geminiStatus: CatalogStatus = geminiKey ? "fallback" : "no_key";
    if (geminiKey) {
      try {
        const raw = await getJson(
          `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(geminiKey)}`,
        );
        geminiLive = parseGeminiModelList(raw);
        // Pusta lista przy poprawnej odpowiedzi to nie sukces — znaczy, że
        // kształt odpowiedzi się zmienił albo klucz nic nie widzi. Fallback
        // jest wtedy uczciwszy niż pusty dropdown.
        if (geminiLive.length > 0) geminiStatus = "live";
        else errors.push("Gemini ListModels nie zwrócił żadnego modelu rozmównego.");
      } catch (err) {
        errors.push(`Gemini ListModels: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let anthropicLive: ModelOption[] = [];
    let anthropicStatus: CatalogStatus = anthropicKey ? "fallback" : "no_key";
    if (anthropicKey) {
      try {
        const raw = await getJson("https://api.anthropic.com/v1/models?limit=100", {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        });
        anthropicLive = parseAnthropicModelList(raw);
        if (anthropicLive.length > 0) anthropicStatus = "live";
        else errors.push("Anthropic /v1/models nie zwrócił żadnego modelu.");
      } catch (err) {
        errors.push(`Anthropic /v1/models: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const value: ModelCatalog = {
      models: [
        ...mergeModelLists(geminiLive, GEMINI_MODELS),
        ...mergeModelLists(anthropicLive, ANTHROPIC_MODELS),
      ],
      gemini: geminiStatus,
      anthropic: anthropicStatus,
      errors,
      fetchedAt: new Date().toISOString(),
    };

    // Cache'ujemy też wynik z fallbackiem — inaczej każde otwarcie dropdownu
    // przy niedziałającym kluczu kosztowałoby kolejne 10 sekund timeoutu.
    cache.set(userId, { at: Date.now(), value });
    return value;
  });

/** Czyści cache listy modeli — wywoływane po zapisaniu/skasowaniu klucza. */
export const invalidateModelCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    cache.delete(context.userId);
    return { ok: true as const };
  });
