// Cross-browser fullscreen helpers. All calls are best-effort — failures
// (iOS Safari has no element fullscreen) are swallowed silently.

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitEnterFullscreen?: () => void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type FsDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  msFullscreenElement?: Element | null;
};

export function isFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const d = document as FsDocument;
  return Boolean(document.fullscreenElement || d.webkitFullscreenElement || d.msFullscreenElement);
}

export async function requestAppFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;
  const el = document.documentElement as FsElement;
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: "hide" } as FullscreenOptions);
    } else if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
    } else if (el.msRequestFullscreen) {
      await el.msRequestFullscreen();
    }
  } catch {
    // ignore — user gesture missing, permission denied, or unsupported
  }
}

export async function exitAppFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;
  const d = document as FsDocument;
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
    else if (d.msExitFullscreen) await d.msExitFullscreen();
  } catch {
    // ignore
  }
}

export async function toggleAppFullscreen(): Promise<void> {
  if (isFullscreen()) await exitAppFullscreen();
  else await requestAppFullscreen();
}

export function onFullscreenChange(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const events = ["fullscreenchange", "webkitfullscreenchange", "msfullscreenchange"];
  events.forEach((e) => document.addEventListener(e, cb));
  return () => events.forEach((e) => document.removeEventListener(e, cb));
}
