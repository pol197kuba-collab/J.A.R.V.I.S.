import { useCallback, useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { audio } from "@/lib/audio/AudioEngine";
import { listAgents } from "@/lib/agents/runtime.functions";
import { useHudNavigate } from "./TransitionContext";
import { DockCore } from "./DockCore";
import { CockpitMenu } from "./CockpitMenu";
import { useLongPress } from "./useLongPress";
import { agentDots, reactorState } from "./dockWidgets";
import { JARVIS_HOLD_MS } from "./module-transition/miniCoreMath";

/** Fired on window to open the desktop menu (the header's MENU // SYS button). */
export const OPEN_COCKPIT_EVENT = "jarvis:cockpit";

/**
 * Desktop navigation in the 3D mode, instead of the sidebar: the Arc Core
 * itself at the left end of the header (the same mini core as the phone dock —
 * tap opens the "Kokpit" menu, a 1 s hold flies to /jarvis; in the header it
 * never covers a module's own controls) and the Kokpit, which Ctrl/⌘K and the
 * voice "open menu" command open too.
 */
export function DesktopNav() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [open, setOpen] = useState(false);
  const { go } = useHudNavigate();
  const fetchAgents = useServerFn(listAgents);
  const { data: agents } = useQuery({
    queryKey: ["agents", "list"],
    queryFn: () => fetchAgents(),
    refetchInterval: 15_000,
  });
  const state = reactorState(agentDots(agents));

  const toggle = useCallback(() => {
    audio.playClick();
    setOpen((v) => !v);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const { holding, handlers } = useLongPress(JARVIS_HOLD_MS, toggle, () => {
    audio.playEngage();
    setOpen(false);
    if (pathname !== "/jarvis") go("/jarvis");
  });

  // Ctrl/⌘K, the header's MENU // SYS, the voice "open / close menu"
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    const onVoice = (e: Event) => setOpen((e as CustomEvent<"open" | "close">).detail === "open");
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COCKPIT_EVENT, onOpen);
    window.addEventListener("jarvis:sidebar", onVoice);
    document.documentElement.setAttribute("data-cockpit-nav", "");
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COCKPIT_EVENT, onOpen);
      window.removeEventListener("jarvis:sidebar", onVoice);
      document.documentElement.removeAttribute("data-cockpit-nav");
    };
  }, []);

  // a route change (voice, another control) closes the menu
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        {...handlers}
        aria-label="Menu modułów (przytrzymaj 1 s: J.A.R.V.I.S.)"
        aria-expanded={open}
        className="relative -my-2 flex h-11 w-11 shrink-0 touch-manipulation select-none items-center justify-center rounded-full [-webkit-tap-highlight-color:transparent]"
      >
        <DockCore state={state} charging={holding} size={42} />
      </button>
      <CockpitMenu open={open} onClose={close} />
    </>
  );
}
