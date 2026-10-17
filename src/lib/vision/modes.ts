// Vision AR (PLAN.md, S4.1) — scan modes. Pure: what each mode asks the
// model for, the JSON schema the model fills, how a loose answer becomes an
// editable draft, and the strict schema a confirmed scan must pass before
// it is saved. Nothing is saved "in the dark": the model's answer is only a
// draft for the confirmation screen.

import { z } from "zod";

export type ScanMode = "receipt" | "odometer" | "document" | "fridge" | "free";

export const SCAN_MODES: readonly { id: ScanMode; label: string; hint: string }[] = [
  { id: "receipt", label: "Paragon", hint: "Cały paragon w kadrze, od nagłówka do sumy." },
  {
    id: "odometer",
    label: "Licznik",
    hint: "Licznik przebiegu; przy tankowaniu też dystrybutor (litry i kwota).",
  },
  { id: "document", label: "Dokument", hint: "Kartka płasko, cała strona w kadrze." },
  { id: "fridge", label: "Lodówka", hint: "Otwarta lodówka albo produkty na blacie." },
  { id: "free", label: "Dowolne", hint: "Cokolwiek — J.A.R.V.I.S. powie, co widzi." },
];

export const isScanMode = (v: unknown): v is ScanMode =>
  typeof v === "string" && SCAN_MODES.some((m) => m.id === v);

/** Modes read into fields and confirmed before saving ("free" only describes). */
export type StructuredMode = Exclude<ScanMode, "free">;

// ── expense categories (the receipt's items; Wydatki in S4.2 sums them) ─────

export const EXPENSE_CATEGORIES = [
  "zywnosc",
  "napoje",
  "chemia",
  "dom",
  "zdrowie",
  "transport",
  "rozrywka",
  "inne",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  zywnosc: "Żywność",
  napoje: "Napoje",
  chemia: "Chemia",
  dom: "Dom",
  zdrowie: "Zdrowie",
  transport: "Transport",
  rozrywka: "Rozrywka",
  inne: "Inne",
};

// ── strict schemas: what a confirmed scan must look like to be saved ────────

const money = z.number().finite().min(-1_000_000).max(1_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Wybierz datę");

export const ReceiptItemSchema = z.object({
  name: z.string().trim().min(1, "Wpisz nazwę").max(120),
  qty: z.number().finite().positive().max(10_000),
  /** Line total in the receipt's currency (a discount line is negative). */
  price: money,
  category: z.enum(EXPENSE_CATEGORIES),
});
export type ReceiptItem = z.infer<typeof ReceiptItemSchema>;

export const ReceiptSchema = z.object({
  merchant: z.string().trim().min(1, "Wpisz nazwę sklepu").max(120),
  date: isoDate,
  total: money.min(0, "Nie może być ujemna"),
  currency: z.string().regex(/^[A-Z]{3}$/, "Trzy litery, np. PLN"),
  items: z.array(ReceiptItemSchema).max(300),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

export const OdometerSchema = z.object({
  odometerKm: z.number().int("Pełne kilometry").min(0).max(3_000_000),
  fuelLiters: z.number().finite().positive().max(500).nullable(),
  /** What the pump or the fuel receipt says was paid, PLN. */
  amountPln: z.number().finite().positive().max(10_000).nullable(),
  note: z.string().trim().max(200).nullable(),
});
export type Odometer = z.infer<typeof OdometerSchema>;

export const DocumentScanSchema = z.object({
  title: z.string().trim().min(1, "Wpisz tytuł").max(200),
  docType: z.string().trim().min(1).max(60),
  summary: z.string().trim().max(1500),
  text: z.string().max(20_000),
});
export type DocumentScan = z.infer<typeof DocumentScanSchema>;

export const FridgeSchema = z.object({
  products: z.array(z.string().trim().min(1).max(80)).max(100),
  recipe: z
    .object({
      title: z.string().trim().min(1).max(120),
      steps: z.array(z.string().trim().min(1).max(300)).max(20),
    })
    .nullable(),
});
export type Fridge = z.infer<typeof FridgeSchema>;

export type ScanData = {
  receipt: Receipt;
  odometer: Odometer;
  document: DocumentScan;
  fridge: Fridge;
};

export const SCAN_SCHEMAS = {
  receipt: ReceiptSchema,
  odometer: OdometerSchema,
  document: DocumentScanSchema,
  fridge: FridgeSchema,
} as const;

// ── loose → draft: whatever the model returned, made editable ──────────────

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** „12,99 zł”, "1 234.50", 12.99 → 12.99; anything else → null. Weighed
 *  quantities keep 3 decimals (1,235 kg), money 2. */
export function parseAmount(v: unknown, digits = 2): number | null {
  const k = 10 ** digits;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * k) / k : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d,.\-−]/g, "").replace("−", "-");
  if (!/\d/.test(s)) return null;
  // "1.234,50" / "1,234.50": the last separator is the decimal one
  const lastComma = s.lastIndexOf(","),
    lastDot = s.lastIndexOf(".");
  const dec = Math.max(lastComma, lastDot);
  if (dec >= 0 && s.length - dec - 1 <= Math.max(2, digits)) {
    s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  } else s = s.replace(/[.,]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * k) / k : null;
}

