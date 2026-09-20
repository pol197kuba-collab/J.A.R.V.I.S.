// Wyszukiwarka instrumentów do dodania na watchlistę.
//
// Katalog jest stały i niewielki (kilkadziesiąt pozycji ze słownika w
// src/lib/markets/assets.ts), więc filtrowanie idzie w całości po stronie
// klienta — bez żądania na każde naciśnięcie klawisza.
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { ASSET_CLASS_LABELS, searchAssets, type AssetClass } from "@/lib/markets/assets";
import { EmptyState } from "@/components/jarvis/fuel/chrome";
import { cn } from "@/lib/utils";

const CLASS_FILTERS: ReadonlyArray<{ value: AssetClass | "all"; label: string }> = [
  { value: "all", label: "Wszystko" },
  { value: "crypto", label: "Krypto" },
  { value: "equity", label: "Akcje" },
  { value: "index", label: "Indeksy" },
  { value: "commodity", label: "Surowce" },
  { value: "fx", label: "Waluty" },
];

export function AssetPicker({
  watched,
  onAdd,
  addingSymbol,
}: {
  watched: string[];
  onAdd: (symbol: string) => void;
  addingSymbol: string | null;
}) {
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState<AssetClass | "all">("all");

  const results = useMemo(() => {
    const found = searchAssets(query);
    return classFilter === "all" ? found : found.filter((a) => a.assetClass === classFilter);
  }, [query, classFilter]);

  return (
    <div className="mt-3 space-y-3">
      <div className="flex min-w-0 items-center gap-2 border border-primary/40 bg-black/40 px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj instrumentu (np. bitcoin, orlen, złoto)..."
          className="font-mono w-full min-w-0 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {CLASS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={classFilter === f.value}
            onClick={() => setClassFilter(f.value)}
            className={cn(
              "font-display rounded border px-2 py-0.5 text-[9px] uppercase tracking-widest transition",
              classFilter === f.value
                ? "border-primary/60 bg-primary/20 text-primary"
                : "border-primary/20 text-muted-foreground hover:bg-primary/10",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {results.length === 0 ? (
        <EmptyState>Brak instrumentu dla tej frazy</EmptyState>
      ) : (
        <div className="no-scrollbar max-h-64 space-y-1 overflow-x-hidden overflow-y-auto">
          {results.map((asset) => {
            const already = watched.includes(asset.symbol);
            return (
              <div
                key={asset.symbol}
                className="flex min-w-0 items-center gap-2 border-b border-primary/10 px-1 py-1.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-display truncate text-[11px] uppercase tracking-widest text-foreground">
                    {asset.label}
                  </p>
                  <p className="truncate font-mono text-[9px] text-muted-foreground">
                    {asset.symbol} · {ASSET_CLASS_LABELS[asset.assetClass]} · {asset.currency}
                    {asset.hint ? ` · ${asset.hint}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={already || addingSymbol === asset.symbol}
                  onClick={() => onAdd(asset.symbol)}
                  aria-label={`Dodaj ${asset.label} do obserwowanych`}
                  className="font-display flex shrink-0 items-center gap-1 border border-primary/50 px-2 py-1 text-[9px] uppercase tracking-widest text-primary transition hover:bg-primary/20 disabled:border-primary/20 disabled:text-muted-foreground"
                >
                  {already ? (
                    "NA LIŚCIE"
                  ) : (
                    <>
                      <Plus className="h-3 w-3" /> DODAJ
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
