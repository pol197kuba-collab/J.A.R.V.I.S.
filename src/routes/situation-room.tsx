import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HudPanel } from "@/components/jarvis/HudPanel";
import { useHudNavigate } from "@/components/jarvis/TransitionContext";
import { CommuteMap } from "@/components/jarvis/commute/CommuteMap";
import { RouteEditor, type EditorState } from "@/components/jarvis/commute/RouteEditor";
import { RoutesPanel } from "@/components/jarvis/commute/RoutesPanel";
import {
  deleteCommuteRouteFn,
  previewCommuteRouteFn,
  saveCommuteRouteFn,
  setDefaultCommuteRouteFn,
} from "@/lib/commute/commute.functions";
import { commuteFacts } from "@/lib/commute/brief";
import { defaultDirection, hmOf, minutesOf } from "@/lib/commute/plan";
import { INCIDENT_LABEL } from "@/lib/commute/tomtom";
import { useCommute, useCommuteSettings, useMapTileKey } from "@/lib/commute/useCommute";
import {
  MAX_VIA_POINTS,
  type CommuteDirection,
  type CommuteIncident,
  type CommuteResult,
  type SavedRoute,
} from "@/lib/commute/types";
import { useDepth3d } from "@/lib/theme/useDepth3d";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Dojazd do pracy: czas z ruchem na żywo, utrudnienia na trasie, objazdy i mapa trasy.";

export const Route = createFileRoute("/situation-room")({
  head: () => ({
    meta: [
      { title: "JARVIS // Situation Room" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "JARVIS // Situation Room" },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  component: SituationRoomPage,
});

const SETTINGS_TAB_KEY = "jarvis_settings_tab";

/** Przejście do Ustawień na właściwą zakładkę (ta jest zapamiętywana w localStorage). */
function SettingsLink({ tab, children }: { tab: "keys" | "commute"; children: string }) {
  const { go } = useHudNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        try {
          window.localStorage.setItem(SETTINGS_TAB_KEY, tab);
        } catch {
          /* ignore */
        }
        go("/settings");
      }}
      className="font-display inline-block border border-primary/60 px-3 py-2 text-[10px] uppercase tracking-widest text-primary hover:bg-primary/20"
    >
      {children}
    </button>
  );
}

function toneForDelay(delay: number | null): string {
  if (delay === null || delay < 5) return "var(--success)";
  if (delay < 10) return "var(--warning)";
  return "var(--destructive)";
}

