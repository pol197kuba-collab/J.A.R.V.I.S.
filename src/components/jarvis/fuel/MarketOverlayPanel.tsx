// Skąd bierze się cena: ropa Brent, kurs dolara i marża, która zostaje po
// odjęciu surowca. Plus odpowiedź na pytanie, które naprawdę interesuje
// kupującego — czy cennik zdążył już zdyskontować ostatni ruch ropy.
import type { FuelSeries, MarketOverlay } from "@/lib/fuel/fuel.functions";
import { EmptyState, PanelHint, StatTile } from "./chrome";
import { formatPln } from "./format";

function correlationLabel(r: number): string {
  const abs = Math.abs(r);
  if (abs >= 0.8) return "bardzo silna";
  if (abs >= 0.6) return "silna";
  if (abs >= 0.4) return "umiarkowana";
  if (abs >= 0.2) return "słaba";
  return "brak";
}

export function MarketOverlayPanel({
  overlay,
  fuel,
}: {
  overlay: MarketOverlay | undefined;
  fuel: FuelSeries | undefined;
}) {
  if (!overlay || overlay.points.length === 0) {
    return <EmptyState>Brak danych rynkowych</EmptyState>;
  }

  const { correlation, passThroughPct } = overlay;
  // Pasek pokazuje, jaka część ruchu ropy z ostatnich 30 dni jest już
  // w cenniku. Powyżej 100% cennik ruszył się MOCNIEJ niż surowiec.
  const clamped = passThroughPct === null ? null : Math.max(0, Math.min(130, passThroughPct));

  return (
    <div className="p-5 @max-[420px]:p-4">
      <div className="flex flex-wrap gap-x-4 gap-y-3">
        <StatTile
          label="Brent"
          value={overlay.latestBrentUsd === null ? "—" : overlay.latestBrentUsd.toFixed(2)}
          unit="USD/bbl"
        />
        <StatTile
          label="USD / PLN"
          value={overlay.latestUsdPln === null ? "—" : overlay.latestUsdPln.toFixed(4)}
          hint="kurs średni NBP"
        />
        <StatTile
          label="Brent w PLN"
          value={formatPln(overlay.latestBrentPlnPerM3)}
          unit="PLN/m³"
          hint="koszt samego surowca"
        />
        <StatTile
          label="Marża + koszty"
          value={formatPln(overlay.spreadPlnPerM3)}
          unit="PLN/m³"
          color="var(--primary)"
          hint={fuel ? `${fuel.label} − Brent` : undefined}
        />
      </div>

      <div className="mt-4 space-y-3">
        <div className="min-w-0">
          <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
            Sprzężenie z ropą
          </p>
          <p className="mt-1 font-mono text-xs text-foreground/90">
            r = <span className="font-bold text-primary">{correlation.r.toFixed(2)}</span>{" "}
            <span className="text-muted-foreground">
              ({correlationLabel(correlation.r)}) przy opóźnieniu{" "}
              <span className="text-foreground/80">{correlation.lagDays} dni</span>
            </span>
          </p>
          <PanelHint>
            To, co widać dziś w cenniku, wydarzyło się na rynku ropy mniej więcej{" "}
            {correlation.lagDays === 0 ? "tego samego dnia" : `${correlation.lagDays} dni temu`}.
          </PanelHint>
        </div>

        {clamped !== null && (
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <p className="font-display text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
                Przeniesienie ruchu ropy (30 dni)
              </p>
              <p className="font-mono text-xs font-bold text-primary">{passThroughPct}%</p>
            </div>
            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-primary/10"
              role="img"
              aria-label={`Cennik odzwierciedla ${passThroughPct}% ruchu ropy z ostatnich 30 dni`}
            >
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{
                  width: `${(clamped / 130) * 100}%`,
                  background: "var(--primary)",
                  boxShadow: "var(--glow-primary)",
                }}
              />
            </div>
            <PanelHint>
              {passThroughPct !== null && passThroughPct < 80
                ? "Cennik nie nadążył jeszcze za surowcem — część ruchu wciąż przed nami."
                : passThroughPct !== null && passThroughPct > 110
                  ? "Cennik ruszył się mocniej niż sam surowiec — pracuje też kurs i marża."
                  : "Cennik zasadniczo nadążył za ruchem surowca."}
            </PanelHint>
          </div>
        )}
      </div>
    </div>
  );
}
