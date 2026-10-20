// Skąd wiadomo, czy briefing (i Market Grid o 20:00) przyjdzie o czasie:
// czy baza może sama uruchomić job (token GitHub), kiedy był ostatni
// przebieg i co GitHub odpowiedział na ostatnie wywołania.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBriefDelivery } from "@/lib/notifications/push.functions";
import { MARKET_HOUR } from "@/lib/markets/schedule";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const REASON_LABEL: Record<string, string> = {
  brief_hour: "briefing",
  push_test: "test",
  market_hour: "Market Grid",
};

const TRIGGER_LABEL: Record<string, string> = {
  workflow_dispatch: "z bazy lub ręcznie",
  schedule: "cron GitHuba",
};

const STATUS_HINT: Record<number, string> = {
  204: "OK — job uruchomiony",
  401: "token GitHub nieważny",
  403: "token bez uprawnienia Actions: write",
  404: "token nie widzi repozytorium (albo brak uprawnienia Actions)",
  422: "GitHub odrzucił wywołanie",
};

export function BriefDelivery() {
  const fetchDelivery = useServerFn(getBriefDelivery);
  const q = useQuery({ queryKey: ["brief-delivery"], queryFn: () => fetchDelivery() });
  const d = q.data;
  if (!d) return null;
  const last = d.dispatches[0];

  return (
    <div className="mt-4 min-w-0 space-y-1 border-t border-primary/15 pt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
      <p className="min-w-0 break-words">
        Uruchamianie o czasie:{" "}
        {d.hasGithubToken ? (
          <span className="text-[color:var(--success)]">aktywne</span>
        ) : (
          <span className="text-[color:var(--warning)]">
            wyłączone — dodaj token GitHub w zakładce Klucze (uprawnienie Actions: write do repo
            J.A.R.V.I.S.). Bez niego briefing i Market Grid czekają na cron GitHuba, który bywa
            spóźniony o kilka godzin.
          </span>
        )}
      </p>
      <p>
        Ostatni briefing:{" "}
        {d.lastBrief
          ? `${d.lastBrief.date}, złożony ${fmt(d.lastBrief.createdAt)}`
          : "jeszcze żaden"}
      </p>
      <p className="min-w-0 break-words">
        Market Grid (codziennie o {MARKET_HOUR}:00):{" "}
        {d.lastMarketRun
          ? `ostatni zaciąg ${fmt(d.lastMarketRun.finishedAt)}` +
            (d.lastMarketRun.trigger
              ? `, ${TRIGGER_LABEL[d.lastMarketRun.trigger] ?? d.lastMarketRun.trigger}`
              : "") +
            (d.lastMarketRun.failures > 0
              ? ` — ${d.lastMarketRun.failures} kroków z błędem (System Logs)`
              : "")
          : "jeszcze bez śladu przebiegu"}
      </p>
      {last && (
        <p className="min-w-0 break-words">
          Ostatnie wywołanie joba: {fmt(last.at)} ({REASON_LABEL[last.reason] ?? last.reason}) —{" "}
          {last.status === null ? (
            "czekam na odpowiedź GitHuba"
          ) : (
            <span
              style={{
                color: last.status === 204 ? "var(--success)" : "var(--destructive)",
              }}
            >
              {last.status} {STATUS_HINT[last.status] ?? last.error ?? ""}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