/** "2026-10-17", "17.10.2026", "17-10-26", "2026/10/17" → "2026-10-17"; else "". */
export function parseDate(v: unknown): string {
  const s = str(v, 40);
  let y: number, m: number, d: number;
  let mt = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = s.match(/(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/))) {
    [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
    if (y < 100) y += 2000;
  } else return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const asCategory = (v: unknown): ExpenseCategory => {
  const s = str(v, 30).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace("ł", "l");
  return (EXPENSE_CATEGORIES as readonly string[]).includes(s) ? (s as ExpenseCategory) : "inne";
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Editable receipt draft; may be incomplete — the confirm screen fills the gaps. */
export type ReceiptDraft = {
  merchant: string;
  date: string;
  total: number | null;
  currency: string;
  items: ReceiptItem[];
};

export function normalizeReceipt(raw: unknown): ReceiptDraft {
  const r = obj(raw);
  const items: ReceiptItem[] = (Array.isArray(r.items) ? r.items : [])
    .map((it) => {
      const o = obj(it);
      const qty = parseAmount(o.qty, 3);
      return {
        name: str(o.name, 120),
        qty: qty !== null && qty > 0 ? qty : 1,
        price: parseAmount(o.price) ?? 0,
        category: asCategory(o.category),
      };
    })
    .filter((it) => it.name.length > 0)
    .slice(0, 300);
  const currency = str(r.currency, 3).toUpperCase();
  const total = parseAmount(r.total);
  return {
    merchant: str(r.merchant, 120),
    date: parseDate(r.date),
    total: total !== null && total >= 0 ? total : items.length ? itemsSum(items) : null,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "PLN",
    items,
  };
}

export const itemsSum = (items: readonly { price: number }[]) =>
  Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100;

/** What the confirm screen should flag before the user saves. */
export function receiptWarnings(d: ReceiptDraft, today: string): string[] {
  const w: string[] = [];
  if (!d.merchant) w.push("Brak nazwy sklepu.");
  if (!d.date) w.push("Nie odczytałem daty.");
  else if (d.date > today) w.push("Data jest z przyszłości.");
  if (d.total === null) w.push("Nie odczytałem sumy.");
  if (d.items.length === 0) w.push("Brak pozycji — zapiszesz samą sumę.");
  else if (d.total !== null) {
    const diff = Math.round((itemsSum(d.items) - d.total) * 100) / 100;
    if (Math.abs(diff) > 0.02)
      w.push(
        `Pozycje sumują się do ${itemsSum(d.items).toFixed(2).replace(".", ",")}, a suma to ${d.total.toFixed(2).replace(".", ",")} (różnica ${diff.toFixed(2).replace(".", ",")}).`,
      );
  }
  return w;
}

export type OdometerDraft = {
  odometerKm: number | null;
  fuelLiters: number | null;
  amountPln: number | null;
  note: string;
};

export function normalizeOdometer(raw: unknown): OdometerDraft {
  const r = obj(raw);
  const km = parseAmount(r.odometerKm);
  const l = parseAmount(r.fuelLiters);
  const a = parseAmount(r.amountPln);
  return {
    odometerKm: km !== null && km >= 0 ? Math.round(km) : null,
    fuelLiters: l !== null && l > 0 ? l : null,
    amountPln: a !== null && a > 0 ? a : null,
    note: str(r.note, 200),
  };
}

export function normalizeDocument(raw: unknown): DocumentScan {
  const r = obj(raw);
  return {
    title: str(r.title, 200),
    docType: str(r.docType, 60) || "dokument",
    summary: str(r.summary, 1500),
    text: typeof r.text === "string" ? r.text.trim().slice(0, 20_000) : "",
  };
}

export function normalizeFridge(raw: unknown): Fridge {
  const r = obj(raw);
  const products = (Array.isArray(r.products) ? r.products : [])
    .map((p) => str(p, 80))
    .filter(Boolean)
    .slice(0, 100);
  const rec = obj(r.recipe);
  const title = str(rec.title, 120);
  const steps = (Array.isArray(rec.steps) ? rec.steps : [])
    .map((s) => str(s, 300))
    .filter(Boolean)
    .slice(0, 20);
  return { products, recipe: title && steps.length ? { title, steps } : null };
}

export type ScanDraft =
  | { mode: "receipt"; draft: ReceiptDraft }
  | { mode: "odometer"; draft: OdometerDraft }
  | { mode: "document"; draft: DocumentScan }
  | { mode: "fridge"; draft: Fridge };

export function normalizeScan(mode: StructuredMode, raw: unknown): ScanDraft {
  switch (mode) {
    case "receipt":
      return { mode, draft: normalizeReceipt(raw) };
    case "odometer":
      return { mode, draft: normalizeOdometer(raw) };
    case "document":
      return { mode, draft: normalizeDocument(raw) };
    case "fridge":
      return { mode, draft: normalizeFridge(raw) };
  }
}

// ── what the model is asked (Gemini JSON mode) ─────────────────────────────

const S = (description?: string) => ({ type: "STRING", ...(description && { description }) });
const N = (description?: string) => ({ type: "NUMBER", ...(description && { description }) });
const nullable = <T extends object>(t: T) => ({ ...t, nullable: true });

export const MODE_PROMPT: Record<StructuredMode, string> = {
  receipt:
    "Odczytaj paragon fiskalny ze zdjęcia. Przepisz każdą pozycję tak, jak jest na paragonie " +
    "(nazwa, ilość, wartość pozycji po rabacie). Rabat zapisany osobną linią wpisz jako pozycję " +
    "z ujemną wartością. total = SUMA PLN z paragonu. date w formacie RRRR-MM-DD. Kategorię każdej " +
    "pozycji wybierz z listy. Nie zgaduj: czego nie widać, zostaw puste lub null.",
  odometer:
    "Odczytaj licznik przebiegu samochodu (całkowity, nie dzienny — trip) w kilometrach. Jeśli na " +
    "zdjęciu jest dystrybutor albo paragon za paliwo, odczytaj też liczbę zatankowanych litrów " +
    "i zapłaconą kwotę w PLN (DO ZAPŁATY / NALEŻNOŚĆ, nie cenę za litr). " +
    "Nie zgaduj: czego nie widać, zwróć null.",
  document:
    "Odczytaj dokument ze zdjęcia: nadaj mu krótki tytuł, rodzaj (np. faktura, umowa, pismo, " +
    "instrukcja, notatka), streszczenie w 2-4 zdaniach po polsku i pełny tekst (OCR) z zachowaniem " +
    "akapitów.",
  fridge:
    "Wypisz produkty spożywcze widoczne na zdjęciu (po polsku, krótko, bez marek, jeśli nie są " +
    "czytelne). Zaproponuj jeden prosty przepis, który da się zrobić głównie z nich — tytuł i kroki.",
};

export const MODE_RESPONSE_SCHEMA: Record<StructuredMode, object> = {
  receipt: {
    type: "OBJECT",
    properties: {
      merchant: nullable(S("Nazwa sklepu z nagłówka")),
      date: nullable(S("RRRR-MM-DD")),
      total: nullable(N("Suma do zapłaty")),
      currency: nullable(S("Kod waluty, np. PLN")),
      items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: S(),
            qty: nullable(N()),
            price: N("Wartość pozycji (ilość × cena, po rabacie)"),
            category: { type: "STRING", enum: [...EXPENSE_CATEGORIES] },
          },
          required: ["name", "price", "category"],
        },
      },
    },
    required: ["merchant", "date", "total", "currency", "items"],
  },
  odometer: {
    type: "OBJECT",
    properties: {
      odometerKm: nullable(N("Całkowity przebieg w km")),
      fuelLiters: nullable(N("Zatankowane litry, jeśli widać")),
      amountPln: nullable(N("Kwota zapłacona za paliwo w PLN, jeśli widać")),
      note: nullable(S("Krótka uwaga, np. który licznik odczytano")),
    },
    required: ["odometerKm", "fuelLiters", "amountPln", "note"],
  },
  document: {
    type: "OBJECT",
    properties: { title: S(), docType: S(), summary: S(), text: S() },
    required: ["title", "docType", "summary", "text"],
  },
  fridge: {
    type: "OBJECT",
    properties: {
      products: { type: "ARRAY", items: S() },
      recipe: nullable({
        type: "OBJECT",
        properties: { title: S(), steps: { type: "ARRAY", items: S() } },
        required: ["title", "steps"],
      }),
    },
    required: ["products", "recipe"],
  },
};

/** Longest side sent to the model: text needs more pixels than a scene. */
export const FRAME_MAX_SIDE: Record<ScanMode, number> = {
  receipt: 1600,
  document: 1600,
  odometer: 1280,
  fridge: 1024,
  free: 1024,
};

/** How long a scan's photo is kept in Storage. */
export const PHOTO_RETENTION_DAYS = 30;

/** How many leaf fields the user changed between the model's draft and what
 *  they saved (added/removed list entries count once each) — a plain measure
 *  of how much the reading had to be fixed. */
export function countEdits(before: unknown, after: unknown): number {
  if (Array.isArray(before) || Array.isArray(after)) {
    const a = Array.isArray(before) ? before : [],
      b = Array.isArray(after) ? after : [];
    let n = Math.abs(a.length - b.length);
    for (let i = 0; i < Math.min(a.length, b.length); i++) n += countEdits(a[i], b[i]);
    return n;
  }
  const isObj = (v: unknown) => v !== null && typeof v === "object";
  if (isObj(before) && isObj(after)) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>;
    let n = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) n += countEdits(a[k], b[k]);
    return n;
  }
  const norm = (v: unknown) => (v === "" || v === undefined ? null : v);
  return norm(before) === norm(after) ? 0 : 1;
}
