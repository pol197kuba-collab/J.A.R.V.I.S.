// Outbound fetches to URLs an agent picked (search results, page links, a
// model-chosen og:image) — the SSRF guard shared by tools.server.ts
// (fetch_url) and producer.server.ts (images for generated documents).

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

// SSRF guard: the agent decides what URL to fetch (often steered by search
// results or page content it just read), so a prompt injection could try to
// point it at cloud metadata endpoints or other internal services. Block
// loopback/private/link-local targets, resolving hostnames first so a
// public domain that merely points at an internal IP is caught too.
export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // includes 169.254.169.254 metadata
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (/^fe[89ab]/.test(lower)) return true; // link-local
    if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice("::ffff:".length));
    return false;
  }
  return true; // not a literal IP — caller should have resolved it first
}

export async function isBlockedTarget(hostname: string): Promise<boolean> {
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower === "metadata.google.internal"
  ) {
    return true;
  }
  if (isIP(hostname)) return isPrivateIp(hostname);
  try {
    const results = await lookup(hostname, { all: true });
    return results.length === 0 || results.some((r) => isPrivateIp(r.address));
  } catch {
    return true; // DNS failure — fail closed rather than let it through unresolved
  }
}

// Follows redirects manually (instead of letting fetch() auto-follow) so
// every hop's target is re-validated — otherwise a public URL could 302 to
// an internal address and slip past the initial check.
export async function safeFetch(
  startUrl: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
  maxRedirects = 3,
): Promise<Response> {
  let current = startUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    const parsed = new URL(current);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("invalid_url");
    if (await isBlockedTarget(parsed.hostname)) throw new Error("blocked_target");
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too_many_redirects");
}
