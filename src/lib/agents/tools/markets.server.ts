// Narzędzia agentów — markets. Wydzielone z tools.server.ts (plan naprawczy, etap 4);
// lista wszystkich narzędzi i rejestr z bazy: tools.server.ts.

import type { Tool } from "./shared.server";

// ---------------------------------------------------------------------------
// Rynki i paliwa — żeby J.A.R.V.I.S. umiał odpowiedzieć na pytanie o prognozę
// ---------------------------------------------------------------------------
//
// Bez tych dwóch narzędzi agent NIE MIAŁ DOSTĘPU do własnych modułów: na
// pytanie „czy przewidujesz wzrost Bitcoina" odpowiadał z ogólnej wiedzy albo
// szukał w sieci, mając obok gotowy typer liczony na notowaniach użytkownika.
// To nie było ograniczenie rozpoznawania mowy, tylko brak narzędzia.

/** Ile instrumentów najwyżej wraca do modelu i ile przesłanek przy każdym.
 *  Limity są po to, żeby odpowiedź narzędzia dało się przeczytać i streścić,
 *  a nie żeby oszczędzać bajty. */
const MAX_INSTRUMENTS_IN_REPLY = 6;
const MAX_DRIVERS_IN_REPLY = 3;

export const marketOutlookTool: Tool = {
  risk: "read",
  declaration: {
    name: "market_outlook",
    description:
      "Read the user's OWN market forecast from the /rynki module: direction (up/down/flat), score, confidence and the technical drivers behind it, for every instrument on their watchlist. USE THIS — never general knowledge or web search — whenever the user asks what you expect a price to do: 'czy przewidujesz wzrost bitcoina', 'co z kursem złota', 'will NVDA go up', 'jaka jest twoja prognoza dla WIG20'. The numbers come from the user's own cached quotes, so they are specific to what they actually track. Answer with the direction AND the confidence, and name the drivers — never present a forecast as a certainty.",
    parameters: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description:
            "Optional. One instrument to focus on, e.g. 'BTC', 'ETH', 'XAUUSD', 'NVDA.US', 'USDPLN'. Omit to get the whole watchlist. Matching is case-insensitive and also accepts a plain name like 'bitcoin' or 'złoto'.",
        },
      },
    },
  },
  async execute(args, ctx) {
    const { buildOutlook, HORIZON_DAYS } = await import("@/lib/markets/ingest.server");
    // Puste klucze CELOWO: to zamawia wariant sygnałowy, bez wywołania
    // modelu. Agent sam jest już turą modelu — dokładanie drugiego wywołania
    // w środku kosztowałoby sekundy i pieniądze, żeby dostać zdanie, które
    // agent i tak zaraz sformułuje po swojemu z tych samych przesłanek.
    const { rows } = await buildOutlook(ctx.supabase, ctx.userId, {
      anthropicApiKey: null,
      geminiApiKey: null,
    });
    if (rows.length === 0) {
      return {
        error: "no_data",
        hint: "Brak notowań w cache. Użytkownik musi raz otworzyć moduł /rynki albo poczekać na nocny przebieg.",
      };
    }

    const wanted = typeof args.symbol === "string" ? args.symbol.trim().toLowerCase() : "";
    const matched = wanted
      ? rows.filter(
          (r) =>
            r.symbol.toLowerCase() === wanted ||
            r.symbol.toLowerCase().startsWith(wanted) ||
            r.label.toLowerCase().includes(wanted),
        )
      : rows;

    // ROZMIAR WYNIKU MA ZNACZENIE. Pierwsza wersja oddawała całą watchlistę
    // z pełnym kompletem przesłanek — dla ośmiu instrumentów to ściana JSON-a,
    // po której model potrafił nie napisać już nic (zaobserwowane na żywo:
    // przebieg kończył się bez ani jednego znaku odpowiedzi). Pytanie brzmi
    // „czy Bitcoin urośnie", a nie „opowiedz o wszystkim" — więc gdy pada
    // konkretny instrument, oddajemy JEGO, a nie dwadzieścia innych.
    const picked = (matched.length > 0 ? matched : rows).slice(0, MAX_INSTRUMENTS_IN_REPLY);
    return {
      horizon_days: HORIZON_DAYS,
      matched_query: wanted || null,
      // Gdy nie znaleziono instrumentu, oddajemy całą watchlistę i mówimy o
      // tym wprost — model ma wtedy powiedzieć „nie śledzisz tego, ale…",
      // zamiast przypadkiem opisać cudzy instrument jako żądany.
      fell_back_to_watchlist: wanted.length > 0 && matched.length === 0,
      instruments: picked.map((r) => ({
        symbol: r.symbol,
        label: r.label,
        last_price: r.lastPrice,
        currency: r.currency,
        direction: r.direction,
        score: r.score,
        confidence: r.confidence,
        technical_score: r.technicalScore,
        sentiment_score: r.sentimentScore,
        news_items: r.sentimentItems,
        // Trzy najmocniejsze przesłanki wystarczą do uzasadnienia werdyktu;
        // pełna lista to głównie powtórzenia tej samej myśli innymi słowami.
        drivers: r.drivers.slice(0, MAX_DRIVERS_IN_REPLY).map((d) => d.note),
      })),
    };
  },
};

