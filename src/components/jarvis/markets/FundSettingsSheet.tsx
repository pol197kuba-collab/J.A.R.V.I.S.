// Ustawienia funduszu (/rynki): proste pokrętła zamiast parametrów silnika.
// Zakładki: „Wspólne” (wszyscy gracze-prognozy) i każdy gracz AI, który może
// mieć własne. Koszyk i małpa grają zawsze na domyślnych — inaczej przestają
// być punktem odniesienia. Zapis = przeliczenie gry od dnia startu.

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { saveFundSettings } from "@/lib/fund/fund.functions";
import {
  AGGRESSIVENESS_LABEL,
  AI_PLAYERS,
  DEFAULT_FUND_SETTINGS,
  describeSettings,
  LEVERAGE_OPTIONS,
  LIVE_OPTIONS,
  type AiPlayer,
  type Aggressiveness,
  type FundSettings,
  type PlayerSettings,
} from "@/lib/fund/settings";
import { PLAYERS } from "@/lib/fund/players";

type Tab = "global" | AiPlayer;

const label = (key: string) => PLAYERS.find((p) => p.key === key)?.label ?? key;

function Choice<T extends string | number | boolean>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: ReadonlyArray<{ v: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="font-display text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
        {name}
      </p>
      <div role="group" aria-label={name} className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            aria-pressed={value === o.v}
            onClick={() => onChange(o.v)}
            className={cn(
              "font-display h-8 min-w-12 rounded border px-2.5 text-[10px] uppercase tracking-[0.14em] transition-colors",
              value === o.v
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-primary/15 text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlayerKnobs({
  value,
  onChange,
}: {
  value: PlayerSettings;
  onChange: (v: PlayerSettings) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <p className="flex items-baseline justify-between gap-2">
          <span className="font-display text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
            Agresywność
          </span>
          <span className="font-display text-[11px] uppercase tracking-[0.14em] text-primary">
            {AGGRESSIVENESS_LABEL[value.aggressiveness]}
          </span>
        </p>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={value.aggressiveness}
          aria-label="Agresywność"
          aria-valuetext={AGGRESSIVENESS_LABEL[value.aggressiveness]}
          onChange={(e) =>
            onChange({ ...value, aggressiveness: Number(e.target.value) as Aggressiveness })
          }
          className="mt-2 w-full accent-[var(--primary)]"
        />
        <p className="mt-0.5 flex justify-between font-mono text-[9px] text-muted-foreground">
          <span>ostrożnie</span>
          <span>agresywnie</span>
        </p>
      </div>
      <Choice
        name="Dźwignia (najwyżej)"
        value={value.leverage}
        options={LEVERAGE_OPTIONS.map((v) => ({
          v,
          label: v === 1 ? "bez" : `${String(v).replace(".", ",")}×`,
        }))}
        onChange={(leverage) => onChange({ ...value, leverage })}
      />
      <Choice
        name="Gra na spadki (krótka sprzedaż)"
        value={value.allowShort}
        options={[
          { v: true, label: "tak" },
          { v: false, label: "nie" },
        ]}
        onChange={(allowShort) => onChange({ ...value, allowShort })}
      />
      <Choice
        name="Stop-loss i take-profit"
        value={value.riskExits}
        options={[
          { v: true, label: "tak" },
          { v: false, label: "nie" },
        ]}
        onChange={(riskExits) => onChange({ ...value, riskExits })}
      />
      <p className="min-w-0 break-words border-l-2 border-primary/40 pl-3 text-[11px] leading-relaxed text-foreground/80">
        {describeSettings(value)}
      </p>
    </div>
  );
}

export function FundSettingsSheet({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: FundSettings;
}) {
  const [draft, setDraft] = useState<FundSettings>(settings);
  const [tab, setTab] = useState<Tab>("global");
  useEffect(() => {
    if (open) {
      setDraft(settings);
      setTab("global");
    }
  }, [open, settings]);

  const qc = useQueryClient();
  const save = useServerFn(saveFundSettings);
  const mutation = useMutation({
    mutationFn: (s: FundSettings) => save({ data: { settings: s } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fund"] });
      qc.invalidateQueries({ queryKey: ["fund-settings"] });
      qc.invalidateQueries({ queryKey: ["fund-player"] });
      toast.success("Zapisano — gra przeliczona od dnia startu");
      onOpenChange(false);
    },
    onError: (err) =>
      toast.error(`Nie udało się zapisać: ${err instanceof Error ? err.message : String(err)}`),
  });

  const own = tab !== "global" ? draft.overrides[tab] : undefined;
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "global", label: "Wspólne" },
    ...AI_PLAYERS.map((k) => ({ id: k as Tab, label: label(k) })),
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="no-scrollbar w-full overflow-y-auto overflow-x-hidden sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="font-display text-[12px] uppercase tracking-[0.3em] text-primary">
            Ustawienia funduszu
          </SheetTitle>
          <SheetDescription className="text-[11px]">
            Zapis przelicza całą grę od dnia startu na nowych zasadach. Koszyk i małpa zawsze grają
            na domyślnych — to punkt odniesienia.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 min-w-0 space-y-5 pb-6">
          <div className="grid grid-cols-2 gap-4">
            <label className="min-w-0">
              <span className="font-display block text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                Start gry
              </span>
              <input
                type="date"
                value={draft.startOn}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => e.target.value && setDraft({ ...draft, startOn: e.target.value })}
                className="mt-1.5 h-8 w-full rounded border border-primary/20 bg-transparent px-2 font-mono text-[12px] text-foreground"
              />
            </label>
            <Choice
              name="Takt rynku (ceny i pilnowanie)"
              value={draft.liveEveryMin}
              options={LIVE_OPTIONS.map((v) => ({ v, label: v === 0 ? "wył." : `${v} min` }))}
              onChange={(liveEveryMin) => setDraft({ ...draft, liveEveryMin })}
            />
          </div>

          <div
            role="tablist"
            aria-label="Dla kogo"
            className="no-scrollbar flex gap-1 overflow-x-auto overflow-y-hidden border-b border-primary/10 pb-1"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "font-display shrink-0 rounded px-2 py-1.5 text-[9px] uppercase tracking-[0.16em] transition-colors",
                  tab === t.id
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {t.id !== "global" && draft.overrides[t.id] && (
                  <span className="ml-1 text-reactor">•</span>
                )}
              </button>
            ))}
          </div>

          {tab === "global" ? (
            <PlayerKnobs
              value={draft.global}
              onChange={(global) => setDraft({ ...draft, global })}
            />
          ) : (
            <div className="space-y-4">
              <Choice
                name={`${label(tab)} gra na`}
                value={own ? "own" : "global"}
                options={[
                  { v: "global", label: "wspólnych" },
                  { v: "own", label: "własnych" },
                ]}
                onChange={(v) => {
                  const overrides = { ...draft.overrides };
                  if (v === "own") overrides[tab] = { ...draft.global };
                  else delete overrides[tab];
                  setDraft({ ...draft, overrides });
                }}
              />
              {own ? (
                <PlayerKnobs
                  value={own}
                  onChange={(v) =>
                    setDraft({ ...draft, overrides: { ...draft.overrides, [tab]: v } })
                  }
                />
              ) : (
                <p className="min-w-0 break-words text-[11px] leading-relaxed text-muted-foreground">
                  Na wspólnych: {describeSettings(draft.global)}.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-primary/10 pt-4">
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(draft)}
              className="font-display h-9 border border-primary/50 px-4 text-[10px] uppercase tracking-widest text-primary transition hover:bg-primary/20 disabled:opacity-40"
            >
              {mutation.isPending ? "Przeliczam…" : "Zapisz i przelicz"}
            </button>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => setDraft(DEFAULT_FUND_SETTINGS)}
              className="font-display h-9 px-3 text-[9px] uppercase tracking-widest text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            >
              Domyślne
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
