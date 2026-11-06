// Panel FUNDUSZ w /rynki: komu ufać, w złotówkach — najpierw to, co ważne.
//
// Od góry: od kiedy gra i na jakich zasadach (Ustawienia, Przelicz), werdykt
// w zdaniach, ranking (klik w gracza = jego karta: portfel, historia pozycji,
// transakcje) i krzywe kapitału — w trybie 3D jako wstęgi światła. Porównanie
// instrumentów, zdarzenia na żywo i zasady gry są zwinięte.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, RefreshCw, SlidersHorizontal } from "lucide-react";
import { EmptyState, PanelHint } from "@/components/jarvis/fuel/chrome";
import { assetBySymbol } from "@/lib/markets/assets";
import { getFundSettings, type FundPlayer, type FundView } from "@/lib/fund/fund.functions";
import { DEFAULT_FUND_SETTINGS, describeSettings, LIVE_OPTIONS } from "@/lib/fund/settings";
import { fundVerdict, isWaiting, startingWith, waitingFor } from "@/lib/fund/verdict";
import { SESSION_LABEL } from "@/lib/markets/schedule";
import { Fold } from "./Fold";
import { FundNavChart } from "./FundNavChart";
import { FundPlayerSheet } from "./FundPlayerSheet";
import { FundSettingsSheet } from "./FundSettingsSheet";
import { SymbolComparison } from "./FundSummary";
import { KIND_BADGE, PLAYER_COLOR, pctFmt, plnFmt, signColor, zlFmt } from "./fundFormat";
import { Swatch } from "./Swatch";

const LIVE_KIND: Record<string, string> = {
  stop: "stop-loss",
  take: "take-profit",
  alarm: "alarm: zamknięcie",
  alarm_hold: "alarm: trzymaj",
};

