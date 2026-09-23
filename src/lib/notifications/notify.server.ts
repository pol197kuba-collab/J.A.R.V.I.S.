// Jedno miejsce, przez które system odzywa się do właściciela.
//
// Do tej pory każdy, kto chciał coś zameldować, robił własny
// `db.from("notifications").insert(...)` — job paliwowy, kolejka dokumentów,
// a za chwilę stałe rozkazy. Dopóki meldunek był tylko wierszem w bazie,
// dało się z tym żyć. Od momentu, w którym meldunek ma też trafić na telefon,
// rozsypane wstawki znaczyłyby tyle, że jeden nadawca wysyła push, a drugi po
// cichu nie — i nikt by tego nie zauważył, bo dzwonek w aplikacji świeciłby
// tak samo. Stąd ta funkcja: wołający mówi CO zameldować, a nie JAK.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { sendPushToOwner, type PushResult } from "./push.server";

type Db = SupabaseClient<Database>;

export type NotifyInput = {
  /** Rodzaj meldunku: 'standing_order' | 'fuel_alert' | 'document_ready' … */
  kind: string;
  title: string;
  body?: string | null;
  payload?: Json;
  /** Dokąd zabrać użytkownika po kliknięciu w powiadomienie na telefonie. */
  url?: string;
  /** Znacznik zastępowania na ekranie urządzenia; domyślnie rodzaj meldunku. */
  tag?: string;
  /**
   * Meldunek cichy: wiersz powstaje normalnie i zapala dzwonek w aplikacji,
   * ale urządzenia nie dostają powiadomienia.
   *
   * Zapis zostaje ZAWSZE, bo to on jest zapisem kanonicznym — „cicho" znaczy
   * „nie budź telefonu", a nie „nie mów wcale".
   */
  silent?: boolean;
};

export type NotifyResult = {
  /** Identyfikator zapisanego wiersza; null, gdy zapis się nie powiódł. */
  id: string | null;
  error: string | null;
  /** Co się stało z powiadomieniem na urządzenia; null, gdy nie próbowano. */
  push?: PushResult | null;
};

/**
 * Zapisuje meldunek dla właściciela.
 *
 * Zwraca wynik, zamiast rzucać: wołającymi są nocne joby, w których jeden
 * nieudany meldunek nie może przerwać przetwarzania pozostałych. Wołający
 * decyduje, czy błąd jest dla niego awarią.
 */
export async function notifyOwner(
  db: Db,
  ownerId: string,
  input: NotifyInput,
): Promise<NotifyResult> {
  const { data, error } = await db
    .from("notifications")
    .insert({
      owner_id: ownerId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      payload: input.payload ?? ({} as Json),
    })
    .select("id")
    .single();

  if (error) return { id: null, error: error.message };

  // Push jest DRUGĄ drogą tego samego meldunku, nie warunkiem jego istnienia.
  // Wiersz wyżej jest zapisem kanonicznym — dzwonek w aplikacji zapali się i
  // wtedy, gdy urządzenie nie odbierze powiadomienia albo gdy użytkownik nie
  // włączył ich wcale. Dlatego nieudane pukanie nie zmienia wyniku.
  // Cichy meldunek kończy się tutaj: wiersz jest, telefon zostaje w spokoju.
  if (input.silent) return { id: data.id, error: null, push: null };

  let push: PushResult | null = null;
  try {
    push = await sendPushToOwner(db, ownerId, {
      title: input.title,
      body: input.body ?? "",
      url: input.url,
      // Meldunki tego samego rodzaju zastępują się na ekranie urządzenia,
      // zamiast budować stos powiadomień mówiących to samo.
      tag: input.tag ?? input.kind,
    });
  } catch {
    // Celowo bez żadnej reakcji: patrz akapit wyżej.
  }

  return { id: data.id, error: null, push };
}
