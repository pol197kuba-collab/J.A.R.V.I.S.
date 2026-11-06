// Krzywe kapitału graczy funduszu. W trybie 3D: wstęgi światła stojące jedna
// za drugą (RibbonChart3D, ta sama oś PLN — wszyscy startują ze 100 000 zł).
// Bez warstwy 3D (Town, brak WebGL, reduced motion): płaski wykres recharts.

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { RibbonChart3D } from "@/components/jarvis/charts3d/RibbonChart3D";
import { useRouteTransition } from "@/components/jarvis/TransitionContext";
import { DEFAULT_RULES } from "@/lib/fund/engine";
import type { FundPlayer, FundView } from "@/lib/fund/fund.functions";
import { PLAYER_COLOR, plnFmt, shortDate } from "./fundFormat";

function NavTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].sort((a, b) => Number(b.value) - Number(a.value));
  return (
    <div className="pointer-events-none rounded border border-primary/30 bg-popover px-2.5 py-1.5 shadow-lg">
      <p className="font-display text-[8px] uppercase tracking-widest text-muted-foreground">
        {String(label)}
      </p>
      <div className="mt-1 space-y-0.5">
        {sorted.map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: entry.color }}
            />
            <span className="font-display min-w-0 truncate text-[9px] uppercase tracking-wider text-muted-foreground">
              {entry.name}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[11px] font-bold text-foreground">
              {plnFmt(Number(entry.value))}
              <span className="ml-1 text-[9px] text-muted-foreground">zł</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FundNavChart({
  nav,
  players,
  highlight,
}: {
  nav: FundView["nav"];
  /** Gracze na wykresie (bez tych, którzy nie grają). */
  players: FundPlayer[];
  highlight: string | null;
}) {
  const { can3d } = useRouteTransition();
  const rows = useMemo(
    (): Array<Record<string, number | string> & { date: string; label: string }> =>
      nav.map((r) => ({ ...r, label: shortDate(String(r.date)) })),
    [nav],
  );

  const ribbon = useMemo(
    () => ({
      rows: rows.length,
      stacked: players.length > 1,
      dateLabel: (i: number) => (rows[i]?.label as string) ?? "",
      formatY: (v: number) => `${plnFmt(v / 1000, 1)}k`,
      series: players.map((p) => {
        const points: Array<{ i: number; v: number }> = [];
        rows.forEach((r, i) => {
          const v = r[p.key];
          if (typeof v === "number") points.push({ i, v });
        });
        return { key: p.key, color: PLAYER_COLOR[p.key] ?? "var(--muted-foreground)", points };
      }),
    }),
    [rows, players],
  );

  if (rows.length < 2 || players.length === 0) return null;

  if (can3d) {
    return (
      <RibbonChart3D
        className="mt-3 h-[400px] w-full @max-[520px]:h-[300px]"
        data={ribbon}
        fallback={null}
        tooltip={(i) => {
          const row = rows[i];
          if (!row) return null;
          const sorted = [...players]
            .filter((p) => typeof row[p.key] === "number")
            .sort((a, b) => Number(row[b.key]) - Number(row[a.key]));
          return (
            <div className="font-display text-center text-[10px] uppercase tracking-[0.16em] text-foreground [text-shadow:0_0_10px_black,0_0_14px_var(--reactor)]">
              {sorted.map((p) => (
                <b
                  key={p.key}
                  className="block text-[14px] font-normal tracking-[0.06em]"
                  style={{ color: PLAYER_COLOR[p.key] ?? "var(--muted-foreground)" }}
                >
                  {plnFmt(Number(row[p.key]))}{" "}
                  <span className="text-[9px] text-muted-foreground">zł · {p.label}</span>
                </b>
              ))}
              {new Date(`${row.date}T00:00:00`).toLocaleDateString("pl-PL")}
            </div>
          );
        }}
      />
    );
  }

  return (
    <div className="mt-2 h-[300px] w-full @max-[520px]:h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--primary)" strokeOpacity={0.08} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            width={52}
            domain={["auto", "auto"]}
            tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${plnFmt(v / 1000, 1)}k`}
          />
          {/* Kapitał startowy — powyżej zysk, poniżej strata. */}
          <ReferenceLine
            y={DEFAULT_RULES.startCashPln}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.4}
            strokeDasharray="2 4"
          />
          <Tooltip
            content={<NavTooltip />}
            cursor={{ stroke: "var(--primary)", strokeOpacity: 0.35 }}
          />
          {players.map((p) => (
            <Line
              key={p.key}
              type="monotone"
              dataKey={p.key}
              name={p.label}
              stroke={PLAYER_COLOR[p.key] ?? "var(--muted-foreground)"}
              strokeWidth={highlight === p.key ? 2.5 : 1.5}
              strokeOpacity={highlight && highlight !== p.key ? 0.55 : 1}
              strokeDasharray={p.kind === "source" ? undefined : "5 4"}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
              animationDuration={450}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
