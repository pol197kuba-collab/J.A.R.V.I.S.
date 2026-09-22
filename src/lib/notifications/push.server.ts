// Wysyłka Web Push — druga, opcjonalna droga tego samego meldunku.
//
// ZASADA NADRZĘDNA: push NIGDY nie decyduje o powodzeniu meldunku. Wiersz w
// `notifications` jest zapisem kanonicznym i zapisuje się niezależnie; push
// tylko puka w urządzenie. Dlatego każda funkcja tutaj zwraca podsumowanie
// zamiast rzucać — nieudane pukanie nie może wywrócić nocnego joba ani
// zablokować kolejki dokumentów.
//
// GDZIE TO NAPRAWDĘ BIEGNIE. Meldunki ze stałych rozkazów powstają w nocnym
// jobie GitHub Actions, czyli w zwykłym Node — tam `web-push` działa wprost.
// Ta sama funkcja bywa wołana z runtime'u aplikacji (Nitro na Cloudflare),
// gdzie biblioteka opiera się o moduły Node'a dostępne tylko przez warstwę
// zgodności. Stąd import jest LENIWY i opakowany: gdyby się tam nie wczytała,
// dzwonek w aplikacji i tak zapala się normalnie, a my dostajemy wpis w logu
// zamiast wyjątku w środku zapisu.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export type PushPayload = {
  title: string;
  body: string;
  /** Dokąd zabrać użytkownika po kliknięciu w powiadomienie. */
  url?: string;
  /** Meldunki z tym samym znacznikiem zastępują się na ekranie urządzenia. */
  tag?: string;
};

export type PushResult = {
  sent: number;
  /** Subskrypcje usunięte, bo usługa push zgłosiła, że już nie istnieją. */
  pruned: number;
  failed: number;
  /** Powód, dla którego nie wysłano NIC — null, gdy próba w ogóle doszła. */
  skipped: string | null;
};

const empty = (skipped: string | null): PushResult => ({
  sent: 0,
  pruned: 0,
  failed: 0,
  skipped,
});

type Vapid = { publicKey: string; privateKey: string; subject: string };

/** Klucze VAPID właściciela; null, gdy jeszcze nie zostały wygenerowane. */
export async function loadVapidKeys(db: Db, ownerId: string): Promise<Vapid | null> {
  const { data } = await db
    .from("user_secrets")
    .select("vapid_public_key, vapid_private_key, vapid_subject")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (!data?.vapid_public_key || !data.vapid_private_key) return null;
  return {
    publicKey: data.vapid_public_key,
    privateKey: data.vapid_private_key,
    // Protokół wymaga adresu kontaktowego. Gdy nie zapisano originu
    // aplikacji, podstawiamy adres nieosobowy — nigdy poczty użytkownika.
    subject: data.vapid_subject || "https://localhost",
  };
}

/**
 * Generuje i zapisuje parę kluczy VAPID, jeśli właściciel jeszcze jej nie ma.
 *
 * Klucze są per konto, nie per instalacja aplikacji: to one uwierzytelniają
 * nadawcę wobec usługi push, a nadawcą jest tu ten konkretny J.A.R.V.I.S.
 * Zwraca sam klucz publiczny — prywatny nie ma powodu opuszczać serwera.
 */
export async function ensureVapidKeys(
  db: Db,
  ownerId: string,
  subject: string,
): Promise<string | null> {
  const existing = await loadVapidKeys(db, ownerId);
  if (existing) return existing.publicKey;

  const webpush = await loadWebPush();
  if (!webpush) return null;

  const keys = webpush.generateVAPIDKeys();
  const { error } = await db.from("user_secrets").upsert(
    {
      owner_id: ownerId,
      vapid_public_key: keys.publicKey,
      vapid_private_key: keys.privateKey,
      vapid_subject: subject,
    },
    { onConflict: "owner_id" },
  );
  if (error) return null;
  return keys.publicKey;
}

type WebPushModule = {
  generateVAPIDKeys(): { publicKey: string; privateKey: string };
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ): Promise<unknown>;
};

/** Leniwe wczytanie biblioteki — patrz nagłówek pliku. */
async function loadWebPush(): Promise<WebPushModule | null> {
  try {
    const mod = (await import("web-push")) as unknown as {
      default?: WebPushModule;
    } & WebPushModule;
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

/** Czy odpowiedź usługi push znaczy „ta subskrypcja już nie istnieje". */
const isGone = (err: unknown): boolean => {
  const status = (err as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
};

/**
 * Wysyła jeden meldunek na wszystkie urządzenia właściciela.
 *
 * Subskrypcje, które usługa push odrzuciła jako nieistniejące (404/410),
 * kasujemy od razu: to jedyny moment, w którym w ogóle się o tym dowiadujemy,
 * a martwy wiersz kosztowałby nieudaną próbę przy każdym kolejnym meldunku.
 */
export async function sendPushToOwner(
  db: Db,
  ownerId: string,
  payload: PushPayload,
): Promise<PushResult> {
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("owner_id", ownerId);

  if (!subs || subs.length === 0) return empty("no_subscriptions");

  const vapid = await loadVapidKeys(db, ownerId);
  if (!vapid) return empty("no_vapid_keys");

  const webpush = await loadWebPush();
  if (!webpush) return empty("web_push_unavailable");

  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const body = JSON.stringify(payload);

  const result: PushResult = { sent: 0, pruned: 0, failed: 0, skipped: null };
  const now = new Date().toISOString();

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      );
      result.sent += 1;
      await db.from("push_subscriptions").update({ last_success_at: now }).eq("id", sub.id);
    } catch (err) {
      if (isGone(err)) {
        await db.from("push_subscriptions").delete().eq("id", sub.id);
        result.pruned += 1;
      } else {
        result.failed += 1;
      }
    }
  }

  return result;
}
