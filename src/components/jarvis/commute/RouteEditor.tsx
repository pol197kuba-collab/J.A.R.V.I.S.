import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { searchPlacesFn } from "@/lib/commute/commute.functions";
import { delayMin, minutesOf } from "@/lib/commute/plan";
import { MAX_VIA_POINTS, type CommuteRoute, type ViaPoint } from "@/lib/commute/types";
import { cn } from "@/lib/utils";

// Edytor trasy: punkty pośrednie dodajesz klikiem na mapie albo adresem,
// przeciągasz je pinezkami, a czas przejazdu przelicza się na żywo.

const field =
  "min-w-0 rounded border border-primary/25 bg-transparent px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-primary disabled:opacity-40";
const btn =
  "font-display shrink-0 border px-3 py-1.5 text-[9px] uppercase tracking-[0.18em] transition disabled:opacity-40";

export type EditorState = {
  /** null = nowa trasa. */
  id: string | null;
  name: string;
  via: ViaPoint[];
  makeDefault: boolean;
};

export function RouteEditor({
  state,
  onChange,
  preview,
  previewing,
  previewError,
  saving,
  onSave,
  onCancel,
}: {
  state: EditorState;
  onChange: (next: EditorState) => void;
  preview: CommuteRoute | null;
  previewing: boolean;
  previewError: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const search = useServerFn(searchPlacesFn);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ViaPoint[]>([]);
  const lookup = useMutation({
    mutationFn: (q: string) => search({ data: { query: q } }),
    onSuccess: (list) => {
      setHits(list.map((h) => ({ lat: h.lat, lon: h.lon, label: h.label })));
      if (list.length === 0) toast("Nie znaleziono takiego adresu");
    },
    onError: (err: unknown) =>
      toast("Wyszukiwanie adresu nie powiodło się", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  const full = state.via.length >= MAX_VIA_POINTS;
  const set = (patch: Partial<EditorState>) => onChange({ ...state, ...patch });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= state.via.length) return;
    const via = [...state.via];
    [via[i], via[j]] = [via[j], via[i]];
    set({ via });
  };
  const run = () => query.trim().length >= 3 && lookup.mutate(query.trim());
  const canSave = state.name.trim().length > 0 && state.via.length > 0 && !saving;
  const delay = preview ? delayMin(preview.durationSec, preview.typicalSec) : null;

  return (
    <HudPanel index={3} title={state.id ? "EDYCJA TRASY" : "NOWA TRASA"} className="p-4">
      <label className="mt-3 block min-w-0">
        <span className="font-display block text-[8px] uppercase tracking-[0.25em] text-muted-foreground">
          nazwa
        </span>
        <input
          value={state.name}
          maxLength={60}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="np. Przez Rzeszów"
          className={cn(field, "mt-1 w-full")}
        />
      </label>

      <p className="mt-3 min-w-0 break-words text-[11px] text-muted-foreground">
        Kliknij na mapie, żeby dodać punkt po drodze (najwyżej {MAX_VIA_POINTS}), albo wyszukaj
        adres. Pinezki można przeciągać. Stawiaj je na głównych drogach swojej trasy.
      </p>

      <ol className="mt-3 space-y-1.5">
        {state.via.map((v, i) => (
          <li key={`${i}-${v.lat}-${v.lon}`} className="flex min-w-0 items-center gap-2 text-xs">
            <span className="font-display flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-reactor text-[10px] text-reactor">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 break-words font-mono text-[11px]">
              {v.label ?? `${v.lat.toFixed(4)}, ${v.lon.toFixed(4)}`}
            </span>
            <button
              type="button"
              aria-label="Wyżej"
              onClick={() => move(i, -1)}
              className="px-1 text-muted-foreground hover:text-primary"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Niżej"
              onClick={() => move(i, 1)}
              className="px-1 text-muted-foreground hover:text-primary"
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="Usuń punkt"
              onClick={() => set({ via: state.via.filter((_, k) => k !== i) })}
              className="px-1 text-destructive"
            >
              ✕
            </button>
          </li>
        ))}
        {state.via.length === 0 && (
          <li className="text-[11px] text-muted-foreground">Brak punktów — kliknij na mapie.</li>
        )}
      </ol>

      <div className="mt-3 flex min-w-0 gap-2">
        <input
          value={query}
          disabled={full}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder={full ? "Limit punktów osiągnięty" : "Dodaj punkt adresem…"}
          className={cn(field, "flex-1")}
        />
        <button
          type="button"
          disabled={full || lookup.isPending || query.trim().length < 3}
          onClick={run}
          aria-label="Szukaj adresu"
          className={cn(btn, "border-primary/40 text-primary hover:bg-primary/10")}
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {hits.length > 0 && (
        <ul className="mt-2 space-y-1">
          {hits.map((h) => (
            <li key={`${h.lat},${h.lon}`}>
              <button
                type="button"
                onClick={() => {
                  set({ via: [...state.via, h].slice(0, MAX_VIA_POINTS) });
                  setHits([]);
                  setQuery("");
                }}
                className="w-full min-w-0 break-words rounded border border-primary/20 px-2 py-1.5 text-left font-mono text-[11px] hover:border-primary/50 hover:bg-primary/10"
              >
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-primary/20 pt-3 text-xs">
        {previewError ? (
          <p className="min-w-0 break-words" style={{ color: "var(--destructive)" }}>
            Nie udało się wyznaczyć trasy z tymi punktami: {previewError}
          </p>
        ) : state.via.length === 0 ? (
          <p className="text-muted-foreground">Dodaj punkt, a policzę czas przejazdu.</p>
        ) : preview ? (
          <p className="min-w-0 break-words">
            <b className="text-primary">{minutesOf(preview.durationSec)} min</b> ·{" "}
            {(preview.distanceM / 1000).toFixed(1).replace(".", ",")} km
            {preview.typicalSec !== null && ` · typowo ${minutesOf(preview.typicalSec)} min`}
            {delay !== null && delay >= 5 ? ` (+${delay})` : ""}
            {previewing ? " · liczę…" : ""}
          </p>
        ) : (
          <p className="text-muted-foreground">{previewing ? "Liczę trasę…" : "—"}</p>
        )}
      </div>

      <label className="mt-3 flex min-w-0 items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={state.makeDefault}
          onChange={(e) => set({ makeDefault: e.target.checked })}
        />
        ustaw jako domyślną (tę czytają briefing, alerty i kafelek)
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={onSave}
          className={cn(btn, "border-primary/60 bg-primary/20 text-primary hover:bg-primary/30")}
        >
          {saving ? "zapisuję…" : "zapisz trasę"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className={cn(btn, "border-muted-foreground/40 text-muted-foreground")}
        >
          anuluj
        </button>
      </div>
    </HudPanel>
  );
}
