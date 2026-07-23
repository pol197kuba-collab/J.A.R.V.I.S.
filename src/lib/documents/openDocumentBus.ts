// Cross-route hand-off for "open this generated file's preview".
//
// The chat/voice pipeline resolves an open_document request to a file id on
// one route (usually the dashboard), but the preview lives on /documents.
// Two delivery channels cover both cases:
//   - sessionStorage: survives the navigation + fresh mount of /documents
//     (the common case — user was elsewhere).
//   - a CustomEvent: reaches an ALREADY-mounted /documents (user was already
//     there), where a remount wouldn't happen.
// documents.tsx consumes whichever fires and opens the matching card's modal
// once its list has loaded.

const KEY = "jarvis_open_document_id";
const EVENT = "jarvis:open-document";

/** Called from ChatPanel when the runtime returns an openDocument target. */
export function requestOpenDocument(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, id);
  } catch {
    /* private mode / quota — the event path still covers already-mounted */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

/** Read + clear a pending open request stashed before navigation. */
export function consumePendingOpenDocument(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const id = window.sessionStorage.getItem(KEY);
    if (id) window.sessionStorage.removeItem(KEY);
    return id;
  } catch {
    return null;
  }
}

/** Subscribe to open requests fired while /documents is already mounted. */
export function onOpenDocument(handler: (id: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const fn = (e: Event) => {
    const id = (e as CustomEvent<string>).detail;
    if (id) handler(id);
  };
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
