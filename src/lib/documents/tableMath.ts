// DOKUMENTY — liczenie na tabelach z arkuszy (.xlsx / .csv) dla narzędzia
// M.E.T.R.I.C.-a `analyze_table`. Czyste, testowane w tableMath.test.ts.
//
// Model językowy źle sumuje setki wierszy „na oko”, więc liczby liczy kod:
// opis kolumn, filtr, grupowanie i agregaty (suma, średnia, min, max,
// liczność). Liczby w polskim zapisie („1 234,56 zł”, „12%”) są rozumiane.

export type Agg = "sum" | "avg" | "min" | "max" | "count";
export type FilterOp = "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte";
export type Filter = { column: string; op: FilterOp; value: string };

export type TableQuery = {
  operation: "describe" | "aggregate" | "rows";
  group_by?: string;
  value_column?: string;
  agg?: Agg;
  filters?: Filter[];
  /** aggregate: value_desc (domyślnie), value_asc, key (np. po dacie — trend). */
  sort?: "value_desc" | "value_asc" | "key";
  limit?: number;
};

/** „1 234,56 zł” → 1234.56; „12%” → 12; „1,234.5” → 1234.5; nie-liczba → null. */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!s) return null;
  s = s.replace(/^[^\d\-+.,]+/, "").replace(/[^\d.,]+$/, "");
  if (!/^[-+]?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // ostatni separator to dziesiętny, drugi to tysiące
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // sam przecinek: dziesiętny (polski zapis), chyba że to wyraźnie tysiące „1,234,567”
    s = /^\d{1,3}(,\d{3}){2,}$/.test(s.replace(/^[-+]/, ""))
      ? s.replace(/,/g, "")
      : s.replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const fold = (t: string) =>
  t.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/\p{M}/gu, "").trim();

/** Kolumna po nazwie nagłówka (dokładnie, potem zawiera) albo po literze „B”. */
export function resolveColumn(header: readonly string[], name: string): number | null {
  const want = fold(name);
  if (!want) return null;
  const exact = header.findIndex((h) => fold(h) === want);
  if (exact >= 0) return exact;
  const part = header.findIndex((h) => fold(h).includes(want));
  if (part >= 0) return part;
  if (/^[a-z]{1,2}$/.test(want)) {
    let n = 0;
    for (const ch of want) n = n * 26 + (ch.charCodeAt(0) - 96);
    return n - 1 < header.length ? n - 1 : null;
  }
  return null;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

export type TableResult = Record<string, unknown>;

export function analyzeTable(rows: readonly string[][], q: TableQuery): TableResult {
  if (rows.length === 0) return { error: "empty_table" };
  const header = rows[0].map((h, i) => h || `Kolumna ${i + 1}`);
  let data = rows.slice(1);
  const limit = Math.min(Math.max(1, q.limit ?? 50), 200);

  // filtry
  for (const f of q.filters ?? []) {
    const c = resolveColumn(header, f.column);
    if (c === null) return { error: "unknown_column", column: f.column, columns: header };
    const want = fold(f.value);
    const wantN = parseNumber(f.value);
    data = data.filter((r) => {
      const cell = r[c] ?? "";
      const n = parseNumber(cell);
      switch (f.op) {
        case "eq":
          return wantN !== null && n !== null ? n === wantN : fold(cell) === want;
        case "neq":
          return wantN !== null && n !== null ? n !== wantN : fold(cell) !== want;
        case "contains":
          return fold(cell).includes(want);
        case "gt":
          return n !== null && wantN !== null && n > wantN;
        case "gte":
          return n !== null && wantN !== null && n >= wantN;
        case "lt":
          return n !== null && wantN !== null && n < wantN;
        case "lte":
          return n !== null && wantN !== null && n <= wantN;
      }
    });
  }

  if (q.operation === "describe") {
    const columns = header.map((name, c) => {
      const cells = data.map((r) => r[c] ?? "").filter((v) => v !== "");
      const nums = cells.map(parseNumber).filter((n): n is number => n !== null);
      if (cells.length > 0 && nums.length / cells.length >= 0.8) {
        const sum = nums.reduce((a, b) => a + b, 0);
        return {
          name,
          type: "number",
          filled: cells.length,
          sum: round(sum),
          avg: round(sum / nums.length),
          min: Math.min(...nums),
          max: Math.max(...nums),
        };
      }
      const counts = new Map<string, number>();
      for (const v of cells) counts.set(v, (counts.get(v) ?? 0) + 1);
      const top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([value, count]) => ({ value, count }));
      return { name, type: "text", filled: cells.length, distinct: counts.size, top };
    });
    return { rows: data.length, columns, sample: data.slice(0, 5) };
  }

  if (q.operation === "rows") {
    return {
      matched: data.length,
      header,
      rows: data.slice(0, limit),
      truncated: data.length > limit,
    };
  }

  // aggregate
  const agg: Agg = q.agg ?? (q.value_column ? "sum" : "count");
  const vc = q.value_column ? resolveColumn(header, q.value_column) : null;
  if (q.value_column && vc === null)
    return { error: "unknown_column", column: q.value_column, columns: header };
  if (agg !== "count" && vc === null) return { error: "value_column_required_for_" + agg };
  const gc = q.group_by ? resolveColumn(header, q.group_by) : null;
  if (q.group_by && gc === null)
    return { error: "unknown_column", column: q.group_by, columns: header };

  const groups = new Map<string, { n: number; vals: number[] }>();
  let skipped = 0;
  for (const r of data) {
    const key = gc === null ? "(wszystko)" : (r[gc] ?? "").trim() || "(puste)";
    const g = groups.get(key) ?? { n: 0, vals: [] };
    g.n++;
    if (vc !== null) {
      const n = parseNumber(r[vc] ?? "");
      if (n === null) skipped++;
      else g.vals.push(n);
    }
    groups.set(key, g);
  }
  const value = (g: { n: number; vals: number[] }): number | null => {
    if (agg === "count") return g.n;
    if (g.vals.length === 0) return null;
    if (agg === "sum") return round(g.vals.reduce((a, b) => a + b, 0));
    if (agg === "avg") return round(g.vals.reduce((a, b) => a + b, 0) / g.vals.length);
    if (agg === "min") return Math.min(...g.vals);
    return Math.max(...g.vals);
  };
  let result = [...groups.entries()].map(([key, g]) => ({ key, value: value(g), rows: g.n }));
  const sort = q.sort ?? (gc === null ? "key" : "value_desc");
  result.sort((a, b) =>
    sort === "key"
      ? a.key.localeCompare(b.key, "pl", { numeric: true })
      : sort === "value_asc"
        ? (a.value ?? Infinity) - (b.value ?? Infinity)
        : (b.value ?? -Infinity) - (a.value ?? -Infinity),
  );
  const total = result.length;
  result = result.slice(0, limit);
  return {
    agg,
    value_column: vc === null ? null : header[vc],
    group_by: gc === null ? null : header[gc],
    rows_used: data.length,
    non_numeric_skipped: skipped,
    groups: result,
    groups_total: total,
    truncated: total > limit,
  };
}
