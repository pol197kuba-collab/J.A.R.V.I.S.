// Czy wypowiedź w ogóle wygląda na polecenie dla interfejsu — bramka przed
// klasyfikatorem UI (plan naprawczy, etap 3, A9).
//
// Klasyfikator to drugie wywołanie modelu po KAŻDEJ turze bez narzędzi,
// czyli po większości rozmów. Jego jedyny cel to złapać polecenie nawigacji,
// które model zbył tekstem. Rozmowa, pytanie merytoryczne czy prośba
// o raport nie są takim poleceniem, więc dla nich go nie wołamy.
//
// Czysta funkcja, bez sieci: słownik pochodzi z rejestru komend
// (src/lib/commands/registry.ts) plus czasowniki luźnych poleceń, które
// klasyfikator ma łapać („przełącz mnie na X”, „pokaż mi Y”, „zamknij to”,
// „wróć do głównego ekranu”).
import { COMMAND_REGISTRY } from "./registry";

/** Dłuższa wypowiedź to treść, nie komenda. */
const MAX_COMMAND_WORDS = 8;

/** Czasowniki nawigacji / sterowania — PL (z odmianą) i EN. Bez `\b` na
 *  końcu: w JS polskie litery („pokaż”, „wróć”) nie są znakami słowa. */
const NAV_VERB =
  /^(?:jarvis[,\s]+)?(?:proszę\s+)?(otw[oó]rz|otwieraj|poka[zż]|przełącz|przelacz|przejd[zź]|wr[oó][cć]|zamknij|schowaj|ukryj|włącz|wlacz|wyłącz|wylacz|uśpij|uspij|zrestartuj|uruchom\s+ponownie|idź|idz|open|show|close|go\s+to|switch|back\s+to|return\s+to|hide|restart|reboot|sleep|shut\s*down)(?=[\s,.!]|$)/i;

/** Początek pytania — pytania to prośba o informację, nie o akcję UI. */
const QUESTION_START =
  /^(?:jarvis[,\s]+)?(co|jak|jaki|jaka|jakie|czy|ile|kiedy|dlaczego|czemu|gdzie|kto|który|która|które|what|how|why|when|where|who|which|is|are|do|does|can)(?=[\s,.!]|$)/i;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

export function looksLikeUiCommand(input: string): boolean {
  const text = input.trim();
  if (!text || text.includes("?")) return false;
  if (words(text).length > MAX_COMMAND_WORDS) return false;
  if (QUESTION_START.test(text)) return false;
  if (COMMAND_REGISTRY.some((c) => c.pattern.test(text))) return true;
  return NAV_VERB.test(text);
}

/** Prośba o NOWY plik/raport — wtedy klasyfikator może zlecić queue_document_job. */
const DOCUMENT_REQUEST =
  /\b(zr[oó]b|przygotuj|stw[oó]rz|wygeneruj|napisz|make|create|prepare|generate)\b.*\b(prezentacj\w*|raport\w*|dokument\w*|opracowani\w*|pptx|docx|pdf|presentation|report|deck)\b/i;

export function looksLikeDocumentRequest(input: string): boolean {
  const text = input.trim();
  if (!text || text.includes("?")) return false;
  return DOCUMENT_REQUEST.test(text);
}
