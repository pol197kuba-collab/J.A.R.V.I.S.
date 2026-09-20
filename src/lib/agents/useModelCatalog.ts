// Wspólne źródło listy modeli dla obu dropdownów (Ustawienia → domyślny
// model, Centrum Agentów → model agenta).
//
// Lista przychodzi z API dostawców (listAvailableModels), a statyczne
// słowniki z ./models.ts służą tylko jako zapas na czas ładowania i na
// wypadek braku klucza — dzięki temu wybór modelu nigdy nie jest pustą
// listą, ale przy działającym kluczu pokazuje dokładnie to, co istnieje.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ANTHROPIC_MODELS, GEMINI_MODELS, type ModelOption } from "./models";
import { listAvailableModels, type CatalogStatus } from "./models.functions";

export const MODEL_CATALOG_QUERY_KEY = ["model-catalog"] as const;

const FALLBACK: ModelOption[] = [...GEMINI_MODELS, ...ANTHROPIC_MODELS];

export type UseModelCatalog = {
  models: ModelOption[];
  gemini: ModelOption[];
  anthropic: ModelOption[];
  geminiStatus: CatalogStatus | "loading";
  anthropicStatus: CatalogStatus | "loading";
  errors: string[];
  isLoading: boolean;
};

export function useModelCatalog(): UseModelCatalog {
  const fetchCatalog = useServerFn(listAvailableModels);
  const query = useQuery({
    queryKey: MODEL_CATALOG_QUERY_KEY,
    queryFn: () => fetchCatalog(),
    // Serwer i tak trzyma własny cache (15 min), więc to tylko oszczędza
    // round-trip przy przełączaniu się między zakładkami.
    staleTime: 10 * 60_000,
  });

  const models = query.data?.models ?? FALLBACK;

  return useMemo(
    () => ({
      models,
      gemini: models.filter((m) => m.provider === "gemini"),
      anthropic: models.filter((m) => m.provider === "anthropic"),
      geminiStatus: query.data?.gemini ?? (query.isLoading ? "loading" : "fallback"),
      anthropicStatus: query.data?.anthropic ?? (query.isLoading ? "loading" : "fallback"),
      errors: query.data?.errors ?? [],
      isLoading: query.isLoading,
    }),
    [models, query.data, query.isLoading],
  );
}

/** Etykieta modelu z listy, z rozsądnym zachowaniem dla ID spoza katalogu. */
export const labelForModel = (models: ModelOption[], id: string): string =>
  models.find((m) => m.id === id)?.label ?? id;
