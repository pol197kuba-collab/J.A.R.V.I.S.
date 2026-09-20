// Parsowanie list modeli zwracanych przez API dostawców.
//
// Powód istnienia: lista modeli utrzymywana ręcznie zawsze rozjeżdża się z
// rzeczywistością. W tym repo kosztowało to już jedną migrację naprawczą
// (20260710061408 cofa użytkowników z `gemini-3.5-flash`, którego API nie
// przyjmowało) i zostawiło w dropdownie pozycje, których nikt nie
// zweryfikował. Statyczne listy w ./models.ts zostają WYŁĄCZNIE jako
// fallback na wypadek braku klucza albo niedostępnego API.
//
// Plik jest czysty (bez I/O), żeby dał się przetestować na utrwalonych
// próbkach odpowiedzi — sieć siedzi w ./models.functions.ts.
import { ANTHROPIC_PREFIX, type ModelOption } from "./models";

// Modele, które API wylistuje, ale które nie są rozmówcami: embeddingi,
// generatory obrazu/wideo/mowy i warianty „live" wymagające innego
// protokołu. Dropdown wyboru modelu agenta ma pokazywać tylko to, czym
// runtime faktycznie potrafi poprowadzić turę.
const NON_CONVERSATIONAL = /embedding|imagen|image|veo|tts|audio|aqa|live|realtime/i;

type GeminiModelRow = {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  supportedGenerationMethods?: unknown;
  inputTokenLimit?: unknown;
};

const shortenHint = (text: string, max = 60): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/**
 * `GET /v1beta/models` → ModelOption[].
 *
 * Odsiewa wszystko, co nie deklaruje `generateContent` — bez tej metody
 * model nie obsłuży tury rozmowy, więc pokazanie go w dropdownie kończyłoby
 * się błędem 400 dopiero przy pierwszej wiadomości.
 */
export function parseGeminiModelList(raw: unknown): ModelOption[] {
  const rows = (raw as { models?: unknown })?.models;
  if (!Array.isArray(rows)) return [];

  const out: ModelOption[] = [];
  for (const row of rows as GeminiModelRow[]) {
    if (typeof row?.name !== "string") continue;
    // API zwraca "models/gemini-2.5-flash"; runtime używa samego id.
    const id = row.name.replace(/^models\//, "").trim();
    if (!id || NON_CONVERSATIONAL.test(id)) continue;

    const methods = Array.isArray(row.supportedGenerationMethods)
      ? row.supportedGenerationMethods.map(String)
      : [];
    if (!methods.includes("generateContent")) continue;

    const label =
      typeof row.displayName === "string" && row.displayName.trim() ? row.displayName.trim() : id;
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const tokens = typeof row.inputTokenLimit === "number" ? row.inputTokenLimit : null;

    out.push({
      id,
      label,
      provider: "gemini",
      hint: tokens
        ? `Kontekst ${Math.round(tokens / 1000)}k`
        : description
          ? shortenHint(description)
          : undefined,
    });
  }

  // Stabilna, przewidywalna kolejność — API nie gwarantuje żadnej, a lista
  // skacząca między odświeżeniami jest nie do wyboru myszą.
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

type AnthropicModelRow = { id?: unknown; display_name?: unknown; created_at?: unknown };

/**
 * `GET /v1/models` → ModelOption[]. Identyfikatory dostają prefiks
 * "anthropic:", bo to on routuje turę do adaptera Claude (patrz
 * parseModelRef w ./models.ts).
 */
export function parseAnthropicModelList(raw: unknown): ModelOption[] {
  const rows = (raw as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];

  const out: ModelOption[] = [];
  for (const row of rows as AnthropicModelRow[]) {
    if (typeof row?.id !== "string" || !row.id.trim()) continue;
    const id = row.id.trim();
    if (NON_CONVERSATIONAL.test(id)) continue;
    out.push({
      id: `${ANTHROPIC_PREFIX}${id}`,
      label:
        typeof row.display_name === "string" && row.display_name.trim()
          ? row.display_name.trim()
          : id,
      provider: "anthropic",
      hint:
        typeof row.created_at === "string" ? `Wydany ${row.created_at.slice(0, 10)}` : undefined,
    });
  }

  // Anthropic zwraca najnowsze pierwsze i ta kolejność jest użyteczna —
  // zachowujemy ją zamiast sortować alfabetycznie.
  return out;
}

/**
 * Scala listę z API z listą zapasową: pozycje z API wygrywają, a te ze
 * statycznego słownika, których API nie zwróciło, dopisywane są na końcu.
 *
 * Dzięki temu model ustawiony wcześniej ręcznie nie znika z dropdownu tylko
 * dlatego, że akurat nie ma klucza albo API nie odpowiedziało — a
 * jednocześnie przy działającym kluczu widać dokładnie to, co jest dostępne.
 */
export function mergeModelLists(live: ModelOption[], fallback: ModelOption[]): ModelOption[] {
  const seen = new Set(live.map((m) => m.id));
  return [...live, ...fallback.filter((m) => !seen.has(m.id))];
}
