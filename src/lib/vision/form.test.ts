import { describe, expect, it } from "vitest";
import { checkForm, formOf } from "./form";
import { normalizeScan } from "./modes";

describe("confirmation form", () => {
  const receipt = normalizeScan("receipt", {
    merchant: "Lidl",
    date: "2026-10-17",
    total: 10.5,
    currency: "PLN",
    items: [
      { name: "Chleb", qty: 1, price: 4.5, category: "zywnosc" },
      { name: "Woda", qty: 2, price: 6, category: "napoje" },
    ],
  });

  it("round-trips a receipt through Polish-formatted strings", () => {
    const f = formOf(receipt);
    if (f.mode !== "receipt") throw new Error("mode");
    expect(f.total).toBe("10,50");
    expect(f.items[1].price).toBe("6,00");
    const r = checkForm(f);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual(receipt.draft);
  });

  it("names the fields the user must fix", () => {
    const f = formOf(receipt);
    if (f.mode !== "receipt") throw new Error("mode");
    const bad = {
      ...f,
      merchant: " ",
      total: "abc",
      items: [{ ...f.items[0], name: "" }, f.items[1]],
    };
    const r = checkForm(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith("Sklep:"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("Suma:"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("Pozycje #1 nazwa:"))).toBe(true);
    }
  });

  it("odometer needs km, liters are optional; fridge drops an empty recipe", () => {
    const o = formOf(normalizeScan("odometer", { odometerKm: null }));
    expect(checkForm(o).ok).toBe(false);
    const ok = checkForm({ mode: "odometer", km: "123 456", liters: "", amount: "", note: "" });
    expect(ok).toEqual({
      ok: true,
      mode: "odometer",
      data: { odometerKm: 123456, fuelLiters: null, amountPln: null, note: null },
    });
    const fr = checkForm({
      mode: "fridge",
      products: "jajka\n\nmleko ",
      recipeTitle: "",
      recipeSteps: "",
    });
    expect(fr).toEqual({
      ok: true,
      mode: "fridge",
      data: { products: ["jajka", "mleko"], recipe: null },
    });
  });
});
