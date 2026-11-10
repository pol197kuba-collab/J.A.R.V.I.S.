import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import {
  saveCommuteSettingsFn,
  searchPlacesFn,
  type CommuteSettingsPatch,
} from "@/lib/commute/commute.functions";
import { hm, parseHm } from "@/lib/commute/plan";
import { COMMUTE_SETTINGS_KEY, useCommuteSettings } from "@/lib/commute/useCommute";
import type { LatLon } from "@/lib/commute/types";
import { cn } from "@/lib/utils";

type Place = LatLon & { label: string };

const fieldClass =
  "min-w-0 rounded border border-primary/25 bg-transparent px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-primary disabled:opacity-40";
const labelClass =
  "font-display block text-[8px] uppercase tracking-[0.25em] text-muted-foreground";
const btnClass =
  "font-display shrink-0 rounded border border-primary/40 px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/10 disabled:opacity-40";

const DELAYS = [5, 10, 15, 20, 30];

function PlacePicker({
  title,
  value,
  disabled,
  onPick,
}: {
  title: string;
  value: Place | null;
  disabled: boolean;
  onPick: (place: Place) => void;
}) {
  const search = useServerFn(searchPlacesFn);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Place[]>([]);
  const lookup = useMutation({
    mutationFn: (q: string) => search({ data: { query: q } }),
    onSuccess: (list) => {
      setHits(list);
      if (list.length === 0) toast("Nie znaleziono takiego adresu");
    },
    onError: (err: unknown) =>
      toast("Wyszukiwanie adresu nie powiodło się", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  const run = () => {
    if (query.trim().length >= 3) lookup.mutate(query.trim());
  };

  return (
    <div className="min-w-0">
      <span className={labelClass}>{title}</span>
      <p className="mt-1 min-w-0 break-words font-mono text-xs text-foreground">
        {value ? value.label : <span className="text-muted-foreground">nie ustawiono</span>}
      </p>
      <div className="mt-2 flex min-w-0 gap-2">
        <input
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Ulica, numer, miasto…"
          className={cn(fieldClass, "flex-1")}
        />
        <button
          type="button"
          disabled={disabled || lookup.isPending || query.trim().length < 3}
          onClick={run}
          className={btnClass}
          aria-label={`Szukaj adresu: ${title}`}
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
                  onPick(h);
                  setHits([]);
                  setQuery("");
                }}
                className="w-full min-w-0 break-words rounded border border-primary/20 px-2 py-1.5 text-left font-mono text-[11px] text-foreground/90 transition hover:border-primary/50 hover:bg-primary/10"
              >
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TimeField({
  label,
  minutes,
  disabled,
  onChange,
  clearable,
}: {
  label: string;
  minutes: number | null;
  disabled: boolean;
  onChange: (minutes: number | null) => void;
  clearable?: boolean;
}) {
  return (
    <label className="min-w-0 basis-36">
      <span className={labelClass}>{label}</span>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <input
          type="time"
          value={minutes === null ? "" : hm(minutes)}
          disabled={disabled}
          onChange={(e) => {
            const next = parseHm(e.target.value);
            if (next !== null) onChange(next);
            else if (clearable && e.target.value === "") onChange(null);
          }}
          className={cn(fieldClass, "w-full")}
        />
        {clearable && minutes !== null && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="font-display shrink-0 text-[9px] uppercase tracking-widest text-muted-foreground hover:text-primary"
          >
            wyczyść
          </button>
        )}
      </div>
    </label>
  );
}

export function CommuteSettingsPanel({ onGoToKeys }: { onGoToKeys?: () => void }) {
  const settings = useCommuteSettings();
  const save = useServerFn(saveCommuteSettingsFn);
  const qc = useQueryClient();

  const mutate = useMutation({
    mutationFn: (patch: CommuteSettingsPatch) => save({ data: patch }),
    onSuccess: async () => {
      // Zmiana adresów i godzin unieważnia każdy policzony dojazd.
      await qc.invalidateQueries({ queryKey: ["commute"] });
      toast("Dojazd: zapisano");
    },
    onError: (err: unknown) =>
      toast("Nie udało się zapisać", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  const s = settings.data;
  const busy = settings.isLoading || mutate.isPending;
  const setPatch = (patch: CommuteSettingsPatch) => {
    mutate.mutate(patch);
    // Natychmiastowy odczyt do formularza, zanim wróci odświeżenie z serwera.
    qc.setQueryData(COMMUTE_SETTINGS_KEY, (old: typeof s) => (old ? { ...old, ...patch } : old));
  };

  return (
    <div className="space-y-6">
      <HudPanel index={1} title="DOJAZD DO PRACY" className="p-5">
        {s && !s.tomtomLinked && (
          <p className="mt-3 min-w-0 break-words rounded border border-warning/40 px-3 py-2 text-xs text-warning">
            Brak klucza TomTom — bez niego nie wyznaczę trasy ani nie wyszukam adresu.{" "}
            {onGoToKeys && (
              <button type="button" onClick={onGoToKeys} className="underline">
                Dodaj klucz w zakładce Klucze API
              </button>
            )}
          </p>
        )}

        <div className="mt-4 grid gap-5 @min-[560px]:grid-cols-2">
          <PlacePicker
            title="Dom"
            value={s?.home ?? null}
            disabled={busy || !s?.tomtomLinked}
            onPick={(home) => setPatch({ home })}
          />
          <PlacePicker
            title="Praca"
            value={s?.work ?? null}
            disabled={busy || !s?.tomtomLinked}
            onPick={(work) => setPatch({ work })}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-4">
          <TimeField
            label="wyjazd z domu"
            minutes={s?.departToMin ?? null}
            disabled={busy}
            onChange={(m) => m !== null && setPatch({ departToMin: m })}
          />
          <TimeField
            label="wyjazd z pracy"
            minutes={s?.departBackMin ?? null}
            disabled={busy}
            onChange={(m) => m !== null && setPatch({ departBackMin: m })}
          />
          <TimeField
            label="być w pracy na"
            minutes={s?.arriveByMin ?? null}
            disabled={busy}
            clearable
            onChange={(m) => setPatch({ arriveByMin: m })}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => setPatch({ alertEnabled: !(s?.alertEnabled ?? true) })}
            className={cn(
              btnClass,
              !(s?.alertEnabled ?? true) && "border-muted-foreground/40 text-muted-foreground",
            )}
          >
            {(s?.alertEnabled ?? true)
              ? "alert o opóźnieniu: włączony"
              : "alert o opóźnieniu: wyłączony"}
          </button>
          <label className="min-w-0 basis-40">
            <span className={labelClass}>alert od opóźnienia</span>
            <select
              value={s?.alertDelayMin ?? 10}
              disabled={busy || !(s?.alertEnabled ?? true)}
              onChange={(e) => setPatch({ alertDelayMin: Number(e.target.value) })}
              className={cn(fieldClass, "mt-1 w-full")}
            >
              {DELAYS.map((d) => (
                <option key={d} value={d} className="bg-popover">
                  +{d} min względem typowego
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="mt-5 min-w-0 break-words text-xs text-muted-foreground">
          Dojazd liczymy dla dni roboczych (pn–pt). Poranny briefing podaje czas na godzinę wyjazdu
          z domu, więc ustaw jego godzinę (Powiadomienia) <b>przed</b> wyjazdem — przy wyjeździe o
          06:00 briefing na 05:00. „Być w pracy na” włącza podpowiedź „wyjdź najpóźniej o…”. Adresy
          zapisujemy z dokładnością do metrów, bo trasy nie da się wyznaczyć z dokładnością
          kilometra — poza tabelą dojazdu nigdzie nie trafiają.
        </p>
      </HudPanel>
    </div>
  );
}
