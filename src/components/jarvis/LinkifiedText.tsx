// Chat bubbles render plain text (no markdown engine, by design — agent
// replies are spoken aloud too, and a full renderer is more than the HUD
// needs). That broke down the moment Producer started handing back signed
// download URLs: a raw multi-hundred-character link rendered as dead,
// unclickable text. This renders exactly two inline patterns as anchors —
// markdown links `[label](url)` and bare http(s) URLs — and leaves every
// other character untouched.

import type { ReactNode } from "react";

const TOKEN_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')]+)/g;

// A bare signed-storage URL is unreadable — label it with the filename it
// points at when one is recognizable, otherwise show a shortened URL.
function labelForBareUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const lastSegment = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "");
    if (/\.[a-z0-9]{2,5}$/i.test(lastSegment)) return `⬇ ${lastSegment}`;
    const compact = `${parsed.hostname}${parsed.pathname}`;
    return compact.length > 60 ? `${compact.slice(0, 59)}…` : compact;
  } catch {
    return url.length > 60 ? `${url.slice(0, 59)}…` : url;
  }
}

export function LinkifiedText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [, mdLabel, mdUrl, bareUrl] = match;
    const href = mdUrl ?? bareUrl!;
    // Trailing punctuation glued to a bare URL (end of sentence) belongs to
    // the prose, not the link.
    const trimmed = bareUrl ? href.replace(/[.,;:!?]+$/, "") : href;
    const trailing = bareUrl ? href.slice(trimmed.length) : "";
    nodes.push(
      <a
        key={`${match.index}-${trimmed}`}
        href={trimmed}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-primary underline decoration-primary/50 underline-offset-2 transition hover:decoration-primary"
      >
        {mdLabel ?? labelForBareUrl(trimmed)}
      </a>,
    );
    if (trailing) nodes.push(trailing);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes}</>;
}
