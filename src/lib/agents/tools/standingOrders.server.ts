// Narzędzia agentów — standingOrders. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import type { Tool } from "./shared.server";

// ---------------------------------------------------------------------------
// Stałe rozkazy — „powiadom mnie, gdy…"
// ---------------------------------------------------------------------------
//
// To jest jedyne narzędzie w tym pliku, które zostawia po sobie ZOBOWIĄZANIE:
// pozostałe odpowiadają na pytanie zadane teraz, a to każe systemowi wrócić
// do użytkownika później, z własnej inicjatywy. Stąd dwie zasady w opisie
// poniżej, obie wzięte z tego, co model musi wiedzieć, a czego nie wyczyta z
// samej nazwy funkcji: rozkaz sprawdza NOCNY job (więc meldunek przyjdzie
// najwcześniej po najbliższym przebiegu, a nie za minutę), i rozkaz działa
// wyłącznie na instrumentach, które system faktycznie zaciąga.

export const createStandingOrderTool: Tool = {
  risk: "write",
  declaration: {
    name: "create_standing_order",
    description:
      "Leave a STANDING ORDER: a condition the system checks on its own, every night, and reports when it becomes true. Use this whenever the user asks to be told about something in the future rather than right now: 'powiadom mnie, gdy bitcoin spadnie o 5 procent', 'daj znać, jak ON stanieje poniżej 5200', 'obserwuj złoto przez tydzień'. This does NOT answer a question about the current price — for that use market_outlook or fuel_outlook. The check runs after the nightly ingest, so the first possible report is the next run, not immediately; say so when confirming. Only instruments the system already tracks can be watched; if the subject is unknown the call fails and you must say what IS available instead of inventing a symbol.",
    parameters: {
      type: "object",
      properties: {
        subject_kind: {
          type: "string",
          enum: ["market", "fuel"],
          description:
            "'market' for an instrument from the /rynki module (crypto, stocks, metals, indices, FX), 'fuel' for an Orlen wholesale fuel price from /paliwa.",
        },
        subject: {
          type: "string",
          description:
            "What to watch. For 'market': a symbol such as 'BTC', 'ETH', 'XAUUSD', 'NVDA.US', 'USDPLN'. For 'fuel': 'ON' (Ekodiesel), 'PB95', 'PB98', 'ON_ARCTIC', 'EKOTERM'.",
        },
        condition: {
          type: "string",
          enum: ["level_above", "level_below", "change_pct_up", "change_pct_down", "change_abs"],
          description:
            "'level_below'/'level_above' compare the price itself against the threshold. 'change_pct_down'/'change_pct_up' need a PERCENTAGE threshold and fire on a move of at least that size within the window. 'change_abs' fires on a move of that many units in either direction.",
        },
        threshold: {
          type: "number",
          description:
            "Always a POSITIVE number. For 'change_pct_down' give the size of the fall (5 means 'drops by 5%'), never -5. For level conditions it is a price: market prices are in the instrument's own currency, fuel prices in PLN per cubic metre (5200, not 5.20).",
        },
        window_days: {
          type: "number",
          description:
            "For change conditions: over how many days the move is measured. Default 1 ('w ciągu dnia'). Ignored by level conditions.",
        },
        expires_in_days: {
          type: "number",
          description:
            "Optional. Set it when the user limits the watch in time ('przez tydzień' → 7). Omit for an open-ended order.",
        },
        phrase: {
          type: "string",
          description:
            "The user's own wording of the request, verbatim. It is quoted back in the report, so the user recognises which order fired.",
        },
      },
      required: ["subject_kind", "subject", "condition", "threshold"],
    },
  },
  async execute(args, ctx) {
    const { createOrder } = await import("@/lib/orders/mutate.server");
    const { listSubjects } = await import("@/lib/orders/subjects");

    const subjectKind = args.subject_kind === "fuel" ? "fuel" : "market";
    const threshold = Number(args.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return { error: "bad_threshold", hint: "Próg musi być liczbą dodatnią." };
    }

    try {
      const order = await createOrder(ctx.supabase, ctx.userId, {
        subjectKind,
        subject: String(args.subject ?? ""),
        condition: String(args.condition) as never,
        threshold,
        windowDays: Math.max(1, Math.min(90, Math.round(Number(args.window_days) || 1))),
        cooldownHours: 24,
        phrase: typeof args.phrase === "string" ? args.phrase.slice(0, 400) : null,
        expiresInDays: args.expires_in_days ? Math.round(Number(args.expires_in_days)) : null,
      });
      return {
        ok: true,
        order_id: order.id,
        description: order.description,
        // Model ma to powtórzyć użytkownikowi: obietnica „dam znać" jest
        // prawdziwa dopiero z zastrzeżeniem, KIEDY system zdąży sprawdzić.
        checked: "Po najbliższym nocnym przebiegu, potem raz dziennie.",
        expires_at: order.expiresAt,
      };
    } catch (err) {
      return {
        error: "rejected",
        message: err instanceof Error ? err.message : String(err),
        available: listSubjects()
          .filter((s) => s.kind === subjectKind)
          .map((s) => `${s.id} (${s.label})`),
      };
    }
  },
};