export const fuelOutlookTool: Tool = {
  risk: "read",
  declaration: {
    name: "fuel_outlook",
    description:
      "Read the user's OWN wholesale fuel-price forecast from the /paliwa module: the latest Orlen wholesale price, recent change, and a short-term projection with direction and confidence. USE THIS — never general knowledge — whenever the user asks where fuel prices are heading: 'co może się wydarzyć z cenami paliw', 'czy paliwo podrożeje', 'jak wyglądają ceny hurtowe diesla'. These are WHOLESALE prices in PLN per cubic metre (1 m³ = 1000 l), not prices at the pump — say so, and never quote them as what the user will pay at a station.",
    parameters: {
      type: "object",
      properties: {
        product: {
          type: "string",
          description:
            "Optional fuel: 'ON' (Ekodiesel, the default), 'PB95', 'PB98', 'ON_ARCTIC', 'EKOTERM'. Omit for diesel.",
        },
      },
    },
  },
  async execute(args, ctx) {
    const { ORLEN_PRODUCTS, DEFAULT_PRODUCT_ID } = await import("@/lib/fuel/orlen");
    const { forecastNext, computeStats } = await import("@/lib/fuel/analytics");
    const { fetchAllPages } = await import("@/lib/db/paginate");

    const wanted = typeof args.product === "string" ? args.product.trim().toUpperCase() : "";
    const product =
      ORLEN_PRODUCTS.find((p) => p.code === wanted) ??
      ORLEN_PRODUCTS.find((p) => p.id === DEFAULT_PRODUCT_ID)!;

    const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const rows = await fetchAllPages<{ price_date: string; price_per_m3: number }>((from, to) =>
      ctx.supabase
        .from("orlen_fuel_prices")
        .select("price_date, price_per_m3")
        .eq("product_id", product.id)
        .gte("price_date", since)
        .order("price_date", { ascending: true })
        .range(from, to),
    );

    const points = rows.map((r) => ({ date: r.price_date, price: Number(r.price_per_m3) }));
    if (points.length === 0) {
      return {
        error: "no_data",
        hint: "Brak cen w cache. Użytkownik musi raz otworzyć moduł /paliwa albo poczekać na nocny przebieg.",
      };
    }

    const stats = computeStats(points);
    const forecast = forecastNext(points);
    const last = points[points.length - 1];
    return {
      product: product.label,
      unit: "PLN/m³ (cena hurtowa, 1 m³ = 1000 l)",
      as_of: last.date,
      last_price: last.price,
      change_week_pct: stats.changeWeekPct,
      change_month_pct: stats.changeMonthPct,
      position_in_52w_range: stats.position52w,
      forecast: {
        direction: forecast.direction,
        confidence: forecast.confidence,
        slope_per_day: forecast.slopePerDay,
        horizon_days: forecast.points.length,
        last_point: forecast.points.at(-1) ?? null,
      },
    };
  },
};
