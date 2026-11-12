// Historia rozmowy dla modelu (plan naprawczy, etap 3, A10).
//
// Do tej pory klient wysyłał do 30 ostatnich wiadomości, każda do 8000 znaków,
// i całość szła do modelu przy każdej turze. Teraz historia pochodzi z bazy
// (`messages` po conversationId) i jest przycinana do budżetu tokenów:
// najnowsze wiadomości w całości, starsze odcinane w całości — nigdy w połowie
// zdania, bo urwana wypowiedź myli model bardziej niż brak starej.

export type HistoryTurn = { role: "user" | "jarvis"; text: string };

/** Budżet historii w tokenach (szacunkowo). Prompt systemowy i narzędzia osobno. */
export const HISTORY_TOKEN_BUDGET = 6_000;

/** Ile ostatnich wiadomości czytamy z bazy, zanim zadziała budżet. */
export const HISTORY_FETCH_LIMIT = 40;

const tokensOf = (text: string) => Math.ceil(text.length / 4);

export const estimateHistoryTokens = (turns: readonly HistoryTurn[]): number =>
  turns.reduce((sum, t) => sum + tokensOf(t.text), 0);

export function trimHistory(
  turns: readonly HistoryTurn[],
  budgetTokens: number = HISTORY_TOKEN_BUDGET,
): HistoryTurn[] {
  const kept: HistoryTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (!t.text.trim()) continue;
    const cost = tokensOf(t.text);
    // Najnowsza wiadomość zostaje zawsze — bez niej model nie wie, o czym mowa.
    if (kept.length > 0 && used + cost > budgetTokens) break;
    kept.push(t);
    used += cost;
  }
  return kept.reverse();
}

/**
 * Historia BEZ bieżącej wiadomości. Klient zapisuje wiadomość użytkownika do
 * swojego transkryptu, zanim wyśle zapytanie, więc w rozmowie bez wątku
 * (pierwsza wiadomość, nowy lub wyczyszczony wątek) ostatnia tura historii
 * to ta sama prośba, którą orkiestrator dokłada jako `input`. Model widział
 * ją wtedy dwa razy i odpowiadał „prośba padła dwa razy”.
 */
export function withoutCurrentInput(turns: readonly HistoryTurn[], input: string): HistoryTurn[] {
  const last = turns[turns.length - 1];
  if (last && last.role === "user" && last.text.trim() === input.trim()) {
    return turns.slice(0, -1);
  }
  return [...turns];
}
