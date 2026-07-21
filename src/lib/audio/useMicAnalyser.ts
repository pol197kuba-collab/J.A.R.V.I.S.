import { useEffect, type RefObject } from "react";
import { acquireMic, releaseMic } from "./micShared";

/**
 * Reads microphone amplitude via Web Audio AnalyserNode and writes RMS
 * (0..1) into the given ref every animation frame — no React state, no
 * re-renders. Caller can read it inside its own rAF loop and set CSS vars.
 */
export function useMicAnalyser(active: boolean, levelRef: RefObject<number>) {
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let raf = 0;
    let analyser: AnalyserNode | null = null;
    let acquired = false;

    (async () => {
      const a = await acquireMic();
      if (cancelled || !a) {
        if (a) releaseMic();
        return;
      }
      acquired = true;
      analyser = a;
      const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      const tick = () => {
        if (!analyser) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        levelRef.current = Math.min(1, rms * 3);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (acquired) releaseMic();
      levelRef.current = 0;
    };
  }, [active, levelRef]);
}
