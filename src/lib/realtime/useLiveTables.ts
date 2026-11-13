// Hook do odświeżania na żywo (etap 7). Komponent deklaruje tabele, z których
// czytają jego zapytania; dopóki jest zamontowany, zmiany w nich unieważniają
// klucze z LIVE_TABLES. Przy tym `refetchInterval: LIVE_FALLBACK_MS`.
import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { createLiveHub, type LiveHub, type LiveTable } from "./liveTables";

let hub: LiveHub | null = null;
let channelSeq = 0;
let hubClient: QueryClient | null = null;

function getHub(qc: QueryClient): LiveHub {
  // Jeden hub na klienta zapytań (w praktyce jeden na aplikację).
  if (hub && hubClient === qc) return hub;
  hubClient = qc;
  hub = createLiveHub(
    {
      open: (table, onChange) =>
        supabase
          // Nazwa z licznikiem: supabase-js zwraca istniejący kanał o tej
          // samej nazwie, a zamykany przed chwilą może jeszcze wisieć.
          .channel(`live:${table}:${++channelSeq}`)
          .on("postgres_changes", { event: "*", schema: "public", table }, onChange)
          .subscribe(),
      close: (handle) => {
        void supabase.removeChannel(handle as ReturnType<typeof supabase.channel>);
      },
    },
    (queryKey) => {
      void qc.invalidateQueries({ queryKey: [...queryKey] });
    },
  );
  return hub;
}

export function useLiveTables(...tables: LiveTable[]): void {
  const qc = useQueryClient();
  const signature = [...new Set(tables)].sort().join(",");
  useEffect(() => {
    if (typeof window === "undefined" || !signature) return;
    return getHub(qc).acquire(signature.split(",") as LiveTable[]);
  }, [qc, signature]);
}
