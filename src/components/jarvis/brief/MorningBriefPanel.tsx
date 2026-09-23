// PORANNY BRIEFING na pulpicie.
//
// DATA JEST TU CZĘŚCIĄ TREŚCI, NIE OZDOBĄ. Panel pokazuje NAJNOWSZY briefing,
// a nie „dzisiejszy" — bo nocny job może jeszcze nie przebiec albo paść, a
// wczorajsza rubryka jest uczciwsza niż pusty ekran sugerujący, że nic się
// nie dzieje. Pod jednym warunkiem: użytkownik musi widzieć, z kiedy ona
// jest, inaczej przeczyta wczorajsze usterki jako dzisiejsze.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw, Volume2, VolumeX } from "lucide-react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { PanelHint } from "@/components/jarvis/fuel/chrome";
import { getLatestBrief, refreshBrief } from "@/lib/brief/brief.functions";
import { isSpeakingNow, onSpeaking, speak, speakCancel } from "@/lib/audio/speak";
import { cn } from "@/lib/utils";

const BRIEF_QUERY_KEY = ["brief", "latest"] as const;

/** „dziś" / „wczoraj" / „z 21 września" — wiek rubryki bez liczenia w głowie. */
function ageLabel(date: string, now: Date): string {
  const days = Math.round(
    (Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
      86_400_000,
  );
  if (days <= 0) return "dziś";
  if (days === 1) return "wczoraj";
  return `sprzed ${days} dni`;
}

export function MorningBriefPanel({ index = 0 }: { index?: number }) {
  const qc = useQueryClient();
  const fetchBrief = useServerFn(getLatestBrief);
  const rebuild = useServerFn(refreshBrief);

  const brief = useQuery({
    queryKey: BRIEF_QUERY_KEY,
    queryFn: () => fetchBrief(),
    staleTime: 10 * 60_000,
  });

  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    setSpeaking(isSpeakingNow());
    return onSpeaking(setSpeaking);
  }, []);

  // Cisza przy wyjściu ze strony. Bez tego briefing czyta się dalej po
  // przejściu do innego modułu i nie ma go czym zatrzymać.
  useEffect(() => () => speakCancel(), []);

  const refresh = useMutation({
    mutationFn: () => rebuild(),
    onSuccess: (fresh) => {
      qc.setQueryData(BRIEF_QUERY_KEY, fresh);
      toast("Briefing przeliczony");
    },
    onError: (err: unknown) =>
      toast("Nie udało się przeliczyć briefingu", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  const data = brief.data ?? null;
  const stale = data !== null && ageLabel(data.date, new Date()) !== "dziś";

  return (
    <HudPanel
      index={index}
      title="BRIEFING // PORANEK"
      className="p-0"
      rightSlot={
        <div className="flex shrink-0 items-center gap-2">
          {data && (
            <button
              type="button"
              onClick={() => (speaking ? speakCancel() : speak(data.spoken, { lang: "pl" }))}
              aria-label={speaking ? "Przerwij odczyt" : "Przeczytaj briefing"}
              className="font-display flex items-center gap-1.5 rounded border border-primary/40 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/10"
            >
              {speaking ? (
                <VolumeX className="h-3 w-3" strokeWidth={2} aria-hidden />
              ) : (
                <Volume2 className="h-3 w-3" strokeWidth={2} aria-hidden />
              )}
              {speaking ? "stop" : "czytaj"}
            </button>
          )}
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            aria-label="Przelicz briefing"
            className="text-muted-foreground transition hover:text-primary disabled:opacity-40"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refresh.isPending && "animate-spin")}
              strokeWidth={2}
              aria-hidden
            />
          </button>
        </div>
      }
    >
      <div className="p-5 @max-[420px]:p-4">
        {brief.isLoading ? (
          <p className="font-mono text-[11px] text-muted-foreground">Wczytuję…</p>
        ) : !data ? (
          <>
            <p className="min-w-0 break-words font-mono text-[11px] leading-relaxed text-foreground/80">
              Briefingu jeszcze nie ma. Pierwszy powstanie o godzinie ustawionej w Ustawieniach —
              albo teraz, przyciskiem obok.
            </p>
            <PanelHint>
              Rubryka składa się z tego, co zapisały nocne joby: notowań, cen paliw, wyzwolonych
              rozkazów, zadań po terminie i awarii z ostatniej doby.
            </PanelHint>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="min-w-0 break-words font-mono text-[13px] text-foreground @max-[380px]:text-[12px]">
                {data.greeting}
              </p>
              <span
                className={cn(
                  "font-display shrink-0 text-[8px] uppercase tracking-[0.25em]",
                  stale ? "text-[color:var(--warning)]" : "text-muted-foreground",
                )}
              >
                {ageLabel(data.date, new Date())} · {data.date}
              </span>
            </div>

            {data.sections.length === 0 ? (
              <p className="mt-3 min-w-0 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                Nic nie wymaga dziś uwagi.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-4 @max-[560px]:grid-cols-1">
                {data.sections.map((section) => (
                  <section key={section.kind} className="min-w-0">
                    <h3 className="font-display text-[9px] uppercase tracking-[0.25em] text-primary">
                      {section.heading}
                    </h3>
                    <ul className="mt-1 space-y-0.5">
                      {section.lines.map((line) => (
                        <li
                          key={line}
                          className="min-w-0 break-words font-mono text-[11px] leading-relaxed text-foreground/85"
                        >
                          {line}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {stale && (
              <PanelHint>
                To rubryka {ageLabel(data.date, new Date())}. Nocny przebieg mógł jeszcze nie
                wystartować albo paść — przycisk odświeżenia złoży ją na teraz.
              </PanelHint>
            )}
          </>
        )}
      </div>
    </HudPanel>
  );
}
