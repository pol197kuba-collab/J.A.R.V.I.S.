// Skąd wiadomo, czy briefing przyjdzie o czasie: czy baza może sama
// uruchomić job (token GitHub), kiedy powstał ostatni i co GitHub
// odpowiedział na ostatnie wywołania.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBriefDelivery } from "@/lib/notifications/push.functions";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

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
            J.A.R.V.I.S.). Bez niego briefing czeka na cron GitHuba, który bywa spóźniony o kilka
            godzin.
          </span>
        )}
      </p>
      <p>
        Ostatni briefing:{" "}
        {d.lastBrief
          ? `${d.lastBrief.date}, złożony ${fmt(d.lastBrief.createdAt)}`
          : "jeszcze żaden"}
      </p>
      {last && (
        <p className="min-w-0 break-words">
          Ostatnie wywołanie joba: {fmt(last.at)} (
          {last.reason === "push_test" ? "test" : "briefing"}) —{" "}
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