/** Granie na żywo: czy przebieg co 15 min działa i co dziś zrobił. */
function LiveStrip({ live }: { live: NonNullable<FundView["live"]> }) {
  const last = live.lastRunAt ? new Date(live.lastRunAt) : null;
  const ageMin = last ? (Date.now() - last.getTime()) / 60_000 : null;
  const ok = ageMin !== null && ageMin < 40;
  const t = live.today;
  return (
    <div className="mt-3 min-w-0 border border-primary/15 px-3 py-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: ok ? "var(--success)" : "var(--warning)" }}
          />
          <span className="font-display text-[9px] uppercase tracking-widest text-primary/80">
            Na żywo
          </span>
        </span>
        <span>
          {last
            ? `ostatni przebieg ${last.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`
            : "jeszcze nie biegł"}
          {last && !ok && " — przerwa, sprawdź Actions → Market Live"}
        </span>
        <span>
          24 h: {t.fill} realizacji · {t.stop} stop-loss · {t.take} take-profit · {t.alarm} zamknięć
          z alarmu · {t.alarmHold} „trzymaj”
        </span>
      </p>
      {live.recent.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {live.recent.map((e) => (
            <li
              key={`${e.at}-${e.player}-${e.symbol}-${e.kind}`}
              className="min-w-0 break-words text-[11px] leading-snug text-foreground/80"
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                {new Date(e.at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
              </span>{" "}
              {assetBySymbol(e.symbol)?.label ?? e.symbol} · {LIVE_KIND[e.kind] ?? e.kind}
              {e.kind.startsWith("alarm") && e.reason
                ? ` — ${e.reason.replace(/^Alarm AI[^:]*: /, "")}`
                : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const dayPl = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pl-PL");

function RankRow({
  player,
  rank,
  totalPln,
  onOpen,
}: {
  player: FundPlayer;
  rank: number | null;
  totalPln: number | undefined;
  onOpen: () => void;
}) {
  const m = player.metrics;
  const waiting = isWaiting(player);
  const pending = !waiting && startingWith(player) > 0;
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 items-center gap-2.5 border-b border-primary/10 px-1 py-2.5 text-left transition-colors hover:bg-primary/5"
      >
        <span className="w-4 shrink-0 font-mono text-[10px] text-muted-foreground">
          {rank === null ? "–" : `${rank}.`}
        </span>
        <Swatch
          color={PLAYER_COLOR[player.key] ?? "var(--muted-foreground)"}
          dashed={player.kind !== "source"}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{player.label}</span>
          <span className="block truncate font-mono text-[10px] text-muted-foreground">
            {waiting
              ? `nie gra — czeka na ${waitingFor(player.key)}`
              : pending
                ? "czeka na pierwsze zlecenia"
                : `${KIND_BADGE[player.kind] ? `${KIND_BADGE[player.kind]} · ` : ""}${m?.trades ?? 0} transakcji · wycena ${plnFmt(player.navPln)} zł`}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span
            className="block font-mono text-base font-bold"
            style={{
              color: m && !waiting ? signColor(m.returnPct * 100) : "var(--muted-foreground)",
            }}
          >
            {m && !waiting ? pctFmt(m.returnPct) : "—"}
          </span>
          {!waiting && (
            <span
              className="block font-mono text-[10px]"
              style={{ color: signColor(totalPln ?? 0) }}
            >
              {zlFmt(totalPln ?? player.navPln - 100_000)}
            </span>
          )}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary/50" aria-hidden />
      </button>
    </li>
  );
}

export function FundPanel({
  view,
  onRecompute,
  recomputing,
}: {
  view: FundView;
  onRecompute: () => void;
  recomputing: boolean;
}) {
  const fetchSettings = useServerFn(getFundSettings);
  const settingsQuery = useQuery({
    queryKey: ["fund-settings"],
    queryFn: () => fetchSettings(),
    staleTime: 5 * 60_000,
  });
  const settings = settingsQuery.data?.settings ?? DEFAULT_FUND_SETTINGS;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cardKey, setCardKey] = useState<string | null>(null);

  // Gracz bez prognoz nie gra — jego 0% nie może stać w rankingu nad tymi,
  // którzy grają i tracą. Idzie na koniec, bez numeru.
  const ranked = useMemo(
    () =>
      [...view.players].sort(
        (a, b) =>
          Number(isWaiting(a) || startingWith(a) > 0) -
            Number(isWaiting(b) || startingWith(b) > 0) ||
          (b.metrics?.returnPct ?? 0) - (a.metrics?.returnPct ?? 0),
      ),
    [view.players],
  );
  const playing = useMemo(() => view.players.filter((p) => !isWaiting(p)), [view.players]);

  const verdict = useMemo(
    () =>
      fundVerdict(
        view.players.map((p) => ({
          key: p.key,
          label: p.label,
          kind: p.kind,
          returnPct: p.metrics?.returnPct ?? 0,
          waiting: isWaiting(p),
          startingWith: startingWith(p),
        })),
        view.nav.length,
      ),
    [view.players, view.nav.length],
  );

  const live = view.live;
  const lastLive = live?.lastRunAt ? new Date(live.lastRunAt) : null;
  const liveAgeMin = lastLive ? (Date.now() - lastLive.getTime()) / 60_000 : null;
  const liveOk =
    settings.liveEveryMin !== 0 &&
    liveAgeMin !== null &&
    liveAgeMin < Math.max(40, settings.liveEveryMin * 2.5);
  const liveLabel =
    settings.liveEveryMin === 0
      ? "takt rynku wyłączony (ceny tylko wieczorem)"
      : `takt rynku co ${settings.liveEveryMin} min${
          lastLive
            ? ` · ostatnio ${lastLive.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`
            : ""
        }`;
  const own = Object.keys(settings.overrides).length;

  const header = (
    <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-display text-[11px] uppercase tracking-[0.2em] text-foreground">
          Gra od {dayPl(view.startedOn ?? settings.startOn)}
          <span className="ml-2 text-muted-foreground">· 100 000 zł na gracza · papier</span>
        </p>
        <p className="mt-1 min-w-0 break-words font-mono text-[10px] text-muted-foreground">
          {describeSettings(settings.global)}
          {own > 0 && ` · ${own} ${own === 1 ? "gracz AI ma" : "graczy AI ma"} własne`}
        </p>
        <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              background:
                settings.liveEveryMin === 0
                  ? "var(--muted-foreground)"
                  : liveOk
                    ? "var(--success)"
                    : "var(--warning)",
            }}
          />
          {liveLabel}
          {view.computedAt &&
            ` · przeliczono ${new Date(view.computedAt).toLocaleString("pl-PL", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}`}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="font-display flex h-9 items-center gap-1.5 border border-primary/50 px-3 text-[9px] uppercase tracking-widest text-primary transition hover:bg-primary/20"
        >
          <SlidersHorizontal className="h-3 w-3" />
          Ustawienia
        </button>
        <button
          type="button"
          disabled={recomputing}
          onClick={onRecompute}
          className="font-display flex h-9 items-center gap-1.5 border border-primary/50 px-3 text-[9px] uppercase tracking-widest text-primary transition hover:bg-primary/20 disabled:opacity-40"
        >
          <RefreshCw className={recomputing ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
          Przelicz
        </button>
      </div>
    </div>
  );

  const sheets = (
    <>
      <FundSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} />
      <FundPlayerSheet
        player={view.players.find((p) => p.key === cardKey) ?? null}
        summary={cardKey ? view.summary?.[cardKey] : undefined}
        settings={settings}
        onOpenChange={(o) => !o && setCardKey(null)}
      />
    </>
  );

  if (view.players.length === 0) {
    return (
      <>
        {header}
        <EmptyState>
          Fundusz jeszcze nie przeliczony — kliknij „Przelicz” albo poczekaj na wieczorny przebieg
        </EmptyState>
        {sheets}
      </>
    );
  }

  let rank = 0;
  return (
    <>
      {header}

      {verdict.length > 0 && (
        <div className="mt-4 space-y-1 border-l-2 border-primary/40 pl-3">
          {verdict.slice(0, 3).map((line) => (
            <p
              key={line}
              className="min-w-0 break-words text-xs leading-relaxed text-foreground/85"
            >
              {line}
            </p>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-x-8 gap-y-2 @min-[900px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <div className="min-w-0">
          <p className="font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
            Ranking · kliknij gracza
          </p>
          <ul className="mt-1" aria-label="Ranking graczy">
            {ranked.map((p) => {
              const unranked = isWaiting(p) || startingWith(p) > 0;
              if (!unranked) rank += 1;
              return (
                <RankRow
                  key={p.key}
                  player={p}
                  rank={unranked ? null : rank}
                  totalPln={view.summary?.[p.key]?.totalPln}
                  onOpen={() => setCardKey(p.key)}
                />
              );
            })}
          </ul>
        </div>
        <div className="min-w-0">
          <p className="font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
            Kapitał w czasie
          </p>
          {view.nav.length < 2 ? (
            <p className="mt-3 font-mono text-[10px] text-muted-foreground">
              Wykres pojawi się po drugim dniu gry.
            </p>
          ) : (
            <>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legenda wykresu">
                {playing.map((p) => (
                  <li key={p.key} className="flex items-center gap-1.5">
                    <Swatch
                      color={PLAYER_COLOR[p.key] ?? "var(--muted-foreground)"}
                      dashed={p.kind !== "source"}
                    />
                    <span className="font-display text-[9px] uppercase tracking-widest text-muted-foreground">
                      {p.label}
                    </span>
                  </li>
                ))}
              </ul>
              <FundNavChart nav={view.nav} players={playing} highlight={cardKey} />
            </>
          )}
        </div>
      </div>

      <Fold title="Porównanie wg instrumentu" hint="zysk / strata w zł">
        <SymbolComparison view={view} />
      </Fold>

      {live && (
        <Fold
          title="Zdarzenia na żywo"
          hint={`24 h: ${live.today.fill + live.today.stop + live.today.take + live.today.alarm}`}
        >
          <LiveStrip live={live} />
        </Fold>
      )}

      <Fold title="Zasady gry">
        <PanelHint>
          Decyzje AI: raz dziennie na instrument — {SESSION_LABEL.morning} (dni robocze, przed
          sesją) i {SESSION_LABEL.evening}. Takt rynku (w ustawieniach:{" "}
          {LIVE_OPTIONS.filter((v) => v > 0).join(" / ")} min albo wyłączony) odświeża ceny
          obserwowanych instrumentów i pilnuje pozycji. Realizacja po pierwszej cenie z ciągu dnia
          PO postawieniu prognozy, a bez niej — po kolejnym zamknięciu; nigdy po cenie, którą
          prognoza już znała. Prowizja 0,1% + spread. „Wzrost” = kupno, „spadek” = krótka sprzedaż
          (jeśli włączona), „bez zmian” = nic nowego. Pozycja = limit na pozycję × pewność ×
          dźwignia; limit, dźwignia i progi stop-loss / take-profit wynikają z agresywności w
          ustawieniach. Pożyczona gotówka kosztuje 7% rocznie, pożyczone papiery 1–10% rocznie.
          Margin call: gdy kapitał spadnie poniżej połowy wymaganego depozytu, wszystko jest
          zamykane. Pozycja żyje tyle, ile horyzont prognozy (2 dni; gracz kontrolny — 7 dni).
          Koszyk kupuje wszystko po równo w dniu startu i trzyma bez dźwigni; małpa rzuca losowo —
          oba zawsze na zasadach domyślnych, żeby było z czym porównać. Zmiana ustawień przelicza
          całą grę od dnia startu.
        </PanelHint>
      </Fold>

      {sheets}
    </>
  );
}
