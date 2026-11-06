// MÓZG AI (/rynki): czego „AI z wnioskami” się nauczyło, od kiedy, z czego
// i czy to w ogóle pomaga. Od góry: werdykt A/B (to samo AI bez wniosków
// obok), dzisiejsze wnioski z osią czasu, skąd się biorą; wygasłe wnioski i
// decyzje, w których wnioski coś zmieniły — zwinięte.
//
// Wniosek to zdanie z policzonych statystyk (lessons.ts), nie opinia modelu
// o sobie — panel tylko je pokazuje.

import { ArrowDownRight, ArrowUpRight, Check, Minus, X } from "lucide-react";
import { PanelHint } from "@/components/jarvis/fuel/chrome";
import type { FundView } from "@/lib/fund/fund.functions";
import type { AiBrain, PredictionScoreboard } from "@/lib/markets/markets.functions";
import type { AssetClass } from "@/lib/markets/assets";
import { CLASS_LABEL } from "./marketsDigest";
import { Fold } from "./Fold";
import { pctFmt } from "./fundFormat";

const KIND: Record<AiBrain["lessons"][number]["kind"], { label: string; color: string }> = {
  direction: { label: "trafność", color: "var(--warning)" },
  base_rate: { label: "co robi rynek", color: "var(--primary)" },
  pnl: { label: "złotówki", color: "var(--success)" },
};

const SOURCE: Record<string, string> = {
  ai: "AI",
  ai_learned: "AI z wnioskami",
  signals: "Sygnały",
};

const DIR: Record<string, { label: string; Icon: typeof Minus; color: string }> = {
  up: { label: "wzrost", Icon: ArrowUpRight, color: "var(--success)" },
  down: { label: "spadek", Icon: ArrowDownRight, color: "var(--destructive)" },
  flat: { label: "bez zmian", Icon: Minus, color: "var(--muted-foreground)" },
};

/** 1 wniosek, 2–4 wnioski, 5+ wniosków (12–14 też „wniosków”). */
const lessonWord = (n: number): string =>
  n === 1
    ? "wniosek"
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? "wnioski"
      : "wniosków";

const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
      {children}
    </p>
  );
}

/** One side of the A/B: hit rate (when there are enough settlements) and fund result. */
function Side({
  name,
  row,
  minimum,
  fundPct,
}: {
  name: string;
  row: { resolved: number; hits: number; hitRate: number | null } | undefined;
  minimum: number;
  fundPct: number | null;
}) {
  const enough = (row?.resolved ?? 0) >= minimum;
  return (
    <div className="min-w-0">
      <p className="font-display truncate text-[10px] uppercase tracking-[0.18em] text-foreground">
        {name}
      </p>
      <p className="mt-1 font-mono text-[12px] tabular-nums">
        {row?.hitRate == null ? (
          <span className="text-muted-foreground">brak rozliczeń</span>
        ) : enough ? (
          <>
            trafia <b className="text-foreground">{Math.round(row.hitRate / 10)} na 10</b>
          </>
        ) : (
          <span className="text-muted-foreground">
            {row.resolved}/{minimum} rozliczonych
          </span>
        )}
      </p>
      <p className="font-mono text-[11px] text-muted-foreground">
        fundusz{" "}
        {fundPct === null ? (
          "—"
        ) : (
          <span style={{ color: fundPct >= 0 ? "var(--success)" : "var(--destructive)" }}>
            {pctFmt(fundPct)}
          </span>
        )}
      </p>
    </div>
  );
}

