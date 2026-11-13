// Przygotowanie lokalnej bazy przed testem dymnym (etap 9).
//
// Zakłada konto testowe przez API administracyjne lokalnego Supabase
// (trigger handle_new_user dodaje mu agentów i narzędzia, tak jak każdemu
// nowemu kontu) i wpisuje mu fikcyjny klucz Gemini — model jest atrapą, ale
// aplikacja bez klucza w ogóle nie wysłałaby wiadomości do serwera.
// Działa wyłącznie na lokalnej bazie z CI: odmawia, gdy adres nie jest lokalny.
import { E2E_EMAIL, E2E_PASSWORD } from "./fixtures";

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Brak zmiennej ${name} (ustawia ją workflow e2e.yml).`);
  return value;
}

export default async function globalSetup(): Promise<void> {
  const url = env("JARVIS_SUPABASE_URL");
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    throw new Error(`Test dymny działa tylko na lokalnej bazie, a dostał ${url}.`);
  }
  const serviceKey = env("JARVIS_SUPABASE_SERVICE_ROLE_KEY");
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  const created = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD, email_confirm: true }),
  });
  let userId: string;
  if (created.ok) {
    userId = ((await created.json()) as { id: string }).id;
  } else {
    // Konto już jest (powtórzony przebieg na tej samej bazie) — szukamy go.
    const list = await fetch(`${url}/auth/v1/admin/users?per_page=100`, { headers });
    const users = ((await list.json()) as { users?: Array<{ id: string; email?: string }> }).users;
    const found = users?.find((u) => u.email === E2E_EMAIL);
    if (!found) throw new Error(`Nie udało się założyć konta testowego: ${await created.text()}`);
    userId = found.id;
  }

  const secrets = await fetch(`${url}/rest/v1/user_secrets?on_conflict=owner_id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ owner_id: userId, gemini_api_key: "e2e-klucz-atrapy" }),
  });
  if (!secrets.ok) throw new Error(`Zapis klucza testowego: ${await secrets.text()}`);
}
