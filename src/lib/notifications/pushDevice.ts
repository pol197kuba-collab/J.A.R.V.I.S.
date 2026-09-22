// Strona przeglądarki Web Push: rejestracja service workera, zgoda
// użytkownika, subskrypcja i jej odwołanie.
//
// Plik NIE nazywa się `push.client.ts`, choć dotyczy wyłącznie przeglądarki:
// tę końcówkę TanStack Start traktuje jako granicę, której kod renderowany
// po stronie serwera nie może przekroczyć — a komponent ustawień jest
// renderowany i tam, i tu. Zamiast wyłączać ochronę, każda funkcja sama
// sprawdza, czy API przeglądarki w ogóle istnieje, i na serwerze zwraca
// wynik „nieobsługiwane" zamiast rzucać.
//
// Funkcje nie zakładają, że cokolwiek z tego jest dostępne. Web Push to
// obszar, w którym przeglądarki różnią się najbardziej: Safari na iOS
// udostępnia go WYŁĄCZNIE aplikacjom dodanym do ekranu początkowego, tryb
// prywatny potrafi go wyłączyć, a zgoda raz odrzucona nie da się już o nic
// zapytać. Dlatego każda ścieżka niepowodzenia ma tu własną, zrozumiałą
// nazwę — komunikat „nie udało się" nie mówi użytkownikowi, czy ma włączyć
// powiadomienia w ustawieniach systemu, czy dodać stronę do ekranu.

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: "no_service_worker" | "no_push" | "no_notifications" };

export function checkPushSupport(): PushSupport {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return { supported: false, reason: "no_service_worker" };
  }
  if (typeof window === "undefined" || !("PushManager" in window)) {
    return { supported: false, reason: "no_push" };
  }
  if (!("Notification" in window)) return { supported: false, reason: "no_notifications" };
  return { supported: true };
}

/** Klucz VAPID podróżuje jako base64url, a PushManager chce bajtów. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Klucz subskrypcji jako base64url — w takiej postaci trafia do bazy. */
function encodeKey(subscription: PushSubscription, name: "p256dh" | "auth"): string {
  const raw = subscription.getKey(name);
  if (!raw) return "";
  const bytes = new Uint8Array(raw);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type SubscribeOutcome =
  | { ok: true; endpoint: string; p256dh: string; auth: string }
  | { ok: false; reason: "unsupported" | "denied" | "no_key" | "failed"; message?: string };

/**
 * Prosi o zgodę i subskrybuje to urządzenie.
 *
 * `userVisibleOnly` jest wymuszone przez przeglądarki i jest tu na miejscu:
 * każdy push, który wysyłamy, ma widoczny odpowiednik — meldunek. Nie ma tu
 * cichej telemetrii ani niczego, co działoby się bez wiedzy użytkownika.
 */
export async function subscribeThisDevice(publicKey: string): Promise<SubscribeOutcome> {
  const support = checkPushSupport();
  if (!support.supported) return { ok: false, reason: "unsupported" };
  if (!publicKey) return { ok: false, reason: "no_key" };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    // Istniejąca subskrypcja bywa związana z INNYM kluczem VAPID (np. po
    // rotacji) — wtedy wysyłka cicho przestaje działać. Taniej ją odnowić,
    // niż szukać potem, czemu powiadomienia nie dochodzą.
    const existing = await registration.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });

    return {
      ok: true,
      endpoint: subscription.endpoint,
      p256dh: encodeKey(subscription, "p256dh"),
      auth: encodeKey(subscription, "auth"),
    };
  } catch (err) {
    return {
      ok: false,
      reason: "failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Odwołuje subskrypcję tego urządzenia; zwraca endpoint, jeśli jakiś był. */
export async function unsubscribeThisDevice(): Promise<string | null> {
  const support = checkPushSupport();
  if (!support.supported) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return null;
    const { endpoint } = subscription;
    await subscription.unsubscribe();
    return endpoint;
  } catch {
    return null;
  }
}

/** Czy TO urządzenie jest już zasubskrybowane (a nie: czy konto ma push). */
export async function currentEndpoint(): Promise<string | null> {
  const support = checkPushSupport();
  if (!support.supported) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}
