import { audio } from "./AudioEngine";

type Shared = {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  refs: number;
};

let shared: Shared | null = null;
let pending: Promise<Shared | null> | null = null;

export async function acquireMic(): Promise<AnalyserNode | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return null;
  if (shared) {
    shared.refs += 1;
    return shared.analyser;
  }
  if (!pending) {
    pending = (async () => {
      try {
        const ctx = audio.getContext();
        if (!ctx) return null;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        source.connect(analyser);
        shared = { stream, source, analyser, refs: 0 };
        return shared;
      } catch {
        return null;
      } finally {
        pending = null;
      }
    })();
  }
  const s = await pending;
  if (!s) return null;
  s.refs += 1;
  return s.analyser;
}

export function releaseMic() {
  if (!shared) return;
  shared.refs -= 1;
  if (shared.refs <= 0) {
    try {
      shared.source.disconnect();
      shared.analyser.disconnect();
    } catch {}
    shared.stream.getTracks().forEach((t) => t.stop());
    shared = null;
  }
}