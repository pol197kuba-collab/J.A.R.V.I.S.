// DORADCA (/rynki, przycisk „Doradca”): jak zagrać na prawdziwej giełdzie
// tak, jak grają gracze AI funduszu. Wariant A — karty zagrań: kierunek,
// siła, instrument w XTB, wejście, dźwignia, SL / TP, wielkość, termin;
// „Szczegóły” rozwijają powody (gracze, wskaźniki, newsy z linkami, historia)
// i instrukcję w XTB. „Analizuj teraz” = szybko (0 tokenów), „Głęboka
// analiza” = świeże AI na teraz (limit dzienny). Logika: src/lib/advisor/.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BrainCircuit,
  ChevronDown,
  Copy,
  ExternalLink,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  closeAdvisorPosition,
  getAdvice,
  recordAdvisorAction,
  saveAdvisorSettings,
  type Advice,
  type AdvisorJournalEntry,
} from "@/lib/advisor/advisor.functions";
import {
  ADVISOR_PLAYERS,
  GRADE_LABEL,
  orderText,
  PLAYER_LABEL,
  type AdvisorSettings,
  type Play,
} from "@/lib/advisor/plan";

const ADVISOR_QUERY_KEY = ["advisor", "advice"] as const;

// ------------------------------------------------------------ formaty ----

