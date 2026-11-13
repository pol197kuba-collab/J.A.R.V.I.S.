// Dostęp do LOKALNEJ bazy testu dymnego kluczem service role (global-setup
// i kroki testu, które zmieniają dane „spoza aplikacji”). Odmawia, gdy adres
// nie jest lokalny — produkcja nigdy nie jest dotykana.
import { E2E_EMAIL } from "./fixtures";

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Brak zmiennej ${name} (ustawia ją workflow e2e.yml).`);
  return value;
}

export function localDb(): { url: string; headers: Record<string, string> } {
  const url = env("JARVIS_SUPABASE_URL");
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    throw new Error(`Test dymny działa tylko na lokalnej bazie, a dostał ${url}.`);
  }
  const serviceKey = env("JARVIS_SUPABASE_SERVICE_ROLE_KEY");
  return {
    url,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
  };
}

export async function findTestUserId(): Promise<string | null> {
  const { url, headers } = localDb();
  const list = await fetch(`${url}/auth/v1/admin/users?per_page=100`, { headers });
  const users = ((await list.json()) as { users?: Array<{ id: string; email?: string }> }).users;
  return users?.find((u) => u.email === E2E_EMAIL)?.id ?? null;
}

/** Notatka wpisana wprost do bazy — tak, jakby zapisał ją job albo inne urządzenie. */
export async function insertNoteOutsideApp(title: string, body: string): Promise<void> {
  const { url, headers } = localDb();
  const ownerId = await findTestUserId();
  if (!ownerId) throw new Error("Brak konta testowego.");
  const res = await fetch(`${url}/rest/v1/notes`, {
    method: "POST",
    headers,
    body: JSON.stringify({ owner_id: ownerId, title, body }),
  });
  if (!res.ok) throw new Error(`Zapis notatki spoza aplikacji: ${await res.text()}`);
}
