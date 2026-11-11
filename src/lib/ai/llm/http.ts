// Jedno żądanie JSON do dostawcy modelu: jeden timeout na całość (nagłówki
// i treść), ponowienie na 429/5xx. Wspólne dla Gemini, Anthropic i Groq.

export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export type JsonRequest = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** Limit na JEDNĄ próbę, obejmuje też odczyt treści odpowiedzi. */
  timeoutMs: number;
  /** Ile razy ponowić po 429/5xx (domyślnie 1). */
  retries?: number;
  /** Odstęp przed n-tą powtórką: backoffMs × n. */
  backoffMs?: number;
  /** Wołane przed każdą powtórką — np. ostrzeżenie w logu systemowym. */
  onRetry?: (status: number, attempt: number, retries: number) => void | Promise<void>;
};

export type JsonResponse<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number | null; bodyText: string; timedOut: boolean; error?: string };

export async function requestJson<T>(req: JsonRequest): Promise<JsonResponse<T>> {
  const retries = req.retries ?? 1;
  const backoffMs = req.backoffMs ?? 700;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
    try {
      const res = await fetch(req.url, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", ...req.headers },
        body: typeof req.body === "string" ? req.body : JSON.stringify(req.body),
      });
      if (res.ok) {
        return { ok: true, status: res.status, data: (await res.json()) as T };
      }
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        await req.onRetry?.(res.status, attempt + 1, retries);
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
        continue;
      }
      const bodyText = await res.text().catch(() => "");
      return { ok: false, status: res.status, bodyText, timedOut: false };
    } catch (err) {
      return {
        ok: false,
        status: null,
        bodyText: "",
        timedOut: ctrl.signal.aborted,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
