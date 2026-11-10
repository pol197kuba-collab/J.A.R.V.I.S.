// DOJAZD — jeden zestaw zapytań dla strony, kafelka i docka. Wspólne klucze,
// więc trzy miejsca na ekranie to jedno pobranie, nie trzy.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCommuteFn, getCommuteSettingsFn } from "./commute.functions";
import type { CommuteDirection } from "./types";

export const COMMUTE_SETTINGS_KEY = ["commute", "settings"] as const;
export const commuteKey = (direction: CommuteDirection) => ["commute", "route", direction] as const;

/**
 * Ruch zmienia się w minutach, ale tylko gdy liczymy „teraz". Prognoza na
 * zaplanowaną godzinę (np. jutro 06:00) nie zmienia się od odświeżania, więc
 * nie zużywamy na nią limitu zapytań dostawcy.
 */
const LIVE_REFRESH_MS = 5 * 60_000;
const PLANNED_REFRESH_MS = 30 * 60_000;

export function useCommuteSettings() {
  const fn = useServerFn(getCommuteSettingsFn);
  return useQuery({
    queryKey: COMMUTE_SETTINGS_KEY,
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}

export function useCommute(direction: CommuteDirection, enabled = true) {
  const fn = useServerFn(getCommuteFn);
  return useQuery({
    queryKey: commuteKey(direction),
    queryFn: () => fn({ data: { direction } }),
    enabled,
    staleTime: LIVE_REFRESH_MS,
    refetchInterval: (q) =>
      q.state.data?.status === "ok" && q.state.data.result.live
        ? LIVE_REFRESH_MS
        : PLANNED_REFRESH_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
