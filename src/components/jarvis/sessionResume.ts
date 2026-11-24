// Odświeżenie strony nie wychodzi z aplikacji: gdy pulpit był aktywny w tej
// karcie, po przeładowaniu (F5, pociągnięcie w dół na telefonie) wracamy
// prosto na otwartą stronę — bez ekranu powitalnego, logowania i skoku na
// stronę główną. Znacznik siedzi w sessionStorage: przeżywa przeładowanie,
// znika po zamknięciu karty / aplikacji, więc świeże uruchomienie nadal
// zaczyna się od intro. Wylogowanie i dezaktywacja go czyszczą.

const KEY = "jarvis.resume";

export function markResumable(): void {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    /* tryb prywatny / zablokowany storage — po prostu bez wznawiania */
  }
}

export function clearResumable(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* jw. */
  }
}

export function isResumable(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
