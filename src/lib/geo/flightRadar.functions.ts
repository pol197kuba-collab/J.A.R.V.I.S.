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
import { fetchNearbyFlights, type Aircraft } from "./flightRadar";

const Input = z.object({ lat: z.number(), lon: z.number() });

export const fetchNearbyFlightsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<Aircraft[]> => {
    return fetchNearbyFlights(data.lat, data.lon);
  });
