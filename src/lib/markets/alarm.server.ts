// MARKET GRID NA ŻYWO — alarm: pozycja AI zbliża się do stop-lossa, a
// model w kilka sekund decyduje, czy przesłanki prognozy nadal stoją
// („hold”), czy pozycję zamknąć wcześniej („close”). Tani model, jeden
// instrument, krótka odpowiedź — ok. 600 tokenów, w puli „alarm” budżetu.
// Brak budżetu, klucza albo czytelnej odpowiedzi = trzymaj (stop-loss
// i tak pilnuje pozycji mechanicznie).

import { DEFAULT_GEMINI_MODEL } from "@/lib/agents/models";
import { callAnthropic } from "@/lib/ai/llm/anthropic";
import { callGeminiText } from "@/lib/ai/llm/geminiText";
import { estimateTokens, type ModelBudget } from "./budget";
import { parseAlarmReply, type AlarmCandidate } from "./live";
import type { ModelKeys } from "./ingest.server";

export const ALARM_MODEL = "claude-haiku-5-5";

export const ALARM_SYSTEM = `Zarządzasz ryzykiem pozycji na papierze. Pozycja zbliża się do stop-lossa. Masz dane: kierunek, cenę odniesienia, bieżącą cenę, ruch, odległość stopu, uzasadnienie prognozy, wskaźniki i nagłówki.
Zdecyduj: "hold" (przesłanki prognozy nadal aktualne, ruch to szum) albo "close" (przesłanki się zdezaktualizowały albo nowe fakty przeczą pozycji). Nie wymyślaj liczb. Bez pewności — "hold", stop-loss zadziała sam.
Odpowiedz WYŁĄCZNIE JSON: {"action":"hold"|"close","reason_pl":"jedno zdanie po polsku"}`;

export function alarmPrompt(a: AlarmCandidate, context: string, headlines: string[]): string {
  const side = a.side === "long" ? "długa (kupno)" : "krótka (sprzedaż)";
  return [
    `${a.symbol}: pozycja ${side}, cena odniesienia ${a.refPx}, teraz ${a.price}`,
    `ruch ${(a.move * 100).toFixed(2)}% przeciw pozycji, stop-loss przy −${(a.stop * 100).toFixed(2)}%`,
    `uzasadnienie prognozy: ${a.reason ?? "brak"}`,
    `wskaźniki (dzienne): ${context}`,
    `nagłówki: ${
      headlines.length > 0
        ? headlines
            .slice(0, 3)
            .map((h) => `„${h}”`)
            .join("; ")
        : "brak"
    }`,
  ].join("\n");
}

export async function askAlarm(
  a: AlarmCandidate,
  context: string,
  headlines: string[],
  keys: ModelKeys,
  budget: ModelBudget,
): Promise<{
  action: "hold" | "close";
  reasonPl: string | null;
  model: string | null;
  skipped?: string;
}> {
  if (!keys.anthropicApiKey && !keys.geminiApiKey) {
    return { action: "hold", reasonPl: null, model: null, skipped: "brak klucza modelu" };
  }
  const user = alarmPrompt(a, context, headlines);
  const estimate = estimateTokens(ALARM_SYSTEM + user) + 120;
  const denied = await budget.check("alarm", estimate);
  if (denied) return { action: "hold", reasonPl: null, model: null, skipped: denied };

  if (keys.anthropicApiKey) {
    try {
      const r = await callAnthropic({
        apiKey: keys.anthropicApiKey,
        model: ALARM_MODEL,
        systemPrompt: ALARM_SYSTEM,
        contents: [{ role: "user", parts: [{ text: user }] }],
        maxOutputTokens: 300,
        timeoutMs: 30_000,
        ledger: budget.ledger?.("alarm"),
        // krótka decyzja „trzymaj / zamknij” — bez myślenia, żeby nie zjadło limitu
        noThinking: true,
      });
      await budget.record("alarm", {
        model: ALARM_MODEL,
        tokensIn: r.tokensIn + (r.cacheReadTokens ?? 0) + (r.cacheWriteTokens ?? 0),
        tokensOut: r.tokensOut,
        estimated: false,
      });
      if (r.text) return { ...parseAlarmReply(r.text), model: ALARM_MODEL };
    } catch (err) {
      console.warn(
        `[alarm] Claude zawiódł, zapas Gemini: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      );
    }
  }
  if (keys.geminiApiKey) {
    const g = await callGeminiText({
      apiKey: keys.geminiApiKey,
      model: DEFAULT_GEMINI_MODEL,
      system: ALARM_SYSTEM,
      user,
      timeoutMs: 30_000,
      ledger: budget.ledger?.("alarm"),
    });
    if (g.ok) {
      await budget.record("alarm", {
        model: DEFAULT_GEMINI_MODEL,
        tokensIn: estimateTokens(ALARM_SYSTEM + user),
        tokensOut: estimateTokens(g.text),
        estimated: true,
      });
      return { ...parseAlarmReply(g.text), model: DEFAULT_GEMINI_MODEL };
    }
  }
  return { action: "hold", reasonPl: null, model: null, skipped: "model nie odpowiedział" };
}
