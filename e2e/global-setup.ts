// Przygotowanie lokalnej bazy przed testem dymnym (etap 9).
//
// Zakłada konto testowe przez API administracyjne lokalnego Supabase
// (trigger handle_new_user dodaje mu agentów i narzędzia, tak jak każdemu
// nowemu kontu) i wpisuje mu fikcyjny klucz Gemini — model jest atrapą, ale
// aplikacja bez klucza w ogóle nie wysłałaby wiadomości do serwera.
// Działa wyłącznie na lokalnej bazie z CI (localDb odmawia innego adresu).
import { E2E_EMAIL, E2E_PASSWORD } from "./fixtures";
import { findTestUserId, localDb } from "./localDb";

export default async function globalSetup(): Promise<void> {
  const { url, headers } = localDb();

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
    const found = await findTestUserId();
    if (!found) throw new Error(`Nie udało się założyć konta testowego: ${await created.text()}`);
    userId = found;
  }

  const secrets = await fetch(`${url}/rest/v1/user_secrets?on_conflict=owner_id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ owner_id: userId, gemini_api_key: "e2e-klucz-atrapy" }),
  });
  if (!secrets.ok) throw new Error(`Zapis klucza testowego: ${await secrets.text()}`);
}
