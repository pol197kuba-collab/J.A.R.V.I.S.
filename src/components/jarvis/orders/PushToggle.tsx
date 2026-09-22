// Włącznik powiadomień na urządzenie.
//
// Rzecz, o którą chodzi najbardziej: przycisk mówi o TYM urządzeniu, a nie o
// koncie. Zgoda na powiadomienia jest wydawana per przeglądarka, więc
// „włączone" na laptopie nie znaczy nic na telefonie — i odwrotnie. Panel,
// który pokazywałby jeden wspólny stan, kłamałby na jednym z tych urządzeń.
// Stąd dwie informacje obok siebie: stan tego urządzenia i liczba wszystkich
// zapisanych.
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BellOff, BellRing, Smartphone } from "lucide-react";
import {
  checkPushSupport,
  currentEndpoint,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from "@/lib/notifications/pushDevice";
import {
  countPushSubscriptions,
  deletePushSubscription,
  getPushConfig,
  savePushSubscription,
} from "@/lib/notifications/push.functions";

const SUPPORT_HINT: Record<string, string> = {
  no_service_worker:
    "Ta przeglądarka nie udostępnia service workerów — bez nich powiadomienia przy zamkniętej karcie nie są możliwe.",
  no_push: "Ta przeglądarka nie obsługuje Web Push.",
  no_notifications: "Ta przeglądarka nie obsługuje powiadomień systemowych.",
};

export function PushToggle() {
  const qc = useQueryClient();
  const fetchConfig = useServerFn(getPushConfig);
  const saveSub = useServerFn(savePushSubscription);
  const deleteSub = useServerFn(deletePushSubscription);
  const fetchCount = useServerFn(countPushSubscriptions);

  const support = checkPushSupport();
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void currentEndpoint().then((value) => {
      setEndpoint(value);
      setChecked(true);
    });
  }, []);

  const countQuery = useQuery({
    queryKey: ["push", "count"],
    queryFn: () => fetchCount(),
    enabled: support.supported,
  });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["push", "count"] });
  }, [qc]);

  const enable = useMutation({
    mutationFn: async () => {
      const { publicKey } = await fetchConfig({ data: { origin: window.location.origin } });
      if (!publicKey) throw new Error("Serwer nie wydał klucza VAPID.");

      const outcome = await subscribeThisDevice(publicKey);
      if (!outcome.ok) {
        // Każdy powód ma własne zdanie: „nie udało się" nie mówi, czy trzeba
        // odblokować powiadomienia w systemie, czy dodać stronę do ekranu.
        const message =
          outcome.reason === "denied"
            ? "Przeglądarka odmówiła zgody. Trzeba ją przywrócić w ustawieniach witryny — o zgodę raz odrzuconą nie da się zapytać ponownie."
            : outcome.reason === "unsupported"
              ? "To urządzenie nie obsługuje Web Push. Na iPhonie działa wyłącznie po dodaniu aplikacji do ekranu początkowego."
              : (outcome.message ?? "Nie udało się zasubskrybować urządzenia.");
        throw new Error(message);
      }

      await saveSub({
        data: {
          endpoint: outcome.endpoint,
          p256dh: outcome.p256dh,
          auth: outcome.auth,
          userAgent: navigator.userAgent.slice(0, 400),
        },
      });
      return outcome.endpoint;
    },
    onSuccess: (value) => {
      setEndpoint(value);
      refresh();
      toast("Powiadomienia włączone na tym urządzeniu");
    },
    onError: (err: unknown) =>
      toast("Nie włączono powiadomień", {
        description: err instanceof Error ? err.message : String(err),
      }),
  });

  const disable = useMutation({
    mutationFn: async () => {
      const removed = (await unsubscribeThisDevice()) ?? endpoint;
      if (removed) await deleteSub({ data: { endpoint: removed } });
    },
    onSuccess: () => {
      setEndpoint(null);
      refresh();
      toast("Powiadomienia wyłączone na tym urządzeniu");
    },
  });

  if (!support.supported) {
    return (
      <p className="min-w-0 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
        {SUPPORT_HINT[support.reason]}
      </p>
    );
  }

  const active = endpoint !== null;
  const busy = enable.isPending || disable.isPending || !checked;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => (active ? disable.mutate() : enable.mutate())}
        className="font-display flex shrink-0 items-center gap-2 rounded border border-primary/40 px-3 py-1.5 text-[9px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/10 disabled:opacity-40"
      >
        {active ? (
          <BellOff className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        ) : (
          <BellRing className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        )}
        {busy ? "chwila…" : active ? "wyłącz na tym urządzeniu" : "włącz na tym urządzeniu"}
      </button>

      <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <Smartphone className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <span className="min-w-0 break-words">
          {countQuery.data ? `zapisanych urządzeń: ${countQuery.data.count}` : "—"}
        </span>
      </span>
    </div>
  );
}
