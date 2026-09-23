// Kiedy briefing i czy głośno.
//
// DWIE DECYZJE, JEDNO MIEJSCE, bo użytkownik podejmuje je razem: „chcę go o
// siódmej, ale bez budzenia telefonu". Rozbicie ich po dwóch panelach
// kazałoby szukać drugiej połowy tej samej myśli gdzie indziej.
//
// GODZINA JEST LOKALNA i tak jest podpisana. Przeliczenie na UTC należy do
// nocnego joba (src/lib/format/warsaw.ts), nie do użytkownika — a granulacja
// jest godzinowa, bo zaplanowane przebiegi GitHuba potrafią spóźnić się
// kilkanaście minut i obietnica „7:45" byłaby obietnicą, której nie
// kontrolujemy. Panel mówi „około", zamiast udawać precyzję.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BellOff, BellRing, MapPin } from "lucide-react";
import { getUserSettings, updateUserSettings } from "@/lib/agents/runtime.functions";
import { PanelHint } from "@/components/jarvis/fuel/chrome";
import { cn } from "@/lib/utils";

const SETTINGS_QUERY_KEY = ["user-settings"] as const;

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Progi limitu. 0 na pierwszym miejscu, bo „nie pilnuj" to wybór, nie brak. */
const BUDGETS = [0, 5, 10, 20, 50, 100];

export function BriefScheduleControls() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getUserSettings);
  const save = useServerFn(updateUserSettings);

  const settings = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => fetchSettings(),
  });

  // Stan lokalny, żeby lista godzin reagowała od razu, a nie dopiero po
  // powrocie zapisu z serwera.
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    if (settings.data && hour === null) setHour(settings.data.briefHour);
  }, [settings.data, hour]);

  const mutate = useMutation({
    mutationFn: (patch: {
      briefHour?: number;
      briefPush?: boolean;
      monthlyBudgetUsd?: number;
      homeLat?: number;
      homeLon?: number;
    }) => save({ data: patch }),
    onSuccess: (fresh) => {
      qc.setQueryData(SETTINGS_QUERY_KEY, fresh);
      setHour(fresh.briefHour);
      toast(fresh.briefPush ? "Briefing: zapisano" : "Briefing: tryb cichy");
    },
    onError: (err: unknown) =>
      toast("Nie udało się zapisać", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  // Pytanie o lokalizację zadajemy RAZ, na wyraźne kliknięcie — nie przy
  // wejściu na Ustawienia. Zapisany punkt służy nocnemu jobowi, który
  // przeglądarki nie ma; wyskakujące okienko bez powodu nauczyłoby tylko
  // odruchowo je odklikiwać.
  const [locating, setLocating] = useState(false);
  const askForLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast("Przeglądarka nie udostępnia lokalizacji");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        mutate.mutate({ homeLat: pos.coords.latitude, homeLon: pos.coords.longitude });
      },
      (err) => {
        setLocating(false);
        toast("Nie udało się ustalić lokalizacji", { description: err.message });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60 * 60_000 },
    );
  };

  const hasLocation = settings.data?.homeLat != null && settings.data?.homeLon != null;
  const push = settings.data?.briefPush ?? true;
  const budget = settings.data?.monthlyBudgetUsd ?? 5;
  const busy = settings.isLoading || mutate.isPending;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 basis-40">
          <span className="font-display block text-[8px] uppercase tracking-[0.25em] text-muted-foreground">
            godzina briefingu
          </span>
          <select
            value={hour ?? 7}
            disabled={busy}
            onChange={(e) => {
              const next = Number(e.target.value);
              setHour(next);
              mutate.mutate({ briefHour: next });
            }}
            className="mt-1 w-full min-w-0 rounded border border-primary/25 bg-transparent px-2 py-1 font-mono text-xs text-foreground disabled:opacity-40"
          >
            {HOURS.map((h) => (
              <option key={h} value={h} className="bg-popover">
                około {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={busy}
          onClick={() => mutate.mutate({ briefPush: !push })}
          className={cn(
            "font-display flex shrink-0 items-center gap-2 rounded border px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] transition disabled:opacity-40",
            push
              ? "border-primary/40 text-primary hover:bg-primary/10"
              : "border-muted-foreground/40 text-muted-foreground hover:bg-muted/20",
          )}
        >
          {push ? (
            <BellRing className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          ) : (
            <BellOff className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          )}
          {push ? "budzi telefon" : "tryb cichy"}
        </button>
      </div>

      <label className="mt-4 block min-w-0 basis-40">
        <span className="font-display block text-[8px] uppercase tracking-[0.25em] text-muted-foreground">
          miesięczny limit na modele
        </span>
        <select
          value={budget}
          disabled={busy}
          onChange={(e) => mutate.mutate({ monthlyBudgetUsd: Number(e.target.value) })}
          className="mt-1 w-full min-w-0 max-w-[240px] rounded border border-primary/25 bg-transparent px-2 py-1 font-mono text-xs text-foreground disabled:opacity-40"
        >
          {BUDGETS.map((value) => (
            <option key={value} value={value} className="bg-popover">
              {value === 0 ? "bez limitu" : `$${value} / miesiąc`}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || locating}
          onClick={askForLocation}
          className="font-display flex shrink-0 items-center gap-2 rounded border border-primary/40 px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/10 disabled:opacity-40"
        >
          <MapPin className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {locating ? "ustalam…" : hasLocation ? "odśwież lokalizację" : "użyj mojej lokalizacji"}
        </button>
        <span className="min-w-0 break-words font-mono text-[11px] text-muted-foreground">
          {hasLocation
            ? `pogoda dla ${settings.data!.homeLat!.toFixed(2)}, ${settings.data!.homeLon!.toFixed(2)}`
            : "bez lokalizacji briefing nie mówi o pogodzie"}
        </span>
      </div>

      <PanelHint>
        Briefing zaczyna się od zdania o dniu — ile stopni, czy pada, czy warto wziąć parasol.
        Składa się w nocy, na serwerze, więc nie ma kogo zapytać o lokalizację; dlatego punkt
        zapisuje się raz, tym przyciskiem. Zapisujemy go z dokładnością do dwóch miejsc po
        przecinku, czyli około kilometra — prognoza dobowa i tak się na tym dystansie nie różni.
      </PanelHint>

      <PanelHint>
        Po przekroczeniu limitu agenci schodzą o stopień na tańszy model (Opus → Sonnet → Haiku →
        Gemini) zamiast odmawiać pracy — twarde „nie" znaczyłoby, że J.A.R.V.I.S. milknie w środku
        rozmowy. Ostrzeżenie przychodzi przy 80%, żeby zmiana nie była niespodzianką. „Bez limitu"
        wyłącza tylko degradację; licznik działa dalej.
      </PanelHint>

      <PanelHint>
        Czas lokalny. Rubryka powstaje przy pierwszym przebiegu po tej godzinie — zaplanowane
        przebiegi GitHuba bywają spóźnione o kilkanaście minut, więc dokładna minuta nie jest
        obietnicą, którą można złożyć uczciwie.{" "}
        {push
          ? "Gotowy briefing zapala dzwonek i puka w urządzenia."
          : "W trybie cichym briefing czeka na pulpicie i zapala dzwonek, ale nie powiadamia urządzeń."}
      </PanelHint>
    </div>
  );
}
