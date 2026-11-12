// Dogrywanie grafik w tle (plan naprawczy, etap 6) — sama decyzja, bez bazy.
//
// Grafiki do pliku dogrywa przeglądarka zaraz po turze czatu. Gdy telefon
// uśnie, plik zostaje tekstowy z `image_status = 'pending'` na zawsze. Kolejka
// w tle (workflow document-jobs.yml, uruchamiany przez pg_cron) podejmuje
// takie pliki. Te same progi stoją w SQL (dispatch_document_jobs) — zmieniać
// razem.

/** Ile plik czeka na przeglądarkę, zanim podejmie go kolejka. */
export const ENRICH_GRACE_MS = 90_000;

/**
 * Po ilu minutach przejęcie dogrywania (`image_claimed_at`) uznajemy za
 * porzucone. Dogrywanie trwa zwykle 20–40 s, w burzy 503 kilka minut — 10
 * daje zapas, a przerwany przebieg nie blokuje pliku na zawsze.
 */
export const ENRICH_CLAIM_TTL_MS = 10 * 60_000;

export type EnrichSnapshot = {
  imageStatus: string;
  createdAt: string;
  claimedAt: string | null;
};

/** Czy kolejka ma podjąć dogrywanie grafik tego pliku. */
export function imageNeedsEnrich(file: EnrichSnapshot, now: Date = new Date()): boolean {
  if (file.imageStatus !== "pending") return false;
  const age = now.getTime() - Date.parse(file.createdAt);
  if (!Number.isFinite(age) || age < ENRICH_GRACE_MS) return false;
  if (!file.claimedAt) return true;
  const claimAge = now.getTime() - Date.parse(file.claimedAt);
  return !Number.isFinite(claimAge) || claimAge >= ENRICH_CLAIM_TTL_MS;
}
