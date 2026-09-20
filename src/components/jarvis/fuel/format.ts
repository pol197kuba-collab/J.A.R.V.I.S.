// Formatery i mapowanie kierunku na kolor — osobny plik bez JSX, żeby
// chrome.tsx eksportował wyłącznie komponenty (wymóg fast-refresh).

export function formatPln(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pl-PL", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatSigned(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatPln(Math.abs(value), fractionDigits)}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2).replace(".", ",")}%`;
}

export function formatDatePl(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Kolor kierunku. Dla kupującego paliwo wzrost jest złą wiadomością, więc
 * „w górę" jest czerwone, a „w dół" zielone — odwrotnie niż na giełdzie.
 * Ten sam kod kolorystyczny obowiązuje w całym module (kafle, heatmapa,
 * prognoza), żeby czerwień zawsze znaczyła to samo.
 */
export function directionColor(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || delta === 0) return "var(--muted-foreground)";
  return delta > 0 ? "var(--destructive)" : "var(--success)";
}
