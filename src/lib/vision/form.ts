// Vision AR (S4.1) — the confirmation screen's form model. Pure: a draft
// from the model becomes plain strings the user can edit, and the edited
// strings go back through the strict save schema. Numbers stay strings
// while typing ("12," is a valid moment), so nothing jumps under the thumb.

import {
  SCAN_SCHEMAS,
  parseAmount,
  type ExpenseCategory,
  type ScanData,
  type ScanDraft,
  type StructuredMode,
} from "./modes";

export type ReceiptItemForm = {
  key: string;
  name: string;
  qty: string;
  price: string;
  category: ExpenseCategory;
};

export type ScanForm =
  | {
      mode: "receipt";
      merchant: string;
      date: string;
      total: string;
      currency: string;
      items: ReceiptItemForm[];
    }
  | { mode: "odometer"; km: string; liters: string; amount: string; note: string }
  | { mode: "document"; title: string; docType: string; summary: string; text: string }
  | { mode: "fridge"; products: string; recipeTitle: string; recipeSteps: string };

/** "12.5" → "12,50": how money reads in Polish. */
export const moneyText = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));
const numText = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));

let keySeq = 0;
export const newItemKey = () => `it${++keySeq}`;

export function formOf(d: ScanDraft): ScanForm {
  switch (d.mode) {
    case "receipt":
      return {
        mode: "receipt",
        merchant: d.draft.merchant,
        date: d.draft.date,
        total: moneyText(d.draft.total),
        currency: d.draft.currency,
        items: d.draft.items.map((i) => ({
          key: newItemKey(),
          name: i.name,
          qty: numText(i.qty),
          price: moneyText(i.price),
          category: i.category,
        })),
      };
    case "odometer":
      return {
        mode: "odometer",
        km: d.draft.odometerKm === null ? "" : String(d.draft.odometerKm),
        liters: numText(d.draft.fuelLiters),
        amount: moneyText(d.draft.amountPln),
        note: d.draft.note,
      };
    case "document":
      return { mode: "document", ...d.draft };
    case "fridge":
      return {
        mode: "fridge",
        products: d.draft.products.join("\n"),
        recipeTitle: d.draft.recipe?.title ?? "",
        recipeSteps: d.draft.recipe?.steps.join("\n") ?? "",
      };
  }
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const optNum = (s: string) => (s.trim() === "" ? null : (parseAmount(s) ?? Number.NaN));
const reqNum = (s: string) => parseAmount(s) ?? Number.NaN;

/** The form as the shape the save schema checks (not yet validated). */
export function candidateOf(f: ScanForm): unknown {
  switch (f.mode) {
    case "receipt":
      return {
        merchant: f.merchant,
        date: f.date,
        total: reqNum(f.total),
        currency: f.currency.trim().toUpperCase(),
        items: f.items.map((i) => ({
          name: i.name,
          qty: i.qty.trim() === "" ? 1 : (parseAmount(i.qty, 3) ?? Number.NaN),
          price: reqNum(i.price),
          category: i.category,
        })),
      };
    case "odometer":
      return {
        odometerKm: f.km.trim() === "" ? Number.NaN : Math.round(reqNum(f.km)),
        fuelLiters: optNum(f.liters),
        amountPln: optNum(f.amount),
        note: f.note.trim() || null,
      };
    case "document":
      return { title: f.title, docType: f.docType, summary: f.summary, text: f.text };
    case "fridge": {
      const steps = lines(f.recipeSteps);
      return {
        products: lines(f.products),
        recipe: f.recipeTitle.trim() && steps.length ? { title: f.recipeTitle, steps } : null,
      };
    }
  }
}

const FIELD: Record<string, string> = {
  merchant: "Sklep",
  date: "Data",
  total: "Suma",
  currency: "Waluta",
  items: "Pozycje",
  name: "nazwa",
  qty: "ilość",
  price: "kwota",
  category: "kategoria",
  odometerKm: "Przebieg",
  fuelLiters: "Litry",
  amountPln: "Kwota",
  note: "Uwaga",
  title: "Tytuł",
  docType: "Rodzaj",
  summary: "Streszczenie",
  text: "Tekst",
  products: "Produkty",
  recipe: "Przepis",
  steps: "kroki",
};

export type CheckedForm<M extends StructuredMode = StructuredMode> =
  | { ok: true; mode: M; data: ScanData[M] }
  | { ok: false; errors: string[] };

/** Strict check before saving; errors are short Polish lines naming the field. */
export function checkForm(f: ScanForm): CheckedForm {
  const res = SCAN_SCHEMAS[f.mode].safeParse(candidateOf(f));
  if (res.success) return { ok: true, mode: f.mode, data: res.data } as CheckedForm;
  const errors = res.error.issues.map((i) => {
    const where = i.path
      .map((p) => (typeof p === "number" ? `#${p + 1}` : (FIELD[String(p)] ?? String(p))))
      .join(" ");
    // our own messages are Polish; zod's defaults are English — replace those
    const why =
      i.code === "invalid_type"
        ? "wpisz poprawną wartość"
        : /^(Too|Invalid|Expected|Number|String|Array)\b/.test(i.message)
          ? "popraw wartość"
          : i.message.charAt(0).toLowerCase() + i.message.slice(1);
    return `${where}: ${why}`;
  });
  return { ok: false, errors: [...new Set(errors)].slice(0, 6) };
}
