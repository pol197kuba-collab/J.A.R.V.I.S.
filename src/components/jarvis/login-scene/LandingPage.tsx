import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import { ArcReactorTriangle } from "@/components/jarvis/ArcReactorTriangle";
import { audio } from "@/lib/audio/AudioEngine";
import { requestAppFullscreen } from "@/lib/fullscreen";
import { landingStartsAtEngage, markLandingSeen } from "@/lib/theme/loginScene";
import type { LandingHud } from "./createLoginScene";
import { JARVIS_CORE, LANDING_AGENTS, LANDING_AGENT_TOTAL, landingModules } from "./landingData";
import { createScrollJump } from "./scrollJump";
import type { IntroBridge } from "./LoginScene";

/**
 * 3D landing page: the DOM half (copy, buttons, readouts) of the intro. The
 * 3D half is the stable <LoginScene> behind it, which reads this scroll
 * container's sections as camera stops. Texts stay in the DOM (accessible);
 * the canvas is aria-hidden. Scrolls its OWN container, never the window.
 */
export function LandingPage({
  bridge,
  leaving,
  onEngage,
}: {
  bridge: MutableRefObject<IntroBridge>;
  /** The login screen has taken over: fade the page out. */
  leaving: boolean;
  /** Same effect as BootSequence's Engage button: login_screen. */
  onEngage: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const hudModRef = useRef<HTMLDivElement>(null);
  const modNowRef = useRef<HTMLSpanElement>(null);
  const modCountRef = useRef<HTMLSpanElement>(null);
  const engageRef = useRef<HTMLDivElement>(null);
  const homeRef = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<ReturnType<typeof createScrollJump> | null>(null);
  const modules = landingModules();

  // Register the scroll host and the HUD sink for the scene (no React renders per frame).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const jump = createScrollJump(el);
    jumpRef.current = jump;
    bridge.current.host = {
      scrollEl: () => el,
      sections: () =>
        Array.from(el.querySelectorAll<HTMLElement>("[data-stop]")).map((s) => ({
          id: s.dataset.stop as string,
          el: s,
        })),
      engageHome: () => {
        const r = homeRef.current?.getBoundingClientRect();
        return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
      },
      isJumping: () => jump.active(),
    };
    bridge.current.onHud = (h: LandingHud) => {
      if (scanRef.current) {
        scanRef.current.textContent = `SYSTEM SCAN ${String(h.scan).padStart(3, "0")}%`;
      }
      if (hudModRef.current) hudModRef.current.style.opacity = String(h.hudMod);
      if (modNowRef.current) {
        modNowRef.current.textContent =
          h.moduleIndex >= 0 ? (modules[h.moduleIndex]?.title ?? "") : "Wejście do rdzenia";
      }
      if (modCountRef.current) {
        modCountRef.current.textContent = `${String(Math.max(0, h.moduleIndex + 1)).padStart(2, "0")} / ${String(h.moduleCount).padStart(2, "0")}`;
      }
      if (engageRef.current) {
        engageRef.current.style.opacity = String(h.engaged);
        engageRef.current.classList.toggle("live", h.engaged > 0.95);
      }
    };
    // returning users open straight on Engage (one constant turns this off)
    if (landingStartsAtEngage()) el.scrollTop = el.scrollHeight;
    el.focus({ preventScroll: true }); // keyboard scrolling works from the first key
    return () => {
      jump.dispose();
      jumpRef.current = null;
      bridge.current.host = null;
      bridge.current.onHud = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // top of a section inside the scroll container (+2 px: land inside its range)
  const stopTop = (id: string) => {
    const el = scrollRef.current;
    const sec = el?.querySelector<HTMLElement>(`[data-stop="${id}"]`);
    if (!el || !sec) return 0;
    return sec.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop + 2;
  };
  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    jumpRef.current?.to(stopTop(id));
  };

  useEffect(() => {
    if (leaving) jumpRef.current?.stop();
  }, [leaving]);

  return (
    <div
      ref={scrollRef}
      data-landing-scroll=""
      tabIndex={-1}
      className={`lp-root no-scrollbar${leaving ? " lp-leaving" : ""}`}
    >
      <i className="lp-tick tl" />
      <i className="lp-tick tr" />
      <i className="lp-tick bl" />
      <i className="lp-tick br" />
      <header className="lp-bar">
        <div className="lp-brand">
          <svg
            width="22"
            height="22"
            viewBox="0 0 100 100"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <circle cx="50" cy="50" r="46" opacity=".4" />
            <g strokeWidth="2">
              <polygon points="50,18 70,55 30,55" />
              <polygon points="50,18 70,55 30,55" transform="rotate(120 50 50)" />
              <polygon points="50,18 70,55 30,55" transform="rotate(240 50 50)" />
            </g>
          </svg>
          <span>J.A.R.V.I.S.</span>
        </div>
        <button type="button" className="lp-link" onClick={go("engage")}>
          Zaloguj
        </button>
      </header>
      <div ref={scanRef} className="lp-scan" aria-hidden="true">
        SYSTEM SCAN 000%
      </div>

      <main className="lp-main">
        <section data-stop="hero" className="lp-stop lp-hero-stop">
          <div className="lp-pin">
            <div className="lp-hero">
              <p className="kick">Just A Rather Very Intelligent System</p>
              <h1>J.A.R.V.I.S.</h1>
              <p className="lead">
                Osobisty system operacyjny z zespołem agentów AI. Mówisz, czego potrzebujesz, a
                rdzeń rozdziela pracę.
              </p>
              <div className="lp-cta">
                <button type="button" className="lp-btn" onClick={go("jarvis")}>
                  ▸ Rozpocznij skan
                </button>
                <button type="button" className="lp-btn quiet" onClick={go("engage")}>
                  Przejdź do logowania
                </button>
              </div>
            </div>
          </div>
        </section>

        <section data-stop="jarvis" className="lp-stop lp-left">
          <div className="lp-pin">
            <article className="hud-panel lp-card">
              <div className="tag">
                <span>Agent 1 z {LANDING_AGENT_TOTAL}</span>
                <i>{JARVIS_CORE.role}</i>
              </div>
              <h2>{JARVIS_CORE.name}</h2>
              <p>{JARVIS_CORE.text}</p>
            </article>
          </div>
        </section>

        {LANDING_AGENTS.map((a, i) => (
          <section
            key={a.slug}
            data-stop={`a${i}`}
            className={`lp-stop ${i % 2 ? "lp-left" : "lp-right"}`}
          >
            <div className="lp-pin">
              <article className="hud-panel lp-card">
                <div className="tag">
                  <span>
                    Agent {i + 2} z {LANDING_AGENT_TOTAL}
                  </span>
                  <i>{a.role}</i>
                </div>
                <h2>{a.name}</h2>
                <p>{a.text}</p>
              </article>
            </div>
          </section>
        ))}

        <section data-stop="modules" className="lp-stop lp-modules">
          <h2 className="lp-sr">Moduły</h2>
          <ul className="lp-sr">
            {modules.map((m) => (
              <li key={m.title}>
                {m.title}: {m.sub}
              </li>
            ))}
          </ul>
        </section>

        <section data-stop="engage" className="lp-stop lp-engage-stop" />
      </main>

      <div ref={hudModRef} className="lp-hudmod" aria-hidden="true">
        <small>
          <span ref={modCountRef}>00 / {String(modules.length).padStart(2, "0")}</span>
        </small>
        <span ref={modNowRef} className="now">
          Wejście do rdzenia
        </span>
      </div>

      <div ref={engageRef} className="lp-engage">
        <div className="lp-ghost" aria-hidden="true">
          JARVIS
        </div>
        <p className="lp-mini">Arc Reactor // Online</p>
        {/* The real ArcReactorTriangle: the 3D reactor sits exactly under it (fitCamera on this rect). */}
        <div ref={homeRef}>
          <ArcReactorTriangle />
        </div>
        <p className="lp-warn">⚠ Authorization required</p>
        <button
          type="button"
          className="lp-btn lp-engage-btn"
          style={{ pointerEvents: "inherit" }}
          onClick={() => {
            // exactly what BootSequence's Engage button does today
            audio.playEngage();
            void requestAppFullscreen();
            markLandingSeen();
            onEngage();
          }}
        >
          ▸ Engage JARVIS
        </button>
      </div>
    </div>
  );
}
