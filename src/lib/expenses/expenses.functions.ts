// WYDATKI (S4.2) — reads and deletes for /wydatki. Expenses are written by
// saveScan (a confirmed receipt); this module only lists and removes them.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/vision/modes";
import { shiftMonth, type ExpenseRow } from "./summary";

/** How many months the page needs: the chosen one plus the trend behind it. */
export const TREND_MONTHS = 6;

const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export type ExpensesView = { month: string; rows: ExpenseRow[] };

const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

export const getExpenses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ month: MonthSchema }).parse(input))
  .handler(async ({ data, context }): Promise<ExpensesView> => {
    const { supabase, userId } = context;
    const from = `${shiftMonth(data.month, -(TREND_MONTHS - 1))}-01`;
    const { data: rows, error } = await supabase
      .from("expenses")
      .select(
        "id, merchant, spent_on, total, currency, created_at, scan:vision_scans(photo_path), expense_items(name, qty, price, category, position)",
      )
      .eq("owner_id", userId)
      .gte("spent_on", from)
      .lte("spent_on", lastDay(data.month))
      .order("spent_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Nie udało się wczytać wydatków: ${error.message}`);

    const cat = (c: string): ExpenseCategory =>
      (EXPENSE_CATEGORIES as readonly string[]).includes(c) ? (c as ExpenseCategory) : "inne";
    return {
      month: data.month,
      rows: (rows ?? []).map((r) => {
        const scan = (Array.isArray(r.scan) ? r.scan[0] : r.scan) as {
          photo_path: string | null;
        } | null;
        return {
          id: r.id,
          merchant: r.merchant,
          spentOn: r.spent_on,
          total: Number(r.total),
          currency: r.currency,
          hasPhoto: Boolean(scan?.photo_path),
          items: [...(r.expense_items ?? [])]
            .sort((a, b) => a.position - b.position)
            .map((i) => ({
              name: i.name,
              qty: Number(i.qty),
              price: Number(i.price),
              category: cat(i.category),
            })),
        };
      }),
    };
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("expenses")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", userId);
    if (error) throw new Error(`Nie udało się usunąć wydatku: ${error.message}`);
    return { ok: true };
  });

/** A short-lived link to the receipt's photo (while its 30 days last). */
export const expensePhotoUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("expenses")
      .select("scan:vision_scans(photo_path)")
      .eq("id", data.id)
      .eq("owner_id", userId)
      .maybeSingle();
    const scan = (Array.isArray(row?.scan) ? row?.scan[0] : row?.scan) as {
      photo_path: string | null;
    } | null;
    if (!scan?.photo_path) return { url: null };
    const { data: signed } = await supabase.storage
      .from("scans")
      .createSignedUrl(scan.photo_path, 300);
    return { url: signed?.signedUrl ?? null };
  });
