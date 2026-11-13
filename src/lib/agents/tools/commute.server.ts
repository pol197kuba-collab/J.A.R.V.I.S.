// Narzędzie agentów — dojazd (Situation Room). Bez niego J.A.R.V.I.S. nie miał
// dostępu do danych TomTom i na „jak wygląda droga do domu” prosił o adres,
// choć dom, praca i klucz leżą w Ustawieniach → Dojazd (zgłoszenie właściciela
// 2026-11-13). Liczy dokładnie to samo co strona /situation-room.
import { commuteToolReply } from "@/lib/commute/agentReply";
import { computeCommute, loadCommuteSettings } from "@/lib/commute/commute.server";
import { defaultDirection } from "@/lib/commute/plan";
import type { CommuteDirection } from "@/lib/commute/types";
import type { Tool } from "./shared.server";

function directionOf(arg: unknown): CommuteDirection | null {
  if (arg === "to_work") return "to";
  if (arg === "home") return "back";
  return null;
}

export const checkCommuteTool: Tool = {
  risk: "read",
  declaration: {
    name: "check_commute",
    description:
      "Check the user's OWN commute between home and work with live traffic from TomTom — the same data as the Situation Room module: travel time, usual time, delay, arrival time, incidents on the route (accidents, jams, roadworks), a suggested detour and the alternative routes. Home and work are already saved in the user's settings — NEVER ask the user for an address or a route. USE THIS whenever the user asks about the way to work or home, traffic, jams or when to leave: 'jak wygląda droga do domu', 'są korki do pracy?', 'ile jadę do domu', 'o której mam wyjechać'. Answer from the 'summary' sentences; mention the detour if there is one.",
    parameters: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["to_work", "home"],
          description:
            "'to_work' = home → work, 'home' = work → home. Omit when the user did not say — the time of day decides (morning: to work, afternoon: home).",
        },
        when: {
          type: "string",
          enum: ["now", "planned"],
          description:
            "'now' (default) = leaving right now with live traffic. 'planned' = the user's planned departure time from settings (e.g. 'jak będzie jutro rano').",
        },
      },
    },
  },
  async execute(args, ctx) {
    const now = new Date();
    const settings = await loadCommuteSettings(ctx.supabase, ctx.userId);
    const direction = directionOf(args.direction) ?? defaultDirection(now, settings);
    const planned = args.when === "planned";
    try {
      const outcome = await computeCommute(
        ctx.supabase,
        ctx.userId,
        direction,
        now,
        settings,
        planned ? undefined : { at: now, live: true },
      );
      if (!outcome.ok) {
        return outcome.reason === "no_places"
          ? {
              error: "no_places",
              hint: "Dom albo praca nie są ustawione. Powiedz użytkownikowi, żeby wskazał je w Ustawieniach → Dojazd.",
            }
          : {
              error: "no_key",
              hint: "Brak klucza TomTom. Powiedz użytkownikowi, żeby wpisał go w Ustawieniach → Klucze API.",
            };
      }
      return commuteToolReply(outcome.result, settings);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.logEvent("error", "tool.check_commute", message, { direction });
      return {
        error: "tomtom_failed",
        hint: "TomTom nie odpowiedział. Powiedz to wprost, bez zgadywania.",
      };
    }
  },
};
