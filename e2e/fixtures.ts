// Wspólne stałe testu dymnego (plan naprawczy, etap 9, A26).
//
// Test biegnie na LOKALNEJ bazie Supabase stawianej w CI (decyzja właściciela
// 2026-11-13) — produkcja nie jest dotykana. Model jest zamockowany na
// poziomie sieci: serwer aplikacji woła atrapę Gemini (e2e/gemini-mock.ts)
// zamiast Google, przez zmienną JARVIS_GEMINI_BASE_URL.

export const E2E_EMAIL = "e2e@jarvis.test";
export const E2E_PASSWORD = "e2e-haslo-testowe-123";

export const MOCK_PORT = 4010;
export const APP_PORT = 8080;

/** Notatka, którą atrapa modelu każe zapisać narzędziem save_note. */
export const NOTE_TITLE = "Test dymny: kupić mleko";
export const NOTE_BODY = "Notatka zapisana przez test dymny etapu 9.";

/** Odpowiedź atrapy po wykonaniu save_note — tekst widoczny w czacie. */
export const MOCK_REPLY = "Zapisałem notatkę o mleku.";

/** Wymiar embeddingów (src/lib/ai/embed.ts, kolumna vector(768)). */
export const EMBED_DIMS = 768;