export const listStandingOrdersTool: Tool = {
  risk: "read",
  declaration: {
    name: "list_standing_orders",
    description:
      "List the standing orders the user has left — what the system is currently watching for them, whether each is still active, and how many times it has fired. Use it for 'co obserwujesz', 'jakie mam alerty', 'czy pilnujesz jeszcze bitcoina', and before cancelling anything, to get the order's id.",
    parameters: {
      type: "object",
      properties: {
        subject_kind: {
          type: "string",
          enum: ["market", "fuel"],
          description: "Optional filter: only market orders, or only fuel orders.",
        },
      },
    },
  },
  async execute(args, ctx) {
    const { listOrders } = await import("@/lib/orders/mutate.server");
    const kind =
      args.subject_kind === "fuel" || args.subject_kind === "market"
        ? args.subject_kind
        : undefined;
    const orders = await listOrders(ctx.supabase, ctx.userId, kind);
    return {
      count: orders.length,
      orders: orders.map((o) => ({
        id: o.id,
        description: o.description,
        subject_kind: o.subjectKind,
        enabled: o.isEnabled,
        expires_at: o.expiresAt,
        last_triggered_at: o.lastTriggeredAt,
        trigger_count: o.triggerCount,
        phrase: o.phrase,
      })),
    };
  },
};

export const cancelStandingOrderTool: Tool = {
  risk: "external",
  declaration: {
    name: "cancel_standing_order",
    description:
      "Cancel a standing order for good, or only silence it. Call list_standing_orders first to get the id — never guess one. Prefer silencing ('disable') when the user says 'na razie nie chcę tego słyszeć'; delete when they say to stop watching altogether.",
    parameters: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "The order's id, from list_standing_orders." },
        mode: {
          type: "string",
          enum: ["delete", "disable"],
          description: "'delete' removes it, 'disable' keeps it on the list but silent.",
        },
      },
      required: ["order_id"],
    },
  },
  async execute(args, ctx) {
    const id = String(args.order_id ?? "");
    if (!id) return { error: "missing_id" };

    if (args.mode === "disable") {
      const { error } = await ctx.supabase
        .from("standing_orders")
        .update({ is_enabled: false })
        .eq("id", id)
        .eq("owner_id", ctx.userId);
      return error ? { error: error.message } : { ok: true, mode: "disabled" };
    }

    const { error } = await ctx.supabase
      .from("standing_orders")
      .delete()
      .eq("id", id)
      .eq("owner_id", ctx.userId);
    return error ? { error: error.message } : { ok: true, mode: "deleted" };
  },
};
