// PORANNY BRIEFING — złożenie i zapis. Warstwa, która łączy trzy rzeczy:
// fakty z bazy, czyste składanie tekstu i (opcjonalnie) przepisanie go przez
// model na zdania, które brzmią jak zdania.
//
// MODEL JEST DODATKIEM, NIE WARUNKIEM. Briefing powstaje zawsze — z samych
// liczb. Kiedy jest klucz i model odpowie, dostajemy lepszy język przy tej
// samej treści. Kiedy nie odpowie, rano nie ma komu tego zauważyć, więc
// awaria modelu nie może znaczyć „dziś briefingu nie ma".
//
// MODEL DOSTAJE GOTOWY TEKST, NIE SUROWE LICZBY. To jest celowe: nie ma go
// prosić o wyciąganie wniosków z danych, bo wtedy zacząłby je wymyślać tam,
// gdzie ich brak. Ma przepisać zdania, które już są prawdziwe. Gdyby wynik
// okazał się podejrzany (za długi, pusty, w innym języku), wracamy do wersji
// z liczb — i to jest jedyny sposób, w jaki model może tu zaszkodzić.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { callAnthropic } from "@/lib/ai/llm/anthropic";
import type { GeminiContent } from "@/lib/ai/llm/types";
import { callGemini } from "@/lib/ai/llm/gemini";
import type { LedgerContext } from "@/lib/ai/llm/ledger";
import type { GeminiUsageMetadata } from "@/lib/ai/llm/usage";
import { notifyOwner } from "@/lib/notifications/notify.server";
import type { PushResult } from "@/lib/notifications/push.server";
import { composeBrief, sectionsToSpoken } from "./compose";
import { gatherFacts } from "./facts.server";
import type { BriefSection, ComposedBrief, DailyBrief } from "./types";
import { DEFAULT_GEMINI_MODEL } from "@/lib/agents/models";

type Db = SupabaseClient<Database>;

export type BriefKeys = { anthropicApiKey: string | null; geminiApiKey: string | null };

const MODEL_TIMEOUT_MS = 30_000;
const ANTHROPIC_BRIEF_MODEL = "claude-sonnet-5";
const GEMINI_MODEL = DEFAULT_GEMINI_MODEL;

/** Ile znaków wolno mieć wersji mówionej. Powyżej tego to już nie briefing. */
const MAX_SPOKEN_CHARS = 900;

/** Powitanie dłuższe niż to nie jest powitaniem, tylko drugim briefingiem. */
const MAX_GREETING_CHARS = 320;

/**
 * Znaczniki, którymi model oddaje dwa kawałki w jednej odpowiedzi.
 *
 * DLACZEGO JEDNO WYWOŁANIE, A NIE DWA. Powitanie i treść mają różne reguły
 * (jedno wolno napisać swobodnie, drugiego nie wolno skrócić), więc muszą
 * wrócić rozdzielone. Dwa osobne wywołania dałyby to samo za dwa razy
 * większy rachunek i dwa razy większą szansę, że rano akurat jedno nie
 * odpowie. Znacznik, którego model nie odda, sam się wykrywa — i wtedy
 * wracamy do wersji z liczb.
 */
const MARK_GREETING = "POWITANIE:";
const MARK_BODY = "BRIEFING:";

const SYSTEM_PROMPT = [
  "Jesteś J.A.R.V.I.S.-em i czytasz właścicielowi poranny briefing.",
  "Dostajesz dwa gotowe, PRAWDZIWE kawałki tekstu, każdy pod swoim znacznikiem.",
  "Przepisz oba i oddaj W TYM SAMYM UKŁADZIE, z tymi samymi znacznikami:",
  `${MARK_GREETING} <powitanie>`,
  `${MARK_BODY} <briefing>`,
  "",
  "TON. Ciepło i swobodnie, jak zaufany domownik przy porannej kawie —",
  "pełnymi zdaniami, z naturalnym „warto to wykorzystać” czy „spokojny",
  "poranek”. Bez entuzjazmu na siłę, bez poufałości: nadal per „Panie",
  "Sławiński”. Powitanie może brzmieć gawędziarsko, treść ma zostać rzeczowa.",
  "",
  "ZASADY, OD KTÓRYCH NIE MA ODSTĘPSTW:",
  "1. Nie dodawaj ŻADNEJ liczby, nazwy, wydarzenia ani faktu, którego nie ma",
  "   w wejściu. Nie wiesz, co właściciel robił wczoraj, kogo dziś spotka ani",
  "   jak się czuje — nie zgaduj tego i nie udawaj, że pamiętasz.",
  "2. Nie zmieniaj żadnej liczby ani kierunku zmiany.",
  "3. Nie doradzaj i nie prognozuj niczego ponad to, co stoi w wejściu.",
  `4. Nie pomijaj żadnej informacji spod znacznika ${MARK_BODY}.`,
  "5. Bez list, nagłówków i markdownu — pod każdym znacznikiem jeden akapit.",
  "Powitanie do 45 słów, briefing do 140 słów.",
].join("\n");

