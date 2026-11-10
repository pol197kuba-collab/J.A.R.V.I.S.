import { useMemo } from "react";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { useHudNavigate } from "@/components/jarvis/TransitionContext";
import { commuteFacts } from "@/lib/commute/brief";
import { defaultDirection } from "@/lib/commute/plan";
import { useCommute, useCommuteSettings } from "@/lib/commute/useCommute";

// Kafelek na stronie głównej: sama liczba i stan, trasa jest w module.
// Nic się nie pokazuje, dopóki nie ma kompletu konfiguracji — pusty kafelek
// z „brak danych" zabierałby miejsce na pulpicie, a konfiguracja i tak jest
// w Ustawieniach → Dojazd (Situation Room podpowiada, co brakuje).

export function CommuteTile({ index = 0 }: { index?: number }) {
  const { go } = useHudNavigate();
  const settings = useCommuteSettings();
  const configured = !!settings.data?.home && !!settings.data?.work && settings.data.tomtomLinked;
  const direction = settings.data ? defaultDirection(new Date(), settings.data) : "to";
  const commute = useCommute(direction, configured);

  const facts = useMemo(
    () =>
      commute.data?.status === "ok"
        ? commuteFacts(commute.data.result, commute.data.settings)
        : null,
    [commute.data],
  );

  if (settings.isLoading) return null;

  const delay = facts?.delayMin ?? null;
  const tone =
    delay === null || delay < 5
      ? "var(--success)"
      : delay < 10
        ? "var(--warning)"
        : "var(--destructive)";
  const hasIncidents = (facts?.incidents.length ?? 0) > 0;

  return (
    <HudPanel
      index={index}
      title={direction === "to" ? "DOJAZD // DO PRACY" : "DOJAZD // DO DOMU"}
      tone="quiet"
      className="p-4"
    >
      {!configured ? (
        <p className="mt-2 min-w-0 break-words text-xs text-muted-foreground">
          Ustaw adresy i klucz TomTom w Ustawieniach → Dojazd, a tu pojawi się czas dojazdu.
        </p>
      ) : !facts ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {commute.isError ? "Brak danych o ruchu." : "Sprawdzam ruch…"}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => go("/situation-room")}
          className="mt-2 block w-full min-w-0 text-left"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-4xl leading-none text-primary @max-[380px]:text-3xl">
              {facts.durationMin}
              <span className="ml-1 text-base">min</span>
            </span>
            <span
              className="font-display border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em]"
              style={{ color: tone, borderColor: tone }}
            >
              {hasIncidents
                ? "utrudnienia"
                : delay !== null && delay >= 5
                  ? `+${delay} min`
                  : "płynnie"}
            </span>
          </div>
          <p className="mt-2 min-w-0 break-words text-[11px] text-muted-foreground">
            {[
              `wyjazd ${facts.departHm}`,
              facts.arriveHm ? `przyjazd ${facts.arriveHm}` : null,
              facts.detour && facts.detour.savesMin > 0
                ? `objazd −${facts.detour.savesMin} min`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </button>
      )}
    </HudPanel>
  );
}
