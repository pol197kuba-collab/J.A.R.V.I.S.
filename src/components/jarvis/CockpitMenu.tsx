import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouterState } from "@tanstack/react-router";

import { cn } from "@/lib/utils";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { useHudNavigate, useRouteTransition } from "./TransitionContext";
import { useArkReboot } from "./ArkRebootContext";
import {
  cockpitBlurb,
  cockpitColumns,
  cockpitMatches,
  firstMatch,
  moveSel,
  type CockpitSel,
} from "./cockpitMenu";

const COLUMNS = cockpitColumns();

/**
 * The desktop menu, "Kokpit": four holographic columns (the module groups)
 * standing in an arc around the Arc Core, which the 3D world settles on while
 * the menu is open. Every module is visible with its one-line description and
 * one click away; typing filters, arrows walk the columns, Enter opens. The
 * whole cockpit leans a little toward the pointer (CSS 3D, styles.css:
 * "Kokpit"). Picking a module starts the usual module transition.
 */
export function CockpitMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { go, isTransitioning } = useHudNavigate();
  const { menuFocus } = useRouteTransition();
  const { isDiagnosticRunning } = useArkReboot();
  const locked = isTransitioning || isDiagnosticRunning;

  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<CockpitSel | null>(null);
  const [ready, setReady] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);
  const beamRef = useRef<SVGLineElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // open / close: the page steps back, the 3D world settles on the core
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSel(null);
    const root = document.documentElement;
    root.setAttribute("data-cockpit", "");
    menuFocus(true);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 300);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      setReady(false);
      root.removeAttribute("data-cockpit");
      menuFocus(false);
    };
  }, [open, menuFocus]);

  const pick = useCallback(
    (c: number, r: number) => {
      const item = COLUMNS[c]?.items[r];
      if (!item || locked) return;
      audio.playClick();
      onClose();
      if (item.url === pathname) return;
      if (item.url === "/situation-room") speak("Uruchamiam telemetrię satelitarną.");
      go(item.url);
    },
    [go, locked, onClose, pathname],
  );

  // the beam: from the core to the module in focus
  const drawBeam = useCallback(() => {
    const line = beamRef.current;
    const deck = deckRef.current;
    if (!line || !deck) return;
    const el = sel
      ? deck.querySelector<HTMLElement>(`[data-c="${sel[0]}"][data-r="${sel[1]}"]`)
      : null;
    if (!el) {
      line.classList.remove("on");
      return;
    }
    const r = el.getBoundingClientRect();
    const left = r.left + r.width / 2 < window.innerWidth / 2;
    line.setAttribute("x1", String(window.innerWidth / 2));
    line.setAttribute("y1", String(window.innerHeight * 0.46));
    line.setAttribute("x2", String(left ? r.right : r.left));
    line.setAttribute("y2", String(r.top + r.height / 2));
    line.classList.add("on");
  }, [sel]);
  useEffect(() => {
    drawBeam();
  }, [drawBeam, ready]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      const keys: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const dir = keys[e.key];
      if (dir) {
        // left/right stay with the text cursor while there is a query
        if ((dir === "left" || dir === "right") && query) return;
        e.preventDefault();
        setSel((s) => moveSel(COLUMNS, s, dir, query));
      } else if (e.key === "Enter" && sel) {
        e.preventDefault();
        pick(sel[0], sel[1]);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", drawBeam);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", drawBeam);
    };
  }, [open, onClose, query, sel, pick, drawBeam]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Menu modułów"
      className={cn("cockpit-overlay", ready && "ready")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onPointerMove={(e) => {
        const d = deckRef.current;
        if (!d) return;
        d.style.setProperty("--ry", `${((e.clientX / window.innerWidth) * 2 - 1) * 4}deg`);
        d.style.setProperty("--rx", `${-((e.clientY / window.innerHeight) * 2 - 1) * 3}deg`);
        drawBeam();
      }}
    >
      <label className="cockpit-search">
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Szukaj modułu"
          autoComplete="off"
          aria-label="Szukaj modułu"
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(firstMatch(COLUMNS, e.target.value));
          }}
        />
        <kbd>↑ ↓ ← → · Enter · Esc</kbd>
      </label>
      <svg className="cockpit-beam" aria-hidden="true">
        <line ref={beamRef} />
      </svg>
      <div className="cockpit-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={deckRef} className="cockpit-deck">
          {COLUMNS.map((col, c) => (
            <div
              key={col.id}
              className={`cockpit-col c${c}`}
              style={{ transitionDelay: `${c * 70}ms` }}
            >
              <h3>
                {col.label}
                <small>{String(col.items.length).padStart(2, "0")}</small>
              </h3>
              {col.items.map((item, r) => (
                <button
                  key={item.url}
                  type="button"
                  data-c={c}
                  data-r={r}
                  disabled={locked}
                  aria-current={item.url === pathname ? "page" : undefined}
                  className={cn(
                    "cockpit-item",
                    sel?.[0] === c && sel?.[1] === r && "sel",
                    item.url === pathname && "cur",
                    !cockpitMatches(item, query) && "dim",
                  )}
                  // only a real pointer move selects: rows that slide under a resting
                  // cursor (the deck animating in, leaning) must not steal the
                  // selection the search just made
                  onPointerMove={() => (sel?.[0] !== c || sel?.[1] !== r) && setSel([c, r])}
                  onClick={() => pick(c, r)}
                >
                  <b>{item.title}</b>
                  <span>{cockpitBlurb(item.title)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="cockpit-foot">
        Klik w tło lub <b>Esc</b>: zamknij · przytrzymaj rdzeń w nagłówku 1 s: <b>J.A.R.V.I.S.</b> ·{" "}
        <b>Ctrl/⌘ K</b>: to menu
      </p>
    </div>,
    document.body,
  );
}
