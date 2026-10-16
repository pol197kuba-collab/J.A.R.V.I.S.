// Historia czatu w bazie — czyste funkcje (bez Supabase), żeby dało się je
// przetestować. Serwer (runtime.functions.ts) robi tylko odczyt i zapis.
//
// Tło: do 2026-10 panel czatu trzymał transkrypt w localStorage
// (`jarvis_chat_history`), więc incognito / inne urządzenie widziało pustą
// rozmowę. Teraz źródłem prawdy jest tabela `messages`, a lokalny transkrypt
// jest jednorazowo do niej przenoszony (importChatHistory).

/** Ile ostatnich wiadomości wątku wczytujemy do panelu. */
export const CHAT_HISTORY_LIMIT = 200;

export type LocalChatMessage = {
  id: string;
  role: "user" | "jarvis";
  text: string;
  /** "HH:MM:SS" — localStorage nie trzymał daty, tylko godzinę. */
  time: string;
  agentName?: string;
};

export type StoredMessage = {
  id: string;
  role: string;
  content: string;
  created_at: string;
  metadata: unknown;
};

export type ImportRow = {
  role: "user" | "jarvis";
  content: string;
  created_at: string;
  metadata: { source: "local-import"; local_id: string; local_time: string; agent_name?: string };
};

function meta(m: StoredMessage): Record<string, unknown> {
  return m.metadata && typeof m.metadata === "object" && !Array.isArray(m.metadata)
    ? (m.metadata as Record<string, unknown>)
    : {};
}

const dedupeKey = (role: string, text: string) => `${role}\u0000${text.trim()}`;

/**
 * Które lokalne wiadomości dopisać do wątku i z jakim `created_at`.
 *
 * - Pomija te, które już są w wątku: po `local_id` (powtórny import) albo po
 *   tej samej roli + treści (rozmowy po przepięciu na serwer są i w
 *   localStorage, i w bazie — pod różnymi id).
 * - localStorage nie zna dat, więc import ustawiamy PRZED najstarszą
 *   wiadomością wątku (co sekundę, w oryginalnej kolejności) — stara
 *   historia ląduje nad nowszą, a nie wymieszana z nią.
 */
export function planChatImport(
  local: LocalChatMessage[],
  existing: StoredMessage[],
  nowMs: number,
): ImportRow[] {
  const knownIds = new Set<string>();
  const knownContent = new Set<string>();
  let oldestMs = nowMs;
  for (const m of existing) {
    const localId = meta(m).local_id;
    if (typeof localId === "string") knownIds.add(localId);
    knownContent.add(dedupeKey(m.role, m.content));
    const t = Date.parse(m.created_at);
    if (Number.isFinite(t) && t < oldestMs) oldestMs = t;
  }

  const fresh = local.filter(
    (m) =>
      m &&
      (m.role === "user" || m.role === "jarvis") &&
      typeof m.text === "string" &&
      m.text.trim() !== "" &&
      typeof m.id === "string" &&
      !knownIds.has(m.id) &&
      !knownContent.has(dedupeKey(m.role, m.text)),
  );

  return fresh.map((m, i) => ({
    role: m.role,
    content: m.text.trim(),
    created_at: new Date(oldestMs - (fresh.length - i) * 1000).toISOString(),
    metadata: {
      source: "local-import",
      local_id: m.id,
      local_time: m.time,
      ...(m.agentName ? { agent_name: m.agentName } : {}),
    },
  }));
}

export type ConversationMessage = {
  id: string;
  role: "user" | "jarvis";
  text: string;
  time: string;
  agentName?: string;
};

/** Wiersz `messages` → wiadomość panelu. Import zachowuje oryginalną godzinę i autora. */
export function toConversationMessage(m: StoredMessage): ConversationMessage {
  const md = meta(m);
  const localTime = typeof md.local_time === "string" ? md.local_time : null;
  const agentName = typeof md.agent_name === "string" ? md.agent_name : undefined;
  return {
    id: m.id,
    role: m.role === "user" ? "user" : "jarvis",
    text: m.content,
    time: localTime ?? new Date(m.created_at).toTimeString().slice(0, 8),
    ...(agentName ? { agentName } : {}),
  };
}