function fmtPx(v: number): string {
  const digits = v >= 1000 ? 0 : v >= 10 ? 2 : v >= 1 ? 3 : 5;
  return v.toLocaleString("pl-PL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
const zl = (v: number) => `${Math.round(v).toLocaleString("pl-PL")} zł`;
const pct = (v: number, digits = 1) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("pl-PL", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
const day = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("pl-PL", { weekday: "short", day: "2-digit", month: "2-digit" });
};
const when = (iso: string | null) =>
  iso
    ? iso.length <= 10
      ? `zamknięcie ${day(iso)}`
      : new Date(iso).toLocaleString("pl-PL", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
    : "—";

const REGIME_LABEL: Record<string, string> = {
  uptrend: "trend wzrostowy",
  downtrend: "trend spadkowy",
  range: "konsolidacja",
  volatile: "duża zmienność",
};

const sideTone = (side: "buy" | "sell") => (side === "buy" ? "text-success" : "text-destructive");
const sideBorder = (side: "buy" | "sell") =>
  side === "buy" ? "border-success/45" : "border-destructive/45";

function GradeBadge({ play }: { play: Play }) {
  return (
    <span
      className={cn(
        "font-display px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em]",
        play.grade === "strong"
          ? cn(sideTone(play.side), play.side === "buy" ? "bg-success/15" : "bg-destructive/15")
          : play.grade === "medium"
            ? "bg-warning/15 text-warning"
            : "bg-muted-foreground/15 text-muted-foreground",
      )}
    >
      {GRADE_LABEL[play.grade]}
    </span>
  );
}

function Field({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="font-display text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <p className={cn("break-words font-mono text-[14px] font-semibold text-foreground", tone)}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="font-display text-[10px] uppercase tracking-[0.25em] text-primary">● {title}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- karta ----

function PlayCard({
  play,
  done,
  defaultOpen,
}: {
  play: Play;
  done: AdvisorJournalEntry | undefined;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [entering, setEntering] = useState(false);
  const [fill, setFill] = useState(String(play.entry));
  const qc = useQueryClient();
  const record = useServerFn(recordAdvisorAction);
  const act = useMutation({
    mutationFn: (action: "played" | "skipped") => {
      const entry = action === "played" ? Number(fill.replace(",", ".")) : play.entry;
      if (!(entry > 0)) throw new Error("Podaj cenę wejścia.");
      // SL i TP przesuwamy o tyle, o ile różni się faktyczne wejście.
      const k = entry / play.entry;
      return record({
        data: {
          action,
          play: {
            symbol: play.symbol,
            label: play.label,
            side: play.side,
            strength: play.strength,
            entry,
            stop: play.stop * k,
            take: play.take * k,
            expiresOn: play.expiresOn,
            lots: null,
            units: null,
            snapshot: { ...play, news: play.news.slice(0, 2) },
          },
        },
      });
    },
    onSuccess: (_r, action) => {
      toast.success(action === "played" ? "Zapisane — pilnuję pozycji." : "Pominięte.");
      setEntering(false);
      void qc.invalidateQueries({ queryKey: ADVISOR_QUERY_KEY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(orderText(play, fmtPx));
      toast.success("Zlecenie skopiowane.");
    } catch {
      toast.error("Nie udało się skopiować.");
    }
  };

  const long = play.side === "buy";

  return (
    <article
      className={cn(
        "min-w-0 border p-3.5",
        sideBorder(play.side),
        play.grade === "weak" && "border-dashed opacity-80",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p
            className={cn(
              "font-display text-[11px] uppercase tracking-[0.2em]",
              sideTone(play.side),
            )}
          >
            {long ? "▲ Kup · długo" : "▼ Sprzedaj · krótko"}
          </p>
          <h3 className="break-words text-[18px] font-bold leading-tight text-foreground">
            {play.label}
          </h3>
          <p className="break-words text-[11px] text-muted-foreground">
            XTB · CFD „{play.xtbName}” · cena {when(play.priceAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-display text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
            siła
          </span>
          <span className={cn("font-mono text-[22px] font-bold leading-none", sideTone(play.side))}>
            {play.strength}
          </span>
          <GradeBadge play={play} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 @max-[300px]:grid-cols-1">
        <Field label="wejście" value={`~${fmtPx(play.entry)}`} sub={play.currency} />
        <Field
          label="dźwignia"
          value={play.leverage > 1 ? `1:${play.leverage}` : "bez dźwigni"}
          sub={`limit XTB 1:${play.leverageCap}`}
        />
        <Field
          label="stop-loss"
          value={fmtPx(play.stop)}
          sub={`${pct((long ? -1 : 1) * play.stopPct * 100)} od wejścia`}
          tone="text-warning"
        />
        <Field
          label="take-profit"
          value={fmtPx(play.take)}
          sub={`${pct((long ? 1 : -1) * play.takePct * 100)} od wejścia`}
          tone="text-success"
        />
        <Field label="ile zagrać" value={play.portfolioHint} />
        <Field label="trzymaj do" value={day(play.expiresOn)} sub="horyzont prognozy 2 dni" />
      </div>
      <div className="mt-2.5 space-y-1 border-t border-primary/15 pt-2 text-[11px]">
        <p className="text-foreground">
          Za {zl(play.stakePln)}
          {play.leverage > 1 && ` (pozycja ${zl(play.positionPln)})`}: przy TP{" "}
          <b className="text-success">~+{zl(play.profitPln)}</b>, przy SL{" "}
          <b className="text-destructive">~−{zl(play.lossPln)}</b>
        </p>
        <p className="text-muted-foreground">
          w tym koszty brokera ok. {zl(play.costPln)} (spread
          {play.nights > 0 ? ` + ${play.nights} ${play.nights === 1 ? "noc" : "noce"}` : ""}) ·
          zgodność graczy {play.agree}/{play.total}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="font-display flex min-h-10 flex-1 items-center justify-center gap-1.5 border border-primary/40 px-3 text-[10px] uppercase tracking-[0.16em] text-primary hover:bg-primary/10"
        >
          Szczegóły
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
        <button
          type="button"
          onClick={copy}
          className="font-display flex min-h-10 flex-1 items-center justify-center gap-1.5 border border-primary/20 px-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
        >
          <Copy className="h-3.5 w-3.5" />
          Kopiuj zlecenie
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-5 border-t border-primary/15 pt-4">
          <Section title="Zgodność graczy">
            <div className="grid grid-cols-2 gap-2 @max-[300px]:grid-cols-1">
              {ADVISOR_PLAYERS.map((key) => {
                const v = play.votes.find((x) => x.player === key);
                const tone =
                  !v || v.direction === "flat"
                    ? "text-muted-foreground"
                    : v.direction === "up"
                      ? "text-success"
                      : "text-destructive";
                return (
                  <div key={key} className="min-w-0 border-b border-primary/15 py-1.5 text-[12px]">
                    {PLAYER_LABEL[key]}{" "}
                    <b className={tone}>
                      {!v ? "—" : v.direction === "up" ? "▲" : v.direction === "down" ? "▼" : "●"}{" "}
                      {v ? `${v.confidence}%` : "brak"}
                    </b>
                  </div>
                );
              })}
            </div>
            {play.history && play.history.cases > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Historia (60 dni): podobne zagrania — {play.history.cases}, trafne{" "}
                {play.history.hits} ({Math.round((play.history.hits / play.history.cases) * 100)}%)
              </p>
            )}
          </Section>

          {play.votes.some((v) => v.rationalePl) && (
            <Section title="Wnioski AI">
              <div className="space-y-2">
                {play.votes
                  .filter((v) => v.rationalePl && v.player !== "ai_7d")
                  .map((v) => (
                    <p
                      key={v.player}
                      className="min-w-0 break-words border-l-2 border-primary/40 pl-3 text-[12px] leading-relaxed"
                    >
                      <span className="text-muted-foreground">{PLAYER_LABEL[v.player]}: </span>
                      {v.rationalePl}
                    </p>
                  ))}
              </div>
            </Section>
          )}

          <Section title="Wskaźniki">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px] @max-[300px]:grid-cols-1">
              <Field
                label="trend 20 sesji"
                value={play.trend20Pct === null ? "—" : pct(play.trend20Pct)}
              />
              <Field
                label="zmiana 5 sesji"
                value={play.momentum5Pct === null ? "—" : pct(play.momentum5Pct)}
              />
              <Field
                label="zmienność dzienna"
                value={play.dailyVolPct === null ? "—" : pct(play.dailyVolPct).replace("+", "")}
              />
              <Field
                label="reżim rynku"
                value={play.regime ? (REGIME_LABEL[play.regime] ?? play.regime) : "—"}
              />
              <Field
                label="wynik techniczny"
                value={play.technicalScore === null ? "—" : String(Math.round(play.technicalScore))}
              />
              <Field
                label="wydźwięk newsów"
                value={
                  play.sentimentScore === null
                    ? "—"
                    : play.sentimentScore.toFixed(2).replace(".", ",")
                }
              />
            </div>
          </Section>

          <Section title="Newsy">
            {play.news.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                Brak newsów o tym instrumencie z ostatnich 3 dni.
              </p>
            ) : (
              <ul className="space-y-1">
                {play.news.map((n) => (
                  <li key={n.link} className="min-w-0 border-b border-primary/15 py-2">
                    <a
                      href={n.link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="group flex min-w-0 flex-col gap-1 text-foreground no-underline"
                    >
                      <span className="break-words text-[13px] leading-snug group-hover:text-primary">
                        {n.title}
                      </span>
                      {n.summaryPl && (
                        <span className="break-words text-[11px] text-muted-foreground">
                          {n.summaryPl}
                        </span>
                      )}
                      <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span
                          className={
                            n.impact === "positive"
                              ? "text-success"
                              : n.impact === "negative"
                                ? "text-destructive"
                                : undefined
                          }
                        >
                          {n.impact === "positive"
                            ? "▲ pozytywny"
                            : n.impact === "negative"
                              ? "▼ negatywny"
                              : "● neutralny"}
                        </span>
                        {n.source && <span>· {n.source}</span>}
                        {n.publishedAt && <span>· {when(n.publishedAt)}</span>}
                        <ExternalLink className="h-3 w-3" />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Jak to wpisać w XTB">
            <ol className="list-decimal space-y-1 pl-5 text-[12px] leading-relaxed">
              <li>
                Wyszukaj <b>{play.xtbName}</b> → <b>{long ? "KUP" : "SPRZEDAJ"}</b>
              </li>
              <li>
                Dźwignia <b>{play.leverage > 1 ? `1:${play.leverage}` : "bez dźwigni (1:1)"}</b>,
                stawka <b>{play.portfolioHint}</b>
              </li>
              <li>
                Stop-loss <b>{fmtPx(play.stop)}</b> · Take-profit <b>{fmtPx(play.take)}</b>
              </li>
              <li>
                Zamknij najpóźniej <b>{day(play.expiresOn)}</b> — dostaniesz push
              </li>
            </ol>
            <p className="text-[11px] text-muted-foreground">
              Unieważnienie: cena {long ? "poniżej" : "powyżej"} {fmtPx(play.stop)} albo gracze
              obracają się przeciw pozycji.
            </p>
          </Section>
        </div>
      )}

      <div className="mt-3 border-t border-primary/15 pt-3">
        {done ? (
          <p className="font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {done.action === "played" ? `✓ Zagrane po ${fmtPx(done.entry)}` : "Pominięte"}
          </p>
        ) : entering ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="font-display block text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                Cena wejścia w XTB
              </span>
              <input
                inputMode="decimal"
                value={fill}
                onChange={(e) => setFill(e.target.value)}
                className="mt-1 h-10 w-full rounded border border-primary/25 bg-transparent px-2 font-mono text-[13px] text-foreground"
              />
            </label>
            <button
              type="button"
              disabled={act.isPending}
              onClick={() => act.mutate("played")}
              className="font-display h-10 border border-primary/60 bg-primary/12 px-4 text-[10px] uppercase tracking-[0.16em] text-primary disabled:opacity-40"
            >
              Zapisz
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEntering(true)}
              className="font-display min-h-10 flex-1 border border-primary/60 bg-primary/10 text-[10px] uppercase tracking-[0.16em] text-primary"
            >
              Zagrałem
            </button>
            <button
              type="button"
              disabled={act.isPending}
              onClick={() => act.mutate("skipped")}
              className="font-display min-h-10 flex-1 border border-primary/20 text-[10px] uppercase tracking-[0.16em] text-muted-foreground disabled:opacity-40"
            >
              Pomijam
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

// ------------------------------------------------------------ pozycje ----

function OpenPositions({ entries }: { entries: AdvisorJournalEntry[] }) {
  const qc = useQueryClient();
  const close = useServerFn(closeAdvisorPosition);
  const m = useMutation({
    mutationFn: (id: string) => close({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ADVISOR_QUERY_KEY }),
  });
  const open = entries.filter((e) => e.action === "played" && e.status === "open");
  if (open.length === 0) return null;
  return (
    <Section title="Twoje pozycje (pilnuję ich)">
      <ul className="space-y-1">
        {open.map((e) => (
          <li
            key={e.id}
            className="flex min-w-0 items-center justify-between gap-3 border-b border-primary/15 py-2"
          >
            <div className="min-w-0">
              <p className="break-words text-[13px] font-semibold">
                <span className={sideTone(e.side)}>{e.side === "buy" ? "▲" : "▼"}</span> {e.label}
              </p>
              <p className="text-[10px] text-muted-foreground">
                wejście {fmtPx(e.entry)} · SL {fmtPx(e.stop)} · TP {fmtPx(e.take)} · do{" "}
                {day(e.expiresOn)}
              </p>
            </div>
            <button
              type="button"
              disabled={m.isPending}
              onClick={() => m.mutate(e.id)}
              className="font-display shrink-0 border border-primary/25 px-2.5 py-2 text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
            >
              Zamknąłem
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------- ustawienia ----

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="min-w-0">
      <span className="font-display block text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </span>
      <span className="mt-1.5 flex items-center gap-1.5">
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-9 w-full min-w-0 rounded border border-primary/20 bg-transparent px-2 font-mono text-[12px] text-foreground"
        />
        {suffix && <span className="shrink-0 text-[11px] text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
}

function SettingsView({ settings, onDone }: { settings: AdvisorSettings; onDone: () => void }) {
  const [stake, setStake] = useState(settings.stakePln);
  const qc = useQueryClient();
  const save = useServerFn(saveAdvisorSettings);
  const m = useMutation({
    mutationFn: () => save({ data: { settings: { ...settings, stakePln: stake } } }),
    onSuccess: () => {
      toast.success("Zapisane.");
      void qc.invalidateQueries({ queryKey: ADVISOR_QUERY_KEY });
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="min-w-0 space-y-5 pb-6">
      <NumberField
        label="Kwota zagrania"
        value={stake}
        step={100}
        suffix="zł"
        onChange={setStake}
      />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Karty przeliczają każdy sygnał na tę kwotę: ile mniej więcej zarobisz przy take-profit i
        stracisz przy stop-lossie, po kosztach brokera (spread i opłata za noc w XTB, szacunkowo).
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={m.isPending || !(stake > 0)}
          onClick={() => m.mutate()}
          className="font-display min-h-10 flex-1 border border-primary/60 bg-primary/10 text-[10px] uppercase tracking-[0.16em] text-primary disabled:opacity-40"
        >
          Zapisz
        </button>
        <button
          type="button"
          onClick={onDone}
          className="font-display min-h-10 flex-1 border border-primary/20 text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
        >
          Anuluj
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- całość ----

export function AdvisorSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const fetchAdvice = useServerFn(getAdvice);
  const qc = useQueryClient();
  const [view, setView] = useState<"plays" | "settings">("plays");
  const advice = useQuery({
    queryKey: ADVISOR_QUERY_KEY,
    queryFn: () => fetchAdvice({ data: {} }),
    enabled: open,
    staleTime: 60_000,
  });
  const deep = useMutation({
    mutationFn: () => fetchAdvice({ data: { deep: true } }),
    onSuccess: (a) => {
      qc.setQueryData<Advice>(ADVISOR_QUERY_KEY, a);
      toast.success(`Głęboka analiza gotowa${a.model ? ` (${a.model})` : ""}.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  useEffect(() => {
    if (!open) setView("plays");
  }, [open]);

  const a = advice.data;
  const busy = advice.isFetching || deep.isPending;
  const todayDone = new Map<string, AdvisorJournalEntry>();
  const today = new Date().toISOString().slice(0, 10);
  for (const e of a?.journal ?? []) {
    const k = `${e.symbol}|${e.side}`;
    if ((e.createdAt.slice(0, 10) === today || e.status === "open") && !todayDone.has(k))
      todayDone.set(k, e);
  }
  const moodLean =
    a && a.mood.down > a.mood.up ? "spadków" : a && a.mood.up > a.mood.down ? "wzrostów" : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="no-scrollbar w-full overflow-y-auto overflow-x-hidden sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle className="font-display text-[14px] uppercase tracking-[0.3em] text-primary">
            Doradca
          </SheetTitle>
          <SheetDescription className="text-[11px]">
            {a
              ? `Stan na ${new Date(a.generatedAt).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${a.mode === "deep" ? `głęboka analiza${a.model ? ` · ${a.model}` : ""}` : "zgodność 4 graczy AI"} · broker XTB · kwota ${zl(a.settings.stakePln)}`
              : "Jak zagrać na rynku tak, jak grają gracze AI."}
          </SheetDescription>
        </SheetHeader>

        <div className="@container mt-4 min-w-0">
          {view === "settings" && a ? (
            <SettingsView settings={a.settings} onDone={() => setView("plays")} />
          ) : (
            <div className="min-w-0 space-y-4 pb-6">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void advice.refetch()}
                  className="font-display flex min-h-11 flex-1 items-center justify-center gap-2 border border-primary/60 bg-primary/10 px-3 text-[10px] uppercase tracking-[0.18em] text-primary disabled:opacity-40"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", advice.isFetching && "animate-spin")} />
                  Analizuj teraz
                </button>
                <button
                  type="button"
                  disabled={busy || (a?.deepLeft ?? 0) === 0}
                  onClick={() => deep.mutate()}
                  className="font-display flex min-h-11 flex-1 items-center justify-center gap-2 border border-primary/30 px-3 text-[10px] uppercase tracking-[0.18em] text-primary disabled:opacity-40"
                >
                  <BrainCircuit className={cn("h-3.5 w-3.5", deep.isPending && "animate-pulse")} />
                  Głęboka analiza{a ? ` (${a.deepLeft})` : ""}
                </button>
                <button
                  type="button"
                  aria-label="Ustawienia doradcy"
                  disabled={!a}
                  onClick={() => setView("settings")}
                  className="flex min-h-11 w-11 items-center justify-center border border-primary/30 text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </div>
              {deep.isPending && (
                <p className="text-[11px] text-muted-foreground">
                  AI analizuje rynek od nowa — to potrwa do minuty…
                </p>
              )}

              {a && (
                <p className="flex items-center gap-2 text-[11px]">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-2 w-2 rounded-full",
                      moodLean === "spadków"
                        ? "bg-destructive"
                        : moodLean === "wzrostów"
                          ? "bg-success"
                          : "bg-muted-foreground",
                    )}
                  />
                  Rynek: {moodLean ? `przewaga ${moodLean}` : "bez wyraźnej przewagi"} ·{" "}
                  {a.mood.down}▼ / {a.mood.up}▲ / {a.mood.flat} bez zdania
                </p>
              )}

              {advice.isError && (
                <p className="text-[12px] text-destructive">
                  {advice.error instanceof Error
                    ? advice.error.message
                    : "Nie udało się pobrać propozycji."}
                </p>
              )}
              {advice.isPending && (
                <p className="text-[12px] text-muted-foreground">Liczę propozycje…</p>
              )}

              {a && <OpenPositions entries={a.journal} />}

              {a && a.plays.length === 0 && (
                <p className="text-[12px] text-muted-foreground">
                  Gracze nie mają teraz wspólnego zdania o żadnym instrumencie — nic do zagrania.
                  Spróbuj głębokiej analizy albo wróć po kolejnym przeliczeniu (8:30 / 20:00).
                </p>
              )}
              {a?.plays.map((p, i) => (
                <PlayCard
                  key={`${p.symbol}|${p.side}|${a.generatedAt}`}
                  play={p}
                  done={todayDone.get(`${p.symbol}|${p.side}`)}
                  defaultOpen={i === 0 && p.grade === "strong"}
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
