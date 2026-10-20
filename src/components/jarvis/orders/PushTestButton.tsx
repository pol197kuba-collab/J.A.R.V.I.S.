// Testowe powiadomienie — wysyłane przez job GitHub, czyli dokładnie tą
// drogą, którą przychodzi poranny briefing. Zielony wynik znaczy, że cała
// ścieżka działa: baza → job → usługa push → telefon.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { getPushTest, requestPushTest } from "@/lib/notifications/push.functions";

const SKIPPED: Record<string, string> = {
  no_subscriptions:
    "Żadne urządzenie nie ma włączonych powiadomień — włącz je przyciskiem obok, na telefonie.",
  no_vapid_keys: "Brak kluczy VAPID — włącz powiadomienia na którymś urządzeniu.",
  web_push_unavailable: "Job nie wczytał biblioteki web-push — zgłoś to.",
};

/** Po tylu minutach bez odpowiedzi joba mówimy wprost, co to znaczy. */
const PATIENCE_MS = 4 * 60_000;

export function PushTestButton() {
  const request = useServerFn(requestPushTest);
  const fetchTest = useServerFn(getPushTest);
  const [testId, setTestId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const start = useMutation({
    mutationFn: () => request(),
    onSuccess: ({ id }) => {
      setTestId(id);
      setStartedAt(Date.now());
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const test = useQuery({
    queryKey: ["push-test", testId],
    queryFn: () => fetchTest({ data: { id: testId! } }),
    enabled: testId !== null,
    refetchInterval: (q) => (q.state.data?.doneAt ? false : 5000),
  });

  useEffect(() => {
    if (!testId || test.data?.doneAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, [testId, test.data?.doneAt]);

  const t = test.data;
  let line: { text: string; tone: "ok" | "bad" | "wait" } | null = null;
  if (testId && !t?.doneAt) {
    line =
      now - startedAt > PATIENCE_MS
        ? {
            text: "Job jeszcze nie ruszył. Bez tokenu GitHub (Ustawienia → Klucze) test poczeka na najbliższy przebieg z crona — to może potrwać kilka godzin.",
            tone: "wait",
          }
        : { text: "Czekam, aż job GitHub wyśle powiadomienie (zwykle 1–2 min)…", tone: "wait" };
  } else if (t?.doneAt) {
    line =
      (t.sent ?? 0) > 0
        ? {
            text: `Wysłano na ${t.sent} urządz.${t.failed ? `, nieudane: ${t.failed}` : ""}${t.pruned ? `, usunięte wygasłe: ${t.pruned}` : ""}. Nie przyszło? Sprawdź tryb skupienia i ustawienia powiadomień dla aplikacji w systemie telefonu.`,
            tone: "ok",
          }
        : {
            text: t.skipped
              ? (SKIPPED[t.skipped] ?? `Pominięto (${t.skipped}).`)
              : `Żadne urządzenie nie przyjęło powiadomienia${t.pruned ? ` (usunięto wygasłe: ${t.pruned} — włącz powiadomienia ponownie na telefonie)` : ""}.`,
            tone: "bad",
          };
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => start.mutate()}
        disabled={start.isPending || (testId !== null && !t?.doneAt)}
        className="font-display flex items-center gap-2 rounded border border-primary/40 px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/10 disabled:opacity-40"
      >
        <Send className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        wyślij testowe powiadomienie
      </button>
      {line && (
        <p
          className="mt-2 min-w-0 break-words font-mono text-[11px] leading-relaxed"
          style={{
            color:
              line.tone === "ok"
                ? "var(--success)"
                : line.tone === "bad"
                  ? "var(--destructive)"
                  : "var(--muted-foreground)",
          }}
        >
          {line.text}
        </p>
      )}
    </div>
  );
}