function SituationRoomPage() {
  const settings = useCommuteSettings();
  const [picked, setPicked] = useState<CommuteDirection | null>(null);
  const direction: CommuteDirection =
    picked ?? (settings.data ? defaultDirection(new Date(), settings.data) : "to");
  const [showDetour, setShowDetour] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const depth3d = useDepth3d();
  const [tiltPref, setTiltPref] = useState<boolean | null>(null);
  // Podczas edycji mapa jest płaska — klik na pochylonej płaszczyźnie trafiałby obok.
  const tilt = (tiltPref ?? depth3d) && !editor;

  const tileKey = useMapTileKey();
  const commute = useCommute(direction, !!settings.data);
  const response = commute.data;

  const ok = response?.status === "ok" ? response : null;

  // Którą trasę oglądamy; nieznane id (np. po zmianie kierunku) = domyślna.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = ok
    ? (ok.result.options.find((o) => o.id === selectedId) ?? ok.result.options[0])
    : null;

  const facts = useMemo(
    () => (ok && selected ? commuteFacts(ok.result, ok.settings, selected) : null),
    [ok, selected],
  );

  // ---- Moje trasy: edytor, podgląd na żywo, zapis ----
  const qc = useQueryClient();
  const saveRoute = useServerFn(saveCommuteRouteFn);
  const setDefault = useServerFn(setDefaultCommuteRouteFn);
  const deleteRoute = useServerFn(deleteCommuteRouteFn);
  const previewRoute = useServerFn(previewCommuteRouteFn);

  const viaKey = editor
    ? JSON.stringify(editor.via.map((v) => [v.lat.toFixed(5), v.lon.toFixed(5)]))
    : "";
  const preview = useQuery({
    queryKey: ["commute", "preview", direction, viaKey],
    queryFn: () => previewRoute({ data: { direction, via: editor!.via } }),
    enabled: !!editor && editor.via.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const [routeBusy, setRouteBusy] = useState(false);
  const runRouteAction = async (action: () => Promise<unknown>, done: string) => {
    setRouteBusy(true);
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["commute"] });
      toast(done);
      return true;
    } catch (err) {
      toast("Nie udało się", { description: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      setRouteBusy(false);
    }
  };

  const startAdd = () => {
    setEditor({ id: null, name: "", via: [], makeDefault: false });
  };
  const startEdit = (r: SavedRoute) =>
    setEditor({ id: r.id, name: r.name, via: r.via, makeDefault: r.isDefault });
  const saveEditor = async () => {
    if (!editor) return;
    const saved = await runRouteAction(
      () =>
        saveRoute({
          data: {
            id: editor.id ?? undefined,
            direction,
            name: editor.name.trim(),
            via: editor.via,
            makeDefault: editor.makeDefault,
          },
        }),
      "Trasa zapisana",
    );
    if (saved) {
      setEditor(null);
      setSelectedId(null);
    }
  };

  // „Odświeżono" — minuta od ostatniego pobrania, żeby nie stało na starej wartości.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const tabs: Array<[CommuteDirection, string]> = [
    ["to", "DO PRACY"],
    ["back", "POWRÓT"],
  ];

  return (
    <div className="space-y-3 p-3 @max-[420px]:space-y-2 @max-[420px]:p-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div role="tablist" aria-label="Kierunek dojazdu" className="flex gap-5">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={direction === id}
              onClick={() => {
                setPicked(id);
                setSelectedId(null);
                setEditor(null);
              }}
              className={cn(
                "font-display border-b-2 pb-1 text-[11px] uppercase tracking-[0.18em] transition",
                direction === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-primary",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <span className="font-display text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            {response?.status === "ok"
              ? `${response.result.live ? "RUCH NA ŻYWO" : `PROGNOZA NA ${facts?.departHm ?? ""}`} · ${hmOf(new Date(response.result.fetchedAt))} · TomTom`
              : "TomTom"}
          </span>
          <button
            type="button"
            aria-pressed={tilt}
            disabled={!!editor}
            onClick={() => setTiltPref(!tilt)}
            className="font-display border border-primary/40 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-primary hover:bg-primary/10 disabled:opacity-40"
          >
            {tilt ? "WIDOK 2D" : "WIDOK 3D"}
          </button>
          <button
            type="button"
            disabled={commute.isFetching}
            onClick={() => void commute.refetch()}
            className="font-display border border-primary/40 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-primary hover:bg-primary/10 disabled:opacity-40"
          >
            {commute.isFetching ? "ODŚWIEŻAM…" : "ODŚWIEŻ"}
          </button>
        </div>
      </div>

      {settings.isLoading || (commute.isLoading && !response) ? (
        <HudPanel index={0} title="DOJAZD // WYZNACZAM TRASĘ" className="p-5">
          <p className="mt-3 text-xs text-muted-foreground">Pobieram ruch i utrudnienia…</p>
        </HudPanel>
      ) : commute.isError ? (
        <HudPanel index={0} title="DOJAZD // BRAK ŁĄCZNOŚCI" className="p-5">
          <p className="mt-3 min-w-0 break-words text-xs" style={{ color: "var(--destructive)" }}>
            {commute.error instanceof Error ? commute.error.message : "Nie udało się pobrać trasy."}{" "}
            Szczegóły w System Logs.
          </p>
          <button
            type="button"
            onClick={() => void commute.refetch()}
            className="font-display mt-4 border border-primary/60 px-3 py-2 text-[10px] uppercase tracking-widest text-primary hover:bg-primary/20"
          >
            SPRÓBUJ PONOWNIE
          </button>
        </HudPanel>
      ) : response && response.status !== "ok" ? (
        <HudPanel
          index={0}
          title={response.status === "no_key" ? "DOJAZD // BRAK KLUCZA" : "DOJAZD // BRAK ADRESÓW"}
          className="p-5"
        >
          <p className="mt-3 min-w-0 break-words text-xs text-muted-foreground">
            {response.status === "no_key"
              ? "Dojazd korzysta z TomTom (darmowy klucz z developer.tomtom.com). Dodaj go w Ustawieniach, potem ustaw adresy."
              : "Podaj adres domu i pracy, a policzę czas dojazdu, pokażę utrudnienia i objazdy."}
          </p>
          <div className="mt-4">
            <SettingsLink tab={response.status === "no_key" ? "keys" : "commute"}>
              {response.status === "no_key" ? "DODAJ KLUCZ" : "USTAW ADRESY"}
            </SettingsLink>
          </div>
        </HudPanel>
      ) : ok && facts && selected ? (
        <div className="grid grid-cols-1 gap-3 @[900px]:grid-cols-[minmax(0,1fr)_360px]">
          <HudPanel
            index={1}
            title={`${ok.result.origin.label} → ${ok.result.destination.label}`}
            className="flex flex-col"
          >
            <div className="relative h-[55vh] min-h-[300px] overflow-hidden">
              <CommuteMap
                result={ok.result}
                selectedId={selected.id}
                showDetour={showDetour}
                tilt={tilt}
                tileKey={tileKey.data?.key ?? null}
                editor={
                  editor
                    ? {
                        via: editor.via,
                        preview: preview.data?.points ?? null,
                        onAdd: (p) =>
                          setEditor((e) =>
                            e && e.via.length < MAX_VIA_POINTS ? { ...e, via: [...e.via, p] } : e,
                          ),
                        onMove: (i, p) =>
                          setEditor((e) =>
                            e ? { ...e, via: e.via.map((v, k) => (k === i ? p : v)) } : e,
                          ),
                      }
                    : null
                }
              />
              <div className="pointer-events-none absolute left-3 top-3 font-display text-[9px] uppercase tracking-[0.25em] text-primary/70">
                {editor
                  ? "EDYCJA TRASY · KLIKNIJ, ŻEBY DODAĆ PUNKT"
                  : `${selected.name} · ${(selected.route.distanceM / 1000).toFixed(1).replace(".", ",")} KM`}
              </div>
            </div>
          </HudPanel>

          <div className="flex min-w-0 flex-col gap-3">
            {editor ? (
              <RouteEditor
                state={editor}
                onChange={setEditor}
                preview={preview.data ?? null}
                previewing={preview.isFetching}
                previewError={preview.error instanceof Error ? preview.error.message : null}
                saving={routeBusy}
                onSave={() => void saveEditor()}
                onCancel={() => setEditor(null)}
              />
            ) : (
              <>
                <SummaryPanel facts={facts} direction={direction} />
                <RoutesPanel
                  result={ok.result}
                  saved={ok.saved}
                  selectedId={selected.id}
                  busy={routeBusy}
                  onSelect={setSelectedId}
                  onSetDefault={(id) =>
                    void runRouteAction(
                      () => setDefault({ data: { direction, id } }),
                      id ? "Ustawiono trasę domyślną" : "Domyślna: najszybsza automatyczna",
                    )
                  }
                  onAdd={startAdd}
                  onEdit={startEdit}
                  onDelete={(r) =>
                    void runRouteAction(() => deleteRoute({ data: { id: r.id } }), "Trasa usunięta")
                  }
                />
                <IncidentsPanel
                  incidents={ok.result.incidents}
                  mainIds={selected.route.incidentIds}
                />
                <DetourPanel
                  result={ok.result}
                  showDetour={showDetour}
                  onToggle={() => setShowDetour((v) => !v)}
                  onPick={setSelectedId}
                />
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryPanel({
  facts,
  direction,
}: {
  facts: ReturnType<typeof commuteFacts>;
  direction: CommuteDirection;
}) {
  const tone = toneForDelay(facts.delayMin);
  return (
    <HudPanel
      index={2}
      title={`DOJAZD ${direction === "to" ? "DO PRACY" : "DO DOMU"} · WYJAZD ${facts.departHm}`}
      className="p-4"
    >
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="holo-stat-value font-display text-5xl leading-none text-primary @max-[380px]:text-4xl">
          {facts.durationMin}
          <span className="ml-1 text-xl">min</span>
        </span>
        {facts.delayMin !== null && (
          <span
            className="font-display border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]"
            style={{ color: tone, borderColor: tone }}
          >
            {facts.delayMin >= 5
              ? `+${facts.delayMin} min vs typowo`
              : facts.delayMin <= -3
                ? `${facts.delayMin} min vs typowo`
                : "jak zwykle"}
          </span>
        )}
      </div>
      <p className="mt-2 min-w-0 break-words text-xs text-muted-foreground">
        {[
          facts.typicalMin !== null ? `typowo ${facts.typicalMin} min` : null,
          facts.arriveHm ? `przyjazd ${facts.arriveHm}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {facts.leaveByHm && facts.arriveByHm && direction === "to" && (
        <p className="mt-3 min-w-0 break-words border-l-2 border-primary bg-primary/10 px-3 py-2 text-xs">
          Żeby być na {facts.arriveByHm}, wyjdź najpóźniej o{" "}
          <b className="text-primary">{facts.leaveByHm}</b>.
        </p>
      )}
    </HudPanel>
  );
}

const incidentTone = (i: CommuteIncident) =>
  i.kind === "accident" || i.kind === "closure" || i.severity >= 3
    ? "var(--destructive)"
    : "var(--warning)";

function IncidentsPanel({
  incidents,
  mainIds,
}: {
  incidents: CommuteIncident[];
  mainIds: string[];
}) {
  const onMain = incidents.filter((i) => mainIds.includes(i.id));
  return (
    <HudPanel
      index={3}
      title={`UTRUDNIENIA NA TRASIE (${onMain.length})`}
      tone="quiet"
      className="p-4"
    >
      {onMain.length === 0 ? (
        <p className="mt-3 text-xs" style={{ color: "var(--success)" }}>
          Bez zgłoszonych utrudnień na trasie.
        </p>
      ) : (
        <ul className="no-scrollbar mt-3 max-h-64 space-y-3 overflow-y-auto overflow-x-hidden">
          {onMain.map((i) => {
            const where =
              [i.road, i.from && i.to ? `${i.from} → ${i.to}` : (i.from ?? i.to)]
                .filter(Boolean)
                .join(", ") || "na trasie";
            const facts = [
              i.delaySec ? `+${minutesOf(i.delaySec)} min` : null,
              i.startTime ? `od ${hmOf(new Date(i.startTime))}` : null,
              i.endTime ? `do ${hmOf(new Date(i.endTime))}` : null,
            ].filter(Boolean);
            return (
              <li key={i.id} className="min-w-0 text-xs">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className="font-display shrink-0 border px-1.5 py-0.5 text-[9px] tracking-[0.12em]"
                    style={{ color: incidentTone(i), borderColor: incidentTone(i) }}
                  >
                    {INCIDENT_LABEL[i.kind]}
                  </span>
                  <b className="min-w-0 break-words">{where}</b>
                </div>
                {(i.description || facts.length > 0) && (
                  <p className="mt-1 min-w-0 break-words text-muted-foreground">
                    {[i.description, facts.join(" · ")].filter(Boolean).join(" — ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </HudPanel>
  );
}

function DetourPanel({
  result,
  showDetour,
  onToggle,
  onPick,
}: {
  result: CommuteResult;
  showDetour: boolean;
  onToggle: () => void;
  onPick: (optionId: string) => void;
}) {
  const d = result.detour;
  return (
    <HudPanel index={4} title="PROPONOWANY OBJAZD" tone="quiet" className="p-4">
      {d ? (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-3xl leading-none text-accent">
              {minutesOf(d.route.durationSec)}
              <span className="ml-1 text-base">min</span>
            </span>
            <span
              className="font-display border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]"
              style={{
                color: d.savesSec > 0 ? "var(--success)" : "var(--warning)",
                borderColor: d.savesSec > 0 ? "var(--success)" : "var(--warning)",
              }}
            >
              {d.savesSec > 0
                ? `−${Math.round(d.savesSec / 60)} min`
                : `+${Math.abs(Math.round(d.savesSec / 60))} min, omija utrudnienie`}
            </span>
          </div>
          <p className="mt-2 min-w-0 break-words text-xs text-muted-foreground">
            {d.name ? `„${d.name}” · ` : ""}
            {d.via.length > 0 ? `przez ${d.via.join(" i ")} · ` : ""}
            {(d.route.distanceM - result.main.distanceM) / 1000 >= 0 ? "+" : "−"}
            {Math.abs((d.route.distanceM - result.main.distanceM) / 1000)
              .toFixed(1)
              .replace(".", ",")}{" "}
            km
          </p>
          <button
            type="button"
            aria-pressed={showDetour}
            onClick={onToggle}
            className="font-display mt-3 border border-accent/50 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-accent hover:bg-accent/10"
          >
            {showDetour ? "UKRYJ NA MAPIE" : "POKAŻ NA MAPIE"}
          </button>
          <button
            type="button"
            onClick={() => onPick(d.optionId)}
            className="font-display ml-2 mt-3 border border-accent/50 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-accent hover:bg-accent/10"
          >
            WYBIERZ TĘ TRASĘ
          </button>
        </>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Brak lepszej trasy — główna jest teraz najszybsza.
        </p>
      )}
    </HudPanel>
  );
}