export function AiBrainPanel({
  brain,
  board,
  fund,
}: {
  brain: AiBrain;
  board: PredictionScoreboard | undefined;
  fund: FundView | undefined;
}) {
  const h = brain.horizonDays;
  const row = (src: string) => board?.bySource.find((r) => r.key === `${src}·${h}`);
  const plain = row("ai");
  const learned = row("ai_learned");
  const minimum = board?.minimumMeaningful ?? 20;
  const fundPct = (key: string) =>
    fund?.players.find((p) => p.key === key)?.metrics?.returnPct ?? null;

  const enough =
    (plain?.resolved ?? 0) >= minimum &&
    (learned?.resolved ?? 0) >= minimum &&
    plain?.hitRate != null &&
    learned?.hitRate != null;
  const diff = enough ? learned!.hitRate! - plain!.hitRate! : null;
  const verdict =
    diff === null
      ? `Za wcześnie na werdykt — potrzeba po ${minimum} rozliczonych prognoz każdego (jest ${plain?.resolved ?? 0} i ${learned?.resolved ?? 0}).`
      : Math.abs(diff) < 3
        ? `Na razie bez różnicy: wnioski nie zmieniają trafności (${diff >= 0 ? "+" : "−"}${Math.abs(Math.round(diff))} pp).`
        : diff > 0
          ? `Wnioski pomagają: +${Math.round(diff)} pp trafności względem tego samego AI bez nich.`
          : `Wnioski na razie szkodzą: −${Math.round(-diff)} pp trafności względem tego samego AI bez nich.`;
  const ds = brain.divergenceScore;

  const active = brain.timeline.filter((s) => s.active);
  const spanOf = new Map(active.map((s) => [s.text, s]));
  const expired = brain.timeline.filter((s) => !s.active);
  const f = brain.funnel;

  return (
    <div className="min-w-0">
      <p className="text-[12px] leading-relaxed text-foreground/85">
        „AI z wnioskami” to ten sam model co „AI”, z tą samą instrukcją — plus kilka wniosków
        policzonych z rozliczonych prognoz. Porównanie obu pokazuje, czy nauka coś daje.
      </p>

      {/* czy to działa */}
      <div className="mt-4 grid grid-cols-2 gap-4 @max-[420px]:grid-cols-1">
        <Side name="AI" row={plain} minimum={minimum} fundPct={fundPct("ai")} />
        <Side
          name="AI z wnioskami"
          row={learned}
          minimum={minimum}
          fundPct={fundPct("ai_learned")}
        />
      </div>
      <p className="mt-2 min-w-0 break-words border-l-2 border-primary/40 pl-3 text-xs leading-relaxed text-foreground/85">
        {verdict}
        {ds.settled > 0 &&
          ` Gdy oba zdecydowały inaczej (${ds.settled} rozliczonych): rację miały wnioski ${ds.learnedRight}×, zwykłe AI ${ds.plainRight}×.`}
      </p>

      {/* czego się nauczył */}
      <div className="mt-5">
        <SubTitle>
          Czego się nauczył · {brain.lessons.length} {lessonWord(brain.lessons.length)}
          {h !== 2 && ` (z prognoz ${h}-dniowych)`}
        </SubTitle>
        {brain.lessons.length === 0 ? (
          <div className="mt-2 space-y-1 font-mono text-[10px] leading-snug text-muted-foreground">
            <p>
              Jeszcze żadnego. Wniosek wymaga co najmniej 12 rozliczonych przypadków z dwóch tygodni
              i trafności wyraźnie innej niż losowa — do tego czasu „AI z wnioskami” nie gra.
            </p>
            {brain.progress.closest && (
              <p>
                Najbliżej: „{brain.progress.closest.scope}”, prognozy{" "}
                {brain.progress.closest.direction} — {brain.progress.closest.cases}/12 przypadków,{" "}
                {Math.min(brain.progress.closest.weeks, 2)}/2 tyg.
              </p>
            )}
          </div>
        ) : (
          <ul className="mt-2 space-y-2.5">
            {brain.lessons.map((l) => {
              const span = spanOf.get(l.textPl);
              return (
                <li
                  key={l.textPl}
                  className="min-w-0 border-l-2 pl-3"
                  style={{
                    borderColor: `color-mix(in oklab, ${KIND[l.kind].color} 70%, transparent)`,
                  }}
                >
                  <p className="min-w-0 break-words text-[12px] leading-snug text-foreground/90">
                    {l.textPl}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    <span style={{ color: KIND[l.kind].color }}>{KIND[l.kind].label}</span> ·{" "}
                    {l.cases} przypadków z {l.weeks} tyg.
                    {span && span.days > 0
                      ? ` · AI dostaje go od ${day(span.firstSeen)} (${span.days} ${span.days === 1 ? "dzień" : "dni"})`
                      : " · nowy — AI dostanie go przy najbliższej prognozie"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {brain.progress.enoughButRandom > 0 && (
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            {brain.progress.enoughButRandom}{" "}
            {brain.progress.enoughButRandom === 1 ? "sytuacja ma" : "sytuacje mają"} już dość
            danych, ale wynik jest tam losowy — tu nie ma czego się nauczyć.
          </p>
        )}
      </div>

      {/* z czego się uczy */}
      <div className="mt-5">
        <SubTitle>Z czego się uczy</SubTitle>
        <p className="mt-1.5 text-[12px] leading-relaxed text-foreground/85">
          Z <b className="font-mono">{f.total}</b> rozliczonych prognoz z ostatnich{" "}
          {brain.windowDays} dni — wszystkich graczy, bo liczy się to, co rynek zrobił w danej
          sytuacji, a nie kto ją przewidywał.
        </p>
        <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {Object.entries(f.bySource)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${SOURCE[k] ?? k} ${v}`)
            .join(" · ")}
          {Object.keys(f.byClass).length > 0 && " — "}
          {Object.entries(f.byClass)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${CLASS_LABEL[k as AssetClass] ?? k} ${v}`)
            .join(" · ")}
        </p>
      </div>

      {brain.divergences.length > 0 && (
        <Fold title="Wnioski w akcji" hint="gdzie zdecydowały inaczej niż zwykłe AI">
          <ul className="space-y-2.5">
            {brain.divergences.map((d) => {
              const a = DIR[d.plain.direction] ?? DIR.flat;
              const b = DIR[d.learned.direction] ?? DIR.flat;
              const mark = (o: "hit" | "miss" | null) =>
                o === "hit" ? (
                  <Check className="inline h-3 w-3 text-success" aria-label="trafiona" />
                ) : o === "miss" ? (
                  <X className="inline h-3 w-3 text-destructive" aria-label="chybiona" />
                ) : null;
              return (
                <li key={`${d.symbol}-${d.madeOn}`} className="min-w-0">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12px]">
                    <span className="text-foreground">{d.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {day(d.madeOn)}
                    </span>
                    <span className="font-mono text-[10px]" style={{ color: a.color }}>
                      AI: {a.label} {mark(d.plain.outcome)}
                    </span>
                    <span className="font-mono text-[10px]" style={{ color: b.color }}>
                      z wnioskami: {b.label} {mark(d.learned.outcome)}
                    </span>
                  </p>
                  {d.learned.rationalePl && (
                    <p className="mt-0.5 min-w-0 break-words text-[11px] leading-snug text-foreground/65">
                      {d.learned.rationalePl}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Fold>
      )}

      {expired.length > 0 && (
        <Fold title="Wnioski, które wygasły" hint={String(expired.length)}>
          <ul className="space-y-1.5">
            {expired.map((s) => (
              <li key={s.key} className="min-w-0 text-[11px] leading-snug text-foreground/70">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {day(s.firstSeen)}–{day(s.lastSeen)} ·{" "}
                </span>
                {s.text}
              </li>
            ))}
          </ul>
          <PanelHint>
            Wniosek wygasa, gdy nowe rozliczenia zbliżą wynik do losowego albo gdy jego przypadki
            wypadną z okna {brain.windowDays} dni — rynek zmienia charakter.
          </PanelHint>
        </Fold>
      )}
    </div>
  );
}
