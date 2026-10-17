// Mózg 3D — wspólne hooki i stałe obu trybów (WIEDZA, STRUKTURA).

import { useEffect, useRef, useState } from "react";

export type Mode = "3d" | "list";
export type BrainKind = "knowledge" | "structure";

const MODE_KEY = "jarvis_brain_mode";
const KIND_KEY = "jarvis_brain_kind";

/** Poniżej tej szerokości karta wysuwa się od dołu; powyżej pływa w rogu. */
export const SHEET_SIDE_MIN = 900;
/** O ile przesunąć obraz w górę, gdy karta zasłania dół ekranu. */
export const SHEET_VIEW_SHIFT = 0.22;

/** Rozmiar elementu na żywo (ResizeObserver); 0 przed pierwszym pomiarem. */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function hasWebGL(): boolean {
  if (typeof document === "undefined") return true;
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Wartość zapamiętana w localStorage (tylko wygoda — tryb prywatny działa bez niej). */
function useStoredChoice<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const v = window.localStorage.getItem(key) as T | null;
      return v && allowed.includes(v) ? v : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, v);
    } catch {
      /* tryb prywatny — wybór działa do końca wizyty */
    }
  };
  return [value, set] as const;
}

/** Widok 3D / LISTA — wspólny dla obu trybów, bez WebGL zawsze LISTA. */
export function useBrainMode() {
  const [webgl] = useState(hasWebGL);
  const [mode, setMode] = useStoredChoice<Mode>(MODE_KEY, ["3d", "list"], "3d");
  return { webgl, mode, setMode, effectiveMode: (webgl ? mode : "list") as Mode };
}

export function useBrainKind() {
  return useStoredChoice<BrainKind>(KIND_KEY, ["knowledge", "structure"], "knowledge");
}
