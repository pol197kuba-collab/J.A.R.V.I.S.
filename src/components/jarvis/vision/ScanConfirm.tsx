// Vision AR (S4.1) — confirmation before saving. The model's reading is a
// draft: every field is editable, the receipt's items fold out, and the
// strict schema runs before anything is written.

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { HudPanel } from "../HudPanel";
import {
  CATEGORY_LABEL,
  EXPENSE_CATEGORIES,
  PHOTO_RETENTION_DAYS,
  SCAN_MODES,
  countEdits,
  parseAmount,
  receiptWarnings,
  type ScanData,
  type ScanDraft,
  type StructuredMode,
} from "@/lib/vision/modes";
import {
  checkForm,
  formOf,
  moneyText,
  newItemKey,
  type ReceiptItemForm,
  type ScanForm,
} from "@/lib/vision/form";

export type ConfirmedScan = {
  mode: StructuredMode;
  data: ScanData[StructuredMode];
  editedFields: number;
  keepPhoto: boolean;
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const inputCls =
  "w-full min-w-0 border border-primary/30 bg-background/60 px-2 py-1.5 font-mono text-[12px] text-foreground outline-none transition focus:border-primary/70 @max-[380px]:text-[11px]";
const labelCls = "font-display text-[9px] uppercase tracking-[0.25em] text-primary/70";

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

export function ScanConfirm({
  draft,
  photoUrl,
  truncated,
  saving,
  onSave,
  onRetake,
  onCancel,
}: {
  draft: ScanDraft;
  photoUrl: string | null;
  truncated: boolean;
  saving: boolean;
  onSave: (scan: ConfirmedScan) => void;
  onRetake: () => void;
  onCancel: () => void;
}) {
  const original = useMemo(() => formOf(draft), [draft]);
  const [form, setForm] = useState<ScanForm>(original);
  const [errors, setErrors] = useState<string[]>([]);
  const [keepPhoto, setKeepPhoto] = useState(true);
  const modeLabel = SCAN_MODES.find((m) => m.id === draft.mode)?.label ?? draft.mode;

  const patch = (p: Partial<ScanForm>) => setForm((f) => ({ ...f, ...p }) as ScanForm);

  const save = () => {
    const checked = checkForm(form);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors([]);
    const before = checkForm(original);
    onSave({
      mode: checked.mode,
      data: checked.data,
      editedFields: countEdits(before.ok ? before.data : null, checked.data),
      keepPhoto: keepPhoto && photoUrl !== null,
    });
  };

  return (
    <HudPanel
      index={1}
      showTag={false}
      title={`POTWIERDŹ // ${modeLabel.toUpperCase()}`}
      wrapperClassName="flex min-h-0 flex-1 flex-col"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      rightSlot={
        <button
          type="button"
          onClick={onCancel}
          aria-label="Odrzuć skan"
          className="grid h-6 w-6 place-items-center border border-primary/50 text-primary transition hover:bg-primary/15"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      }
    >
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 @max-[380px]:p-2">
        <div className="flex min-w-0 gap-3 @max-[380px]:gap-2">
          {photoUrl && (
            <img
              src={photoUrl}
              alt="Zeskanowane zdjęcie"
              className="h-24 w-16 shrink-0 border border-primary/40 object-cover @max-[380px]:h-20 @max-[380px]:w-14"
            />
          )}
          <p className="min-w-0 font-mono text-[11px] leading-snug text-muted-foreground">
            Sprawdź odczyt i popraw, co trzeba. Nic nie zapisze się bez Twojego „Zapisz”.
          </p>
        </div>

        {truncated && (
          <Notice>
            Zdjęcie miało więcej tekstu, niż zmieściło się w odczycie — sprawdź końcówkę.
          </Notice>
        )}

        <div className="mt-3 flex min-w-0 flex-col gap-3">
          {form.mode === "receipt" && <ReceiptFields form={form} patch={patch} />}
          {form.mode === "odometer" && (
            <div className="grid min-w-0 grid-cols-2 gap-2 @max-[340px]:grid-cols-1">
              <Field label="Przebieg (km)">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={form.km}
                  onChange={(e) => patch({ km: e.target.value })}
                />
              </Field>
              <Field label="Zatankowane litry">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="—"
                  value={form.liters}
                  onChange={(e) => patch({ liters: e.target.value })}
                />
              </Field>
              <Field label="Zapłacono (zł)" className="col-span-full">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="— bez kwoty policzę szacunek z cennika Orlenu"
                  value={form.amount}
                  onChange={(e) => patch({ amount: e.target.value })}
                />
              </Field>
              <Field label="Uwaga" className="col-span-full">
                <input
                  className={inputCls}
                  value={form.note}
                  onChange={(e) => patch({ note: e.target.value })}
                />
              </Field>
            </div>
          )}
          {form.mode === "document" && (
            <>
              <div className="grid min-w-0 grid-cols-[2fr_1fr] gap-2 @max-[380px]:grid-cols-1">
                <Field label="Tytuł">
                  <input
                    className={inputCls}
                    value={form.title}
                    onChange={(e) => patch({ title: e.target.value })}
                  />
                </Field>
                <Field label="Rodzaj">
                  <input
                    className={inputCls}
                    value={form.docType}
                    onChange={(e) => patch({ docType: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Streszczenie">
                <textarea
                  rows={3}
                  className={`${inputCls} no-scrollbar resize-y`}
                  value={form.summary}
                  onChange={(e) => patch({ summary: e.target.value })}
                />
              </Field>
              <Fold title={`Pełny tekst · ${form.text.length} znaków`}>
                <textarea
                  rows={10}
                  className={`${inputCls} no-scrollbar resize-y`}
                  value={form.text}
                  onChange={(e) => patch({ text: e.target.value })}
                />
              </Fold>
            </>
          )}
          {form.mode === "fridge" && (
            <>
              <Field label="Produkty (jeden w linii)">
                <textarea
                  rows={5}
                  className={`${inputCls} no-scrollbar resize-y`}
                  value={form.products}
                  onChange={(e) => patch({ products: e.target.value })}
                />
              </Field>
              <Field label="Przepis">
                <input
                  className={inputCls}
                  placeholder="Bez przepisu"
                  value={form.recipeTitle}
                  onChange={(e) => patch({ recipeTitle: e.target.value })}
                />
              </Field>
              <Field label="Kroki (jeden w linii)">
                <textarea
                  rows={5}
                  className={`${inputCls} no-scrollbar resize-y`}
                  value={form.recipeSteps}
                  onChange={(e) => patch({ recipeSteps: e.target.value })}
                />
              </Field>
            </>
          )}
        </div>

        {errors.length > 0 && (
          <div className="mt-3 border border-destructive/50 bg-destructive/10 px-2 py-1.5">
            {errors.map((e) => (
              <p key={e} className="font-mono text-[11px] leading-snug text-destructive">
                {e}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-w-0 shrink-0 flex-col gap-2 border-t border-primary/25 p-3 @max-[380px]:p-2">
        {photoUrl && (
          <label className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={keepPhoto}
              onChange={(e) => setKeepPhoto(e.target.checked)}
              className="accent-primary"
            />
            <span className="min-w-0">Zachowaj zdjęcie przez {PHOTO_RETENTION_DAYS} dni</span>
          </label>
        )}
        <div className="flex min-w-0 gap-2">
          <ActionButton onClick={onRetake} disabled={saving}>
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
            PONÓW
          </ActionButton>
          <ActionButton onClick={save} disabled={saving} primary>
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
            {saving ? "ZAPISUJĘ…" : "ZAPISZ"}
          </ActionButton>
        </div>
      </div>
    </HudPanel>
  );
}

function ReceiptFields({
  form,
  patch,
}: {
  form: Extract<ScanForm, { mode: "receipt" }>;
  patch: (p: Partial<ScanForm>) => void;
}) {
  const [open, setOpen] = useState(false);
  const setItem = (key: string, p: Partial<ReceiptItemForm>) =>
    patch({ items: form.items.map((i) => (i.key === key ? { ...i, ...p } : i)) });

  // live warnings off the current strings (sum check, missing date…)
  const warnings = receiptWarnings(
    {
      merchant: form.merchant.trim(),
      date: form.date,
      total: parseAmount(form.total),
      currency: form.currency,
      items: form.items.map((i) => ({
        name: i.name,
        qty: parseAmount(i.qty, 3) ?? 1,
        price: parseAmount(i.price) ?? 0,
        category: i.category,
      })),
    },
    today(),
  );
  const sum = form.items.reduce((s, i) => s + (parseAmount(i.price) ?? 0), 0);

  return (
    <>
      <div className="grid min-w-0 grid-cols-2 gap-2 @max-[340px]:grid-cols-1">
        <Field label="Sklep" className="col-span-full">
          <input
            className={inputCls}
            value={form.merchant}
            onChange={(e) => patch({ merchant: e.target.value })}
          />
        </Field>
        <Field label="Data">
          <input
            type="date"
            className={inputCls}
            value={form.date}
            onChange={(e) => patch({ date: e.target.value })}
          />
        </Field>
        <div className="grid min-w-0 grid-cols-[1fr_4rem] gap-2">
          <Field label="Suma">
            <input
              className={inputCls}
              inputMode="decimal"
              value={form.total}
              onChange={(e) => patch({ total: e.target.value })}
            />
          </Field>
          <Field label="Waluta">
            <input
              className={inputCls}
              maxLength={3}
              value={form.currency}
              onChange={(e) => patch({ currency: e.target.value.toUpperCase() })}
            />
          </Field>
        </div>
      </div>

      {warnings.map((w) => (
        <Notice key={w}>{w}</Notice>
      ))}

      <div className="min-w-0 border border-primary/25">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full min-w-0 items-center justify-between gap-2 px-2 py-2 text-left transition hover:bg-primary/10"
        >
          <span className={labelCls}>
            Pozycje ({form.items.length}) · {moneyText(Math.round(sum * 100) / 100)}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-primary transition ${open ? "rotate-180" : ""}`}
            strokeWidth={1.75}
          />
        </button>
        {open && (
          <div className="flex min-w-0 flex-col gap-2 border-t border-primary/20 p-2">
            {form.items.map((it, idx) => (
              <div
                key={it.key}
                className="grid min-w-0 grid-cols-[1fr_3.5rem_5rem_auto] items-end gap-1.5 border-b border-primary/10 pb-2 last:border-b-0 @max-[420px]:grid-cols-[1fr_3rem_4.5rem_auto]"
              >
                <Field label={`#${idx + 1} nazwa`} className="col-span-full">
                  <input
                    className={inputCls}
                    value={it.name}
                    onChange={(e) => setItem(it.key, { name: e.target.value })}
                  />
                </Field>
                <select
                  aria-label="Kategoria"
                  className={inputCls}
                  value={it.category}
                  onChange={(e) =>
                    setItem(it.key, { category: e.target.value as ReceiptItemForm["category"] })
                  }
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Ilość"
                  className={inputCls}
                  inputMode="decimal"
                  value={it.qty}
                  onChange={(e) => setItem(it.key, { qty: e.target.value })}
                />
                <input
                  aria-label="Kwota"
                  className={inputCls}
                  inputMode="decimal"
                  value={it.price}
                  onChange={(e) => setItem(it.key, { price: e.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Usuń pozycję ${idx + 1}`}
                  onClick={() => patch({ items: form.items.filter((i) => i.key !== it.key) })}
                  className="grid h-[30px] w-[30px] place-items-center border border-destructive/40 text-destructive transition hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                patch({
                  items: [
                    ...form.items,
                    { key: newItemKey(), name: "", qty: "1", price: "", category: "inne" },
                  ],
                })
              }
              className="flex items-center justify-center gap-1.5 border border-dashed border-primary/40 py-1.5 font-display text-[9px] uppercase tracking-[0.25em] text-primary transition hover:bg-primary/10"
            >
              <Plus className="h-3 w-3" strokeWidth={2} />
              Dodaj pozycję
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 border border-primary/25">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center justify-between gap-2 px-2 py-2 text-left transition hover:bg-primary/10"
      >
        <span className={labelCls}>{title}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-primary transition ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {open && <div className="border-t border-primary/20 p-2">{children}</div>}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 flex min-w-0 items-start gap-1.5 border border-warning/40 bg-warning/10 px-2 py-1.5">
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={1.75} />
      <p className="min-w-0 break-words font-mono text-[11px] leading-snug text-warning">
        {children}
      </p>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-display flex min-w-0 flex-1 items-center justify-center gap-2 border px-3 py-2 text-[10px] uppercase tracking-[0.3em] text-primary transition disabled:cursor-not-allowed disabled:opacity-40 @max-[340px]:tracking-[0.15em]"
      style={{
        borderColor: `color-mix(in oklab, var(--primary) ${primary ? 65 : 45}%, transparent)`,
        backgroundColor: `color-mix(in oklab, var(--primary) ${primary ? 12 : 5}%, transparent)`,
        boxShadow: primary ? "var(--glow-primary)" : undefined,
      }}
    >
      {children}
    </button>
  );
}
