// Ratowanie zadań dokumentowych, które utknęły.
//
// AWARIA, KTÓRĄ TO NAPRAWIA — zaobserwowana na żywo. Użytkownik poprosił o
// prezentację i zminimalizował aplikację na telefonie. Zadanie stanęło na
// zawsze: nic nie powstało, żadne powiadomienie nie przyszło, wpis został w
// stanie `running` na wieki.
//
// DLACZEGO TAK SIĘ STAŁO. Potok Insight → Forge jest odpalany PRZEZ
// PRZEGLĄDARKĘ: po turze czatu klient wywołuje `runDocumentJobFn` i nie czeka
// na wynik (useAgentChatChannel.ts). Dopóki karta żyje, wszystko działa. Gdy
// telefon uśpi albo wyrzuci kartę z pamięci, żądanie zostaje zerwane, a
// razem z nim wywołanie po stronie serwera. Nikt wtedy nie zapisze ani
// wyniku, ani błędu — a `runDocumentJobFn` ma strażnika idempotencji
// (`status !== 'queued'` → odmowa), więc nawet ponowne kliknięcie nie mogło
// tego odblokować. Zadanie było zaklinowane trwale.
//
// CO Z TYM ROBIMY. Zadanie w stanie `running`, które od dłuższego czasu nie
// dało znaku życia, wraca do kolejki i dostaje kolejne podejście. Po
// wyczerpaniu podejść jest UCZCIWIE oznaczane jako nieudane, z powiadomieniem
// — bo „nic się nie stało" jest gorszą odpowiedzią niż „nie udało się".
//
// Ten plik jest czysty: sama decyzja, bez bazy. Wykonanie siedzi w
// documentJobs.functions.ts.

/**
 * Po jakim czasie bez aktualizacji uznajemy zadanie za porzucone.
 *
 * Górne ograniczenie bierze się z tego, ile potok realnie trwa: research,
 * budowa pliku, bramka jakości i ewentualna jedna poprawka to w najgorszym
 * razie kilka minut. Piętnaście daje zapas na wolnego dostawcę modelu i
 * nie każe użytkownikowi czekać pół godziny na werdykt.
 */
export const STALE_AFTER_MS = 15 * 60_000;

/**
 * Ile razy wolno podejść do zadania, licząc pierwsze uruchomienie.
 *
 * Trzy, bo typowa przyczyna zerwania (uśpiona karta) znika, gdy podnosi je
 * nocny job — ale zadanie, które pada trzy razy, pada z powodu, którego
 * czwarte podejście nie naprawi, a wskrzeszanie go w nieskończoność paliłoby
 * tokeny na cudzy problem.
 */
export const MAX_ATTEMPTS = 3;

/**
 * Po jakim czasie zadanie `queued`, którego nikt nie wystartował, podejmuje
 * kolejka w tle (plan naprawczy, etap 6). Przeglądarka startuje zadanie
 * zaraz po turze czatu, więc `queued` starsze niż półtorej minuty znaczy, że
 * start nie doszedł (uśpiona karta) — nie ma sensu czekać pełnych 15 minut.
 * Ta sama wartość stoi w SQL (dispatch_document_jobs) — zmieniać razem.
 */
export const QUEUED_GRACE_MS = 90_000;

export type JobSnapshot = {
  status: string;
  /** Znacznik ostatniej zmiany wiersza — nasz jedyny puls zadania. */
  updatedAt: string;
  attempts: number;
};

export type JobVerdict =
  /** Pracuje albo już skończyło — nie dotykać. */
  | "healthy"
  /** Porzucone, ale ma jeszcze podejście — wrócić do kolejki. */
  | "resumable"
  /** Porzucone i bez podejść — zamknąć jako nieudane i powiedzieć wprost. */
  | "exhausted";

/** Czy wiersz wygląda na porzucony w połowie drogi. */
export function classifyJob(job: JobSnapshot, now: Date = new Date()): JobVerdict {
  if (job.status !== "running" && job.status !== "queued") return "healthy";

  const age = now.getTime() - Date.parse(job.updatedAt);
  const threshold = job.status === "queued" ? QUEUED_GRACE_MS : STALE_AFTER_MS;
  if (!Number.isFinite(age) || age < threshold) return "healthy";

  return job.attempts >= MAX_ATTEMPTS ? "exhausted" : "resumable";
}

/** Zdanie do powiadomienia o zadaniu, którego nie udało się dokończyć. */
export function exhaustedReason(attempts: number): string {
  return (
    `przerwane ${attempts} ${attempts === 1 ? "raz" : "razy"} bez dokończenia — ` +
    "najczęstsza przyczyna to zamknięcie lub uśpienie aplikacji w trakcie " +
    "generowania, a dokończenie w tle też się nie udało. Poproś o ten dokument " +
    "jeszcze raz — jeśli powtórzy się, zajrzyj do Logów systemu."
  );
}
