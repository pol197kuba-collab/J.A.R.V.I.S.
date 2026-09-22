// Zakładanie i odwoływanie rozkazu — jedna implementacja dla dwóch wejść.
//
// Rozkaz można wydać na dwa sposoby: formularzem w panelu (przez server
// function z orders.functions.ts) i głosem albo czatem (przez narzędzie
// agenta z tools.server.ts). Gdyby każde z tych wejść miało własny `upsert`,
// prędzej czy później rozjechałyby się w szczegółach — jedno sprawdzałoby
// słownik przedmiotów, drugie nie; jedno odświeżałoby rozkaz o tym samym
// progu, drugie dokładałoby bliźniaka. Stąd wspólny środek: oba wejścia
// wołają te funkcje i różnią się wyłącznie tym, jak zbierają dane wejściowe.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { describeOrder, type StandingOrder, type SubjectKind } from "./rules";
import { resolveSubject } from "./subjects";

type Db = SupabaseClient<Database>;

export type StandingOrderView = StandingOrder & {
  /** Etykiety doklejane na serwerze, żeby lista nie musiała znać słowników. */
  label: string;
  unit: string;
  description: string;
  createdAt: string;
};

export type CreateOrderInput = {
  subjectKind: SubjectKind;
  subject: string;
  condition: StandingOrder["condition"];
  threshold: number;
  windowDays: number;
  cooldownHours: number;
  phrase?: string | null;
  expiresInDays?: number | null;
};

// Jeden literał, a nie sklejenie dwóch: klient Supabase wyprowadza typ
// wiersza z TREŚCI tego napisu, więc konkatenacja gubi go i zwraca
// `GenericStringError`.
export const ORDER_COLUMNS =
  "id, subject_kind, subject, condition, threshold, window_days, cooldown_hours, phrase, is_enabled, expires_at, last_triggered_at, trigger_count, created_at";

export type OrderRow = {
  id: string;
  subject_kind: string;
  subject: string;
  condition: string;
  threshold: string | number;
  window_days: number;
  cooldown_hours: number;
  phrase: string | null;
  is_enabled: boolean;
  expires_at: string | null;
  last_triggered_at: string | null;
  trigger_count: number;
  created_at: string;
};

/** Wiersz → widok gotowy dla interfejsu, razem z opisem po polsku. */
export function toView(row: OrderRow): StandingOrderView {
  const order: StandingOrder = {
    id: row.id,
    subjectKind: row.subject_kind as SubjectKind,
    subject: row.subject,
    condition: row.condition as StandingOrder["condition"],
    // NUMERIC wraca z PostgREST jako tekst — bez tego porównanie progu byłoby
    // porównaniem tekstu z liczbą.
    threshold: Number(row.threshold),
    windowDays: row.window_days,
    cooldownHours: row.cooldown_hours,
    phrase: row.phrase,
    isEnabled: row.is_enabled,
    expiresAt: row.expires_at,
    lastTriggeredAt: row.last_triggered_at,
    triggerCount: row.trigger_count,
  };
  const labels = resolveSubject(order.subjectKind, order.subject) ?? {
    label: order.subject,
    unit: "",
  };
  return {
    ...order,
    label: labels.label,
    unit: labels.unit,
    description: describeOrder(order, labels),
    createdAt: row.created_at,
  };
}

/**
 * Zakłada rozkaz albo odświeża taki sam, jeśli już istnieje.
 *
 * Rzuca, gdy przedmiot nie należy do żadnego słownika: rozkaz na coś, czego
 * system nie zaciąga, nigdy by się nie wyzwolił, a użytkownik miałby prawo
 * sądzić, że jest pilnowany. Milcząca zgoda byłaby tu gorsza od odmowy.
 */
export async function createOrder(
  db: Db,
  ownerId: string,
  input: CreateOrderInput,
): Promise<StandingOrderView> {
  const subject = resolveSubject(input.subjectKind, input.subject);
  if (!subject) {
    throw new Error(
      `Nie znam przedmiotu „${input.subject}" w module ` +
        `${input.subjectKind === "market" ? "rynkowym" : "paliwowym"}.`,
    );
  }

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
    : null;

  const { data, error } = await db
    .from("standing_orders")
    .upsert(
      {
        owner_id: ownerId,
        subject_kind: input.subjectKind,
        subject: subject.id,
        condition: input.condition,
        threshold: input.threshold,
        window_days: input.windowDays,
        cooldown_hours: input.cooldownHours,
        phrase: input.phrase ?? null,
        expires_at: expiresAt,
        is_enabled: true,
      },
      // Powtórzona komenda ma odświeżyć rozkaz, a nie dołożyć bliźniaka —
      // klucz jednoznaczności pokrywa dokładnie to, co czyni rozkaz tym samym
      // rozkazem.
      { onConflict: "owner_id,subject_kind,subject,condition,threshold,window_days" },
    )
    .select(ORDER_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return toView(data as OrderRow);
}

/** Rozkazy właściciela, najnowsze pierwsze; opcjonalnie z jednej dziedziny. */
export async function listOrders(
  db: Db,
  ownerId: string,
  subjectKind?: SubjectKind,
): Promise<StandingOrderView[]> {
  let query = db
    .from("standing_orders")
    .select(ORDER_COLUMNS)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (subjectKind) query = query.eq("subject_kind", subjectKind);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toView(row as OrderRow));
}
