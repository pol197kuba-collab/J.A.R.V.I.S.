// Test dymny (plan naprawczy, etap 9, A26): logowanie → czat → odpowiedź →
// notatka widoczna w /notes. Regresje z etapu 5 (#230–#232) złapał
// właściciel, nie testy — ten test przechodzi tę samą drogę co człowiek.
import { expect, test } from "@playwright/test";
import { E2E_EMAIL, E2E_PASSWORD, MOCK_REPLY, NOTE_TITLE } from "./fixtures";

test("logowanie → czat → odpowiedź → notatka w /notes", async ({ page }) => {
  // Klasyczne wejście (bez sceny 3D) — test sprawdza przepływ, nie animację.
  await page.goto("/?loginScene=0");
  await page.getByRole("button", { name: /Engage JARVIS/i }).click();

  await page.locator('input[type="email"]').fill(E2E_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /Request Access/i }).click();

  // Po sekwencji startowej pulpit: przycisk „Otwórz czat” prowadzi do /jarvis.
  await page.getByRole("button", { name: "Otwórz czat" }).click({ timeout: 60_000 });

  const input = page.getByPlaceholder("wpisz komendę dla J.A.R.V.I.S.…");
  await input.fill("Zapisz notatkę: kupić mleko");
  await input.press("Enter");

  // Odpowiedź modelu (atrapy) po wykonaniu save_note na serwerze.
  await expect(page.getByText(MOCK_REPLY)).toBeVisible({ timeout: 60_000 });

  // Powrót na pulpit bez przeładowania i przejście do notatek.
  await page.goBack();
  await page.getByRole("button", { name: "Notatki" }).first().click();
  await expect(page.getByText(NOTE_TITLE)).toBeVisible({ timeout: 30_000 });
});
