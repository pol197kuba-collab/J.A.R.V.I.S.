// MARKET GRID — parsery odpowiedzi dostawców notowań.
//
// Wydzielone z warstwy sieciowej (./quotes.server.ts) celowo: to jedyne
// miejsce, gdzie cudzy, zmienny format staje się naszym PricePoint[], więc
// musi dać się przetestować na utrwalonych próbkach bez ruszania sieci.
// Każdy parser jest tolerancyjny — brakujące/niepełne wiersze pomija zamiast
// rzucać, bo darmowe API regularnie zwracają dziury (świeża sesja bez
// zamknięcia, święto, chwilowy null).
import type { PricePoint } from "./series";

const isoFromMillis = (ms: number): string | null => {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * Stooq: CSV `Date,Open,High,Low,Close,Volume`. Uwaga — gdy Stooq uzna
 * klienta za bota, odpowiada HTTP 200 ze stroną HTML zamiast CSV. Wtedy
 * pierwszy wiersz nie jest nagłówkiem i zwracamy pustą serię, żeby łańcuch
 * dostawców mógł spróbować kolejnego źródła zamiast zapisać do cache'u
 * śmieci.
 */
export function parseStooqCsv(csv: string): PricePoint[] {
  const text = csv.trim();
  if (!text || text.startsWith("<")) return [];
  const lines = text.split(/\r?\n/);
  const header = lines[0]?.toLowerCase() ?? "";
  if (!header.startsWith("date")) return [];
  const closeIdx = header.split(",").indexOf("close");
  if (closeIdx === -1) return [];

  const points: PricePoint[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const date = cols[0]?.trim();
    const close = Number(cols[closeIdx]);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(close) || close <= 0) continue;
    points.push({ date, close });
  }
  return points;
}

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: unknown;
  };
};

/**
 * Yahoo Finance v8 chart. `close` bywa tablicą z nullami na dniach bez
 * notowania — te indeksy pomijamy, a nie zerujemy.
 */
export function parseYahooChart(raw: unknown): PricePoint[] {
  const data = raw as YahooChart;
  const result = data?.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const points: PricePoint[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i];
    if (close === null || close === undefined || !Number.isFinite(close) || close <= 0) continue;
    const date = isoFromMillis(stamps[i] * 1000);
    if (!date) continue;
    points.push({ date, close });
  }
  return points;
}

type CoinGeckoChart = { prices?: Array<[number, number]> };

/**
 * CoinGecko market_chart. Przy `interval=daily` ostatni punkt to cena
 * bieżąca (nie zamknięcie dnia), więc dla tej samej daty wygrywa ostatni
 * odczyt — normalizeSeries deduplikuje po dacie w tej samej kolejności.
 */
export function parseCoinGeckoChart(raw: unknown): PricePoint[] {
  const rows = (raw as CoinGeckoChart)?.prices ?? [];
  const points: PricePoint[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const date = isoFromMillis(row[0]);
    const close = row[1];
    if (!date || !Number.isFinite(close) || close <= 0) continue;
    points.push({ date, close });
  }
  return points;
}

type FrankfurterSeries = { rates?: Record<string, Record<string, number>> };

/** Frankfurter: `{ rates: { "2026-09-10": { PLN: 3.72 } } }`. */
export function parseFrankfurterSeries(raw: unknown, quote: string): PricePoint[] {
  const rates = (raw as FrankfurterSeries)?.rates ?? {};
  const points: PricePoint[] = [];
  for (const [date, row] of Object.entries(rates)) {
    const close = row?.[quote];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(close) || close <= 0) continue;
    points.push({ date, close });
  }
  return points;
}
