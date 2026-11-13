// Test dymny (plan naprawczy, etap 9, A26): logowanie → czat → odpowiedź →
// notatka widoczna w /notes. Regresje z etapu 5 (#230–#232) złapał
// właściciel, nie testy — ten test przechodzi tę samą drogę co człowiek.
import { expect, test } from "@playwright/test";
import {
  E2E_EMAIL,
  E2E_PASSWORD,
  LIVE_NOTE_TITLE,
  LIVE_NOTE_WAIT_MS,
  MOCK_REPLY,
  NOTE_TITLE,
} from "./fixtures";
import { insertNoteOutsideApp } from "./localDb";

// Przy błędzie: adres i widoczny tekst do logu CI (zrzut ekranu jest
// w artefakcie, ale log czyta się szybciej).
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const text = await page
    .locator("body")
    .innerText()
    .catch(() => "(brak tekstu)");
  console.log(`[e2e] adres: ${page.url()}`);
  console.log(`[e2e] widoczny tekst:\n${text.slice(0, 2000)}`);
});

test("logowanie → czat → odpowiedź → notatka w /notes", async ({ page }) => {
  // Klasyczne wejście (bez sceny 3D) — test sprawdza przepływ, nie animację.
  await page.goto("/?loginScene=0");
  await page.getByRole("button", { name: /Engage JARVIS/i }).click();

  await page.locator('input[type="email"]').fill(E2E_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /Request Access/i }).click();

  // Po sekwencji startowej aplikacja otwiera ekran domowy trybu HUD: /jarvis
  // z konsolą czatu (MODE_HOME).
  const input = page.getByPlaceholder("wpisz komendę dla J.A.R.V.I.S.…");
  await input.waitFor({ timeout: 60_000 });
  await input.fill("Zapisz notatkę: kupić mleko");
  await input.press("Enter");

  // Odpowiedź modelu (atrapy) po wykonaniu save_note na serwerze.
  await expect(page.getByText(MOCK_REPLY)).toBeVisible({ timeout: 60_000 });

  // Do notatek wewnątrz aplikacji (przeładowanie wróciłoby do /jarvis):
  // paleta modułów Ctrl+K.
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Przejdź do modułu…").fill("Notatki");
  // Konkretna pozycja, nie pierwsza z listy — „Mózg” też pasuje do „notatki”
  // (słowa kluczowe) i bywa wyżej.
  await page.getByRole("option", { name: "Notatki", exact: true }).click();
  await expect(page).toHaveURL(/\/notes/, { timeout: 30_000 });
  await expect(page.getByText(NOTE_TITLE)).toBeVisible({ timeout: 30_000 });

  // Etap 7: notatka zapisana poza aplikacją (job, inne urządzenie) pojawia się
  // bez przeładowania — przez realtime, nie przez zapasowe odpytywanie (60 s).
  await insertNoteOutsideApp(LIVE_NOTE_TITLE, "Wpisana wprost do bazy.");
  await expect(page.getByText(LIVE_NOTE_TITLE)).toBeVisible({ timeout: LIVE_NOTE_WAIT_MS });
});
