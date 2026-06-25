import { useEffect, type RefObject } from "react";
import { audio } from "./AudioEngine";

/**
 * Reads microphone amplitude via Web Audio AnalyserNode and writes RMS
 * (0..1) into the given ref every animation frame — no React state, no
 * re-renders. Caller can read it inside its own rAF loop and set CSS vars.
 */
export function useMicAnalyser(active: boolean, levelRef: RefObject<number>) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.mediaDevices) return;
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const ctx = audio.getContext();
        if (!ctx) return;
        source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!analyser) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          // Boost & clamp for nicer visual response
          levelRef.current = Math.min(1, rms * 3);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        // User denied or no device — keep simulated baseline
        levelRef.current = 0;
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      try {
        source?.disconnect();
        analyser?.disconnect();
      } catch {}
      stream?.getTracks().forEach((t) => t.stop());
      levelRef.current = 0;
    };
  }, [active, levelRef]);
}