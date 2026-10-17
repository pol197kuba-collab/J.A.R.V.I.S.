// WYDATKI — the month's receipts. A row folds out into its items, a link
// to the photo (while its 30 days last) and a two-step delete.

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ImageIcon, Trash2 } from "lucide-react";
import { formatDatePl, formatPln } from "@/components/jarvis/fuel/format";
import { expensePhotoUrl } from "@/lib/expenses/expenses.functions";
import type { ExpenseRow } from "@/lib/expenses/summary";
import { CATEGORY_LABEL } from "@/lib/vision/modes";

const money = (v: number) => formatPln(v, 2);

export function ExpenseList({
  rows,
  onDelete,
  deletingId,
}: {
  rows: readonly ExpenseRow[];
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-primary/10">
      {rows.map((r) => (
        <ExpenseItem
          key={r.id}
          row={r}
          open={open === r.id}
          onToggle={() => setOpen((o) => (o === r.id ? null : r.id))}
          onDelete={() => onDelete(r.id)}
          deleting={deletingId === r.id}
        />
      ))}
    </ul>
  );
}

function ExpenseItem({
  row,
  open,
  onToggle,
  onDelete,
  deleting,
}: {
  row: ExpenseRow;
  open: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photo = useServerFn(expensePhotoUrl);

  const openPhoto = async () => {
    // open the tab synchronously so mobile popup blockers let it through
    const tab = window.open("", "_blank");
    setPhotoBusy(true);
    try {
      const { url } = await photo({ data: { id: row.id } });
      if (url && tab) tab.location.href = url;
      else tab?.close();
    } catch {
      tab?.close();
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full min-w-0 grid-cols-[4.5rem_1fr_auto_auto] items-center gap-3 px-1 py-2.5 text-left transition hover:bg-primary/5 @max-[420px]:grid-cols-[1fr_auto_auto] @max-[420px]:gap-2"
      >
        <span className="font-mono text-[11px] text-muted-foreground @max-[420px]:hidden">
          {formatDatePl(row.spentOn).replace(/\s\d{4}$/, "")}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-mono text-[12px] text-foreground">
            {row.merchant}
          </span>
          <span className="block font-mono text-[10px] text-muted-foreground">
            <span className="hidden @max-[420px]:inline">
              {formatDatePl(row.spentOn).replace(/\s\d{4}$/, "")} ·{" "}
            </span>
            {row.items.length ? `${row.items.length} poz.` : "sama suma"}
          </span>
        </span>
        <span className="font-display text-sm font-bold tracking-wide text-foreground">
          {money(row.total)}
          <span className="ml-1 text-[9px] font-normal text-muted-foreground">
            {row.currency === "PLN" ? "zł" : row.currency}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-primary transition ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div className="min-w-0 border-l border-primary/25 pb-3 pl-3 ml-1">
          {row.items.length > 0 ? (
            <ul className="space-y-1">
              {row.items.map((it, i) => (
                <li
                  key={i}
                  className="grid min-w-0 grid-cols-[1fr_auto] items-baseline gap-2 font-mono text-[11px]"
                >
                  <span className="min-w-0 break-words text-foreground/90">
                    {it.name}
                    {it.qty !== 1 && (
                      <span className="text-muted-foreground">
                        {" "}
                        × {String(it.qty).replace(".", ",")}
                      </span>
                    )}
                    <span className="ml-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                      {CATEGORY_LABEL[it.category]}
                    </span>
                  </span>
                  <span
                    className={it.price < 0 ? "text-[color:var(--success)]" : "text-foreground"}
                  >
                    {money(it.price)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-mono text-[11px] text-muted-foreground">
              Paragon zapisany bez pozycji — liczy się jako „Inne”.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {row.hasPhoto && (
              <button
                type="button"
                onClick={() => void openPhoto()}
                disabled={photoBusy}
                className="font-display flex items-center gap-1.5 border border-primary/40 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-primary transition hover:bg-primary/10 disabled:opacity-50"
              >
                <ImageIcon className="h-3 w-3" strokeWidth={2} />
                Zdjęcie
              </button>
            )}
            {confirm ? (
              <>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={deleting}
                  className="font-display flex items-center gap-1.5 border border-destructive/60 bg-destructive/10 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-destructive transition disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={2} />
                  {deleting ? "Usuwam…" : "Tak, usuń"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm(false)}
                  className="font-display border border-primary/30 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-muted-foreground transition hover:bg-primary/10"
                >
                  Anuluj
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm(true)}
                className="font-display flex items-center gap-1.5 border border-destructive/40 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-destructive transition hover:bg-destructive/10"
              >
                <Trash2 className="h-3 w-3" strokeWidth={2} />
                Usuń
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
