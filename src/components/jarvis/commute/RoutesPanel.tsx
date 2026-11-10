import { useState } from "react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { AUTO_FASTEST_ID, deltaVsDefaultMin } from "@/lib/commute/options";
import { minutesOf } from "@/lib/commute/plan";
import { MAX_SAVED_ROUTES, type CommuteResult, type SavedRoute } from "@/lib/commute/types";
import { cn } from "@/lib/utils";

// Lista tras do wyboru: Twoje zapisane (z punktami pośrednimi) i propozycje
// automatyczne. Klik w kartę pokazuje trasę na mapie; gwiazdka ustawia
// domyślną — tę, którą czytają briefing, kafelek, dock i alerty.

const btn =
  "font-display shrink-0 border px-2 py-1 text-[9px] uppercase tracking-[0.18em] transition disabled:opacity-40";

export function RoutesPanel({
  result,
  saved,
  selectedId,
  busy,
  onSelect,
  onSetDefault,
  onAdd,
  onEdit,
  onDelete,
}: {
  result: CommuteResult;
  saved: SavedRoute[];
  selectedId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  /** `null` = domyślna znów jest najszybsza automatyczna. */
  onSetDefault: (savedId: string | null) => void;
  onAdd: () => void;
  onEdit: (route: SavedRoute) => void;
  onDelete: (route: SavedRoute) => void;
}) {
  const def = result.options.find((o) => o.id === result.defaultId) ?? result.options[0];
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <HudPanel index={3} title={`TRASY (${result.options.length})`} tone="quiet" className="p-4">
      <ul className="mt-3 space-y-2">
        {result.options.map((o) => {
          const isSelected = o.id === selectedId;
          const delta = deltaVsDefaultMin(o, def);
          const savedMeta = o.kind === "saved" ? saved.find((s) => `saved:${s.id}` === o.id) : null;
          const via = o.route.streets
            .filter((s) => s.meters >= 400)
            .slice(0, 2)
            .map((s) => s.name);
          const canStar = !o.isDefault && (savedMeta || o.id === AUTO_FASTEST_ID);
          return (
            <li key={o.id} className="min-w-0">
              <div
                className={cn(
                  "border px-3 py-2 transition",
                  isSelected ? "border-primary/70 bg-primary/10" : "border-primary/20",
                )}
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(o.id)}
                  className="block w-full min-w-0 text-left"
                >
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="min-w-0 break-words text-xs font-semibold text-foreground">
                      {o.isDefault ? "★ " : ""}
                      {o.name}
                    </span>
                    <span className="font-display text-lg leading-none text-primary">
                      {minutesOf(o.route.durationSec)}
                      <span className="ml-0.5 text-[10px]">min</span>
                    </span>
                    {!o.isDefault && (
                      <span
                        className="font-display text-[10px]"
                        style={{
                          color: delta > 0 ? "var(--warning)" : "var(--success)",
                        }}
                      >
                        {delta === 0
                          ? "tyle samo"
                          : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} min`}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 min-w-0 break-words text-[11px] text-muted-foreground">
                    {[
                      `${(o.route.distanceM / 1000).toFixed(1).replace(".", ",")} km`,
                      via.length ? `przez ${via.join(", ")}` : null,
                      o.route.incidentIds.length
                        ? `utrudnienia: ${o.route.incidentIds.length}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </button>
                {(canStar || savedMeta) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {canStar && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onSetDefault(savedMeta ? savedMeta.id : null)}
                        className={cn(btn, "border-primary/50 text-primary hover:bg-primary/10")}
                      >
                        ★ domyślna
                      </button>
                    )}
                    {savedMeta && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onEdit(savedMeta)}
                          className={cn(
                            btn,
                            "border-primary/30 text-muted-foreground hover:text-primary",
                          )}
                        >
                          edytuj
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (confirmId === savedMeta.id) {
                              setConfirmId(null);
                              onDelete(savedMeta);
                            } else {
                              setConfirmId(savedMeta.id);
                              setTimeout(
                                () => setConfirmId((c) => (c === savedMeta.id ? null : c)),
                                3000,
                              );
                            }
                          }}
                          className={cn(
                            btn,
                            "border-destructive/50 text-destructive hover:bg-destructive/10",
                          )}
                        >
                          {confirmId === savedMeta.id ? "na pewno?" : "usuń"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || saved.length >= MAX_SAVED_ROUTES}
          onClick={onAdd}
          className={cn(btn, "border-primary/60 text-primary hover:bg-primary/20")}
        >
          + dodaj moją trasę
        </button>
        {saved.length >= MAX_SAVED_ROUTES && (
          <span className="text-[10px] text-muted-foreground">
            limit {MAX_SAVED_ROUTES} tras na kierunek
          </span>
        )}
      </div>
    </HudPanel>
  );
}