type Parts = { greeting: string; body: string };

/** Wyłuskuje oba kawałki z odpowiedzi modelu; null, gdy układ się nie zgadza. */
export function parseParts(text: string | null): Parts | null {
  if (!text) return null;
  const gAt = text.indexOf(MARK_GREETING);
  const bAt = text.indexOf(MARK_BODY);
  if (gAt === -1 || bAt === -1 || bAt < gAt) return null;
  const greeting = text.slice(gAt + MARK_GREETING.length, bAt).trim();
  const body = text.slice(bAt + MARK_BODY.length).trim();
  if (!greeting || !body) return null;
  return { greeting, body };
}

const looksLikeMarkdown = (text: string): boolean => /^[-*#]|\n[-*#]/.test(text);

/** Czy przepisana treść nadaje się do użycia zamiast wersji z liczb. */
function isUsable(rewritten: string | null, original: string): boolean {
  if (!rewritten) return false;
  const text = rewritten.trim();
  if (text.length < 20) return false;
  if (text.length > MAX_SPOKEN_CHARS) return false;
  // Model, który zamiast przepisać zaczął odpowiadać markdownem albo listą,
  // nie wykonał zadania — a wersja z liczb jest w najgorszym razie sucha.
  if (looksLikeMarkdown(text)) return false;
  // Krótsza niż połowa oryginału znaczy, że coś wypadło. Wolimy sucho i
  // w komplecie niż ładnie i bez połowy.
  if (text.length < original.length * 0.5) return false;
  return true;
}

/**
 * Czy przepisane powitanie nadaje się do pokazania.
 *
 * Nie porównujemy go z długością oryginału — inaczej niż treść, powitanie
 * WOLNO skrócić: „Witam, Panie Sławiński. Piękny dzień, warto wyjść."
 * jest lepsze niż wierne przepisanie trzech zdań. Pilnujemy tylko, żeby
 * nie urosło w drugi briefing i nie wróciło listą.
 */
export function isUsableGreeting(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 10 || trimmed.length > MAX_GREETING_CHARS) return false;
  return !looksLikeMarkdown(trimmed);
}

