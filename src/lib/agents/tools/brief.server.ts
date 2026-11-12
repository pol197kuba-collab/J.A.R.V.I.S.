// Narzędzia agentów — brief. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import type { Tool } from "./shared.server";

// ---------------------------------------------------------------------------
// Poranny briefing — „streść mi dzień"
// ---------------------------------------------------------------------------
//
// Narzędzie CZYTA gotową rubrykę, a nie składa jej na nowo. Złożenie jest
// drogie (kilkanaście zapytań i wywołanie modelu) i z definicji raz na dobę;
// gdyby agent robił je przy każdym pytaniu, „co nowego" zadane trzy razy
// dałoby trzy różne odpowiedzi tego samego ranka.

export const readDailyBriefTool: Tool = {
  risk: "read",
  declaration: {
    name: "read_daily_brief",
    description:
      "Read the user's own morning brief: what moved on their watchlist, where their forecaster stands, wholesale fuel, which standing orders fired, what is overdue and what broke in the last day. USE THIS — never general knowledge or web search — for 'co nowego', 'streść mi dzień', 'co się wydarzyło', 'przeczytaj briefing', 'jak wygląda poranek'. The brief is composed once a night from the user's own data; you are reading it back, not recomputing it. If it is from an earlier day, say so rather than presenting it as today's.",
    parameters: { type: "object", properties: {} },
  },
  async execute(_args, ctx) {
    const { data } = await ctx.supabase
      .from("daily_briefs")
      .select("brief_date, greeting, sections, spoken, generated_by")
      .eq("owner_id", ctx.userId)
      .order("brief_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) {
      return {
        error: "no_brief",
        hint: "Briefing jeszcze nie powstał. Nocny przebieg składa go o 7:45; użytkownik może też złożyć go teraz przyciskiem na pulpicie.",
      };
    }

    const { parseSections } = await import("@/lib/brief/build.server");
    const today = new Date().toISOString().slice(0, 10);
    return {
      brief_date: data.brief_date,
      // Model ma powiedzieć wprost, gdy czyta wczorajszą rubrykę — inaczej
      // wczorajsze usterki zabrzmią jak dzisiejsze.
      is_today: data.brief_date === today,
      greeting: data.greeting,
      sections: parseSections(data.sections),
      spoken: data.spoken,
      composed_by: data.generated_by,
    };
  },
};
