// Server functions porannego briefingu: odczyt dzisiejszej rubryki i
// złożenie jej na żądanie.
//
// ODCZYT NIE SKŁADA BRIEFINGU SAM. Kusi, żeby przy pustym wyniku po prostu
// go zbudować — ale wtedy pierwsze wejście na pulpit czekałoby kilka sekund
// na model, a przy kilku kartach naraz zbudowałoby go kilka razy. Rubrykę
// robi nocny job; przycisk „złóż teraz" jest osobną, świadomą decyzją
// użytkownika.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildDailyBrief, parseSections, type BriefKeys } from "./build.server";
import type { DailyBrief } from "./types";

type Db = SupabaseClient<Database>;

/** Klucze modeli tego użytkownika — BYOK, nigdy nie opuszczają serwera. */
async function loadModelKeys(supabase: Db, userId: string): Promise<BriefKeys> {
  const { data } = await supabase
    .from("user_secrets")
    .select("gemini_api_key, anthropic_api_key")
    .eq("owner_id", userId)
    .maybeSingle();
  return {
    anthropicApiKey: data?.anthropic_api_key ?? null,
    geminiApiKey: data?.gemini_api_key ?? null,
  };
}

/**
 * Najnowszy briefing użytkownika, nie „dzisiejszy".
 *
 * Różnica ma znaczenie w dwóch sytuacjach, obu prawdziwych: gdy job nie
 * zdążył jeszcze przebiec, i gdy przebieg padł. Wczorajsza rubryka z
 * widoczną datą jest uczciwsza niż pusty panel sugerujący, że nic się nie
 * dzieje — pod warunkiem, że data jest widoczna, o co dba interfejs.
 */
export const getLatestBrief = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DailyBrief | null> => {
    const { data, error } = await context.supabase
      .from("daily_briefs")
      .select("brief_date, greeting, sections, spoken, generated_by, created_at")
      .eq("owner_id", context.userId)
      .order("brief_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    return {
      date: data.brief_date,
      greeting: data.greeting,
      sections: parseSections(data.sections),
      spoken: data.spoken,
      generatedBy: data.generated_by,
      createdAt: data.created_at,
    };
  });

/** Składa briefing na teraz. Bez powiadomienia — użytkownik właśnie patrzy. */
export const refreshBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DailyBrief> => {
    const keys = await loadModelKeys(context.supabase, context.userId);
    const { brief, error } = await buildDailyBrief(context.supabase, context.userId, keys, {
      notify: false,
    });
    if (error) throw new Error(error);
    return brief;
  });