async function rewriteWithGemini(
  apiKey: string,
  input: string,
  ledger: LedgerContext | undefined,
): Promise<string | { error: string }> {
  const res = await callGemini<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: GeminiUsageMetadata;
  }>({
    apiKey,
    model: GEMINI_MODEL,
    body: {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: input }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
    },
    timeoutMs: MODEL_TIMEOUT_MS,
    ledger,
  });
  if (!res.ok) return { error: res.message };
  return (
    res.data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

/**
 * Przepisuje powitanie i treść na płynniejsze. Zwraca też nazwę modelu, żeby
 * dało się później sprawdzić, który wariant briefingu użytkownik widział.
 */
export async function polishBrief(
  parts: Parts,
  keys: BriefKeys,
  ledger?: LedgerContext,
): Promise<{ greeting: string; body: string; generatedBy: string; fallbackReasons: string[] }> {
  // W8 (etap 6b): dlaczego zostały same liczby — wcześniej to ginęło w ciszy
  // (13.11 briefing bez modelu mimo dwóch kluczy). Job pokazuje te powody.
  const fallbackReasons: string[] = [];
  const plain = { ...parts, generatedBy: "facts", fallbackReasons };
  if (!keys.anthropicApiKey && !keys.geminiApiKey) return plain;

  const input = `${MARK_GREETING} ${parts.greeting}\n${MARK_BODY} ${parts.body}`;

  // Przyjmujemy przepisanie TYLKO wtedy, gdy oba kawałki przeszły kontrolę.
  // Mieszanie ciepłego powitania od modelu z suchą treścią z liczb dałoby
  // rubrykę, która w połowie zdania zmienia głos.
  const accept = (raw: string | null, label: string) => {
    const reject = (why: string) => {
      fallbackReasons.push(`${label}: ${why}`);
      return null;
    };
    if (!raw || !raw.trim()) return reject("pusta odpowiedź");
    const got = parseParts(raw);
    if (!got) return reject("odpowiedź bez znaczników POWITANIE/BRIEFING");
    if (!isUsableGreeting(got.greeting)) return reject("powitanie nie przeszło kontroli");
    if (!isUsable(got.body, parts.body)) {
      return reject("treść nie przeszła kontroli (markdown albo krótsza niż połowa)");
    }
    return {
      greeting: got.greeting.trim(),
      body: got.body.trim(),
      generatedBy: `model:${label}`,
      fallbackReasons,
    };
  };

  if (keys.anthropicApiKey) {
    try {
      const contents: GeminiContent[] = [{ role: "user", parts: [{ text: input }] }];
      const result = await callAnthropic({
        apiKey: keys.anthropicApiKey,
        model: ANTHROPIC_BRIEF_MODEL,
        systemPrompt: SYSTEM_PROMPT,
        contents,
        maxOutputTokens: 1024,
        timeoutMs: MODEL_TIMEOUT_MS,
        ledger,
      });
      const ok = accept(result.text, ANTHROPIC_BRIEF_MODEL);
      if (ok) return ok;
    } catch (err) {
      // Przechodzimy na zapasowego dostawcę — nie jest to awaria briefingu,
      // ale powód zostaje (fallbackReasons).
      fallbackReasons.push(
        `${ANTHROPIC_BRIEF_MODEL}: ${err instanceof Error ? err.message : String(err)}`.slice(
          0,
          300,
        ),
      );
    }
  }

  if (keys.geminiApiKey) {
    const res = await rewriteWithGemini(keys.geminiApiKey, input, ledger);
    if (typeof res !== "string") {
      fallbackReasons.push(`${GEMINI_MODEL}: ${res.error}`.slice(0, 300));
    } else {
      const ok = accept(res, GEMINI_MODEL);
      if (ok) return ok;
    }
  }

  return plain;
}

export type BuildBriefResult = {
  brief: DailyBrief;
  /** Czy powiadomienie o gotowym briefingu poszło (feed + urządzenia). */
  notified: boolean;
  /** Co się stało z powiadomieniem na urządzenia; null, gdy nie próbowano. */
  push?: PushResult | null;
  error: string | null;
  /** Dlaczego tekst został z samych liczb mimo kluczy modeli (W8, etap 6b). */
  fallbackReasons?: string[];
};

/**
 * Składa briefing na dziś i zapisuje go.
 *
 * `notify: false` służy wywołaniu z aplikacji („złóż mi briefing teraz") —
 * wtedy użytkownik ma go już przed oczami i osobny sygnał byłby hałasem.
 * Nocny job woła z `notify: true`, bo to właśnie powiadomienie jest jedyną
 * rzeczą, która o briefingu w ogóle mówi.
 *
 * `push: false` to tryb cichy wybrany przez użytkownika: meldunek ląduje w
 * dzwonku, ale nie budzi urządzeń.
 */
export async function buildDailyBrief(
  db: Db,
  ownerId: string,
  keys: BriefKeys,
  options: { notify?: boolean; push?: boolean } = {},
): Promise<BuildBriefResult> {
  const facts = await gatherFacts(db, ownerId);
  const composed: ComposedBrief = composeBrief(facts);
  const { greeting, body, generatedBy, fallbackReasons } = await polishBrief(
    { greeting: composed.greeting, body: sectionsToSpoken(composed.sections) },
    keys,
    { db, ownerId, module: "brief", purpose: "polish" },
  );
  const spoken = `${greeting} ${body}`;

  const row = {
    owner_id: ownerId,
    brief_date: facts.date,
    greeting,
    sections: composed.sections as unknown as Json,
    spoken,
    facts: facts as unknown as Json,
    generated_by: generatedBy,
  };

  const { data, error } = await db
    .from("daily_briefs")
    .upsert(row, { onConflict: "owner_id,brief_date" })
    .select("brief_date, greeting, sections, spoken, generated_by, created_at")
    .single();

  const brief: DailyBrief = {
    date: facts.date,
    greeting,
    sections: composed.sections,
    spoken,
    generatedBy,
    createdAt: data?.created_at ?? new Date().toISOString(),
  };

  if (error) return { brief, notified: false, error: error.message, fallbackReasons };

  let notified = false;
  if (options.notify) {
    // Tytuł powiadomienia mówi, ILE jest do przeczytania — „briefing gotowy"
    // bez tego nie pomaga zdecydować, czy otwierać go teraz, czy po kawie.
    const count = composed.sections.length;
    const result = await notifyOwner(db, ownerId, {
      kind: "daily_brief",
      title:
        count === 0
          ? "Poranny briefing: spokojnie"
          : `Poranny briefing: ${count} ${count === 1 ? "temat" : count < 5 ? "tematy" : "tematów"}`,
      body: spoken.slice(0, 400),
      payload: { brief_date: facts.date, sections: count } as unknown as Json,
      url: "/",
      // Jeden briefing dziennie, więc jeden znacznik — wczorajszy meldunek
      // znika z ekranu urządzenia, zamiast zostawać obok dzisiejszego.
      tag: "daily-brief",
      // Cichy briefing: rubryka i dzwonek jak zwykle, telefon nietknięty.
      silent: options.push === false,
    });
    notified = result.id !== null;
    return { brief, notified, push: result.push ?? null, error: null, fallbackReasons };
  }

  return { brief, notified, error: null, fallbackReasons };
}

/** Sekcje z bazy wracają jako `Json` — tu odzyskują swój kształt. */
export function parseSections(value: Json | null): BriefSection[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is BriefSection =>
      typeof item === "object" &&
      item !== null &&
      "kind" in item &&
      "heading" in item &&
      Array.isArray((item as { lines?: unknown }).lines),
  );
}
