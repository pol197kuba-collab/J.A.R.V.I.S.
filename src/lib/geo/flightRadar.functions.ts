// Flight data goes through a server function rather than a browser fetch:
// originally forced by OpenSky's CORS policy (it only allowed its own
// origin), and kept after the switch to adsb.lol on purpose — server-side
// fetching is immune to any provider's CORS choices, keeps the provider
// swappable without re-testing browser behavior, and is what lets failures
// land in system_events where System Logs can show them.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { fetchFlightsInBounds, type FlightQueryResult } from "./flightRadar";

const Input = z.object({
  lamin: z.number(),
  lomin: z.number(),
  lamax: z.number(),
  lomax: z.number(),
});

export const fetchFlightsInBoundsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<FlightQueryResult> => {
    const { supabase, userId } = context;
    try {
      return await fetchFlightsInBounds(data);
    } catch (err) {
      // Logged to system_events (not just thrown) so a failure here is
      // diagnosable from System Logs without needing browser devtools —
      // the client swallows this into a plain empty array either way, per
      // react-query's error handling, so this is the only visible trace.
      const msg = err instanceof Error ? err.message : String(err);
      await supabase.from("system_events").insert({
        owner_id: userId,
        level: "error",
        source: "flight-radar",
        message: `Flight data fetch failed: ${msg}`,
        meta: data as Json,
      });
      throw err;
    }
  });
