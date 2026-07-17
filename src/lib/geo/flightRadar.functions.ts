// OpenSky Network's REST API doesn't send an Access-Control-Allow-Origin
// header for third-party origins (verified live: it only allows
// opensky-network.org itself), so a browser fetch is silently blocked by
// CORS no matter what — curl-based verification during development missed
// this because curl doesn't enforce CORS at all (it's a browser-only
// mechanism). Routing through a server function sidesteps it entirely:
// server-to-server requests have no CORS restriction.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { fetchNearbyFlights, type Aircraft } from "./flightRadar";

const Input = z.object({ lat: z.number(), lon: z.number() });

export const fetchNearbyFlightsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<Aircraft[]> => {
    const { supabase, userId } = context;
    try {
      return await fetchNearbyFlights(data.lat, data.lon);
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
        message: `OpenSky fetch failed: ${msg}`,
        meta: { lat: data.lat, lon: data.lon } as Json,
      });
      throw err;
    }
  });
