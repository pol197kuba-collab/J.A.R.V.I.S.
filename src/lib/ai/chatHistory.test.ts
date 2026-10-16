import { describe, expect, it } from "vitest";
import { planChatImport, toConversationMessage, type StoredMessage } from "./chatHistory";

const NOW = Date.parse("2026-10-16T12:00:00Z");

const local = [
  { id: "a", role: "user" as const, text: "Cześć", time: "09:00:00" },
  { id: "b", role: "jarvis" as const, text: "Witaj", time: "09:00:02", agentName: "J.A.R.V.I.S." },
  { id: "c", role: "user" as const, text: "Pogoda?", time: "09:01:00" },
];

describe("planChatImport", () => {
  it("pusty wątek: wszystko, w kolejności, przed 'teraz'", () => {
    const rows = planChatImport(local, [], NOW);
    expect(rows.map((r) => r.content)).toEqual(["Cześć", "Witaj", "Pogoda?"]);
    const times = rows.map((r) => Date.parse(r.created_at));
    expect(times).toEqual([...times].sort((x, y) => x - y));
    expect(Math.max(...times)).toBeLessThan(NOW);
    expect(rows[1].metadata).toMatchObject({
      local_id: "b",
      local_time: "09:00:02",
      agent_name: "J.A.R.V.I.S.",
    });
  });

  it("stara historia ląduje przed najstarszą wiadomością wątku", () => {
    const existing: StoredMessage[] = [
      { id: "x", role: "user", content: "Nowe", created_at: "2026-10-16T05:50:00Z", metadata: {} },
    ];
    const rows = planChatImport(local, existing, NOW);
    for (const r of rows)
      expect(Date.parse(r.created_at)).toBeLessThan(Date.parse("2026-10-16T05:50:00Z"));
  });

  it("nie dubluje: ten sam local_id albo ta sama rola i treść", () => {
    const existing: StoredMessage[] = [
      {
        id: "1",
        role: "user",
        content: "Cześć",
        created_at: "2026-10-16T05:50:00Z",
        metadata: { local_id: "a" },
      },
      {
        id: "2",
        role: "jarvis",
        content: "Witaj ",
        created_at: "2026-10-16T05:50:01Z",
        metadata: {},
      },
    ];
    expect(planChatImport(local, existing, NOW).map((r) => r.content)).toEqual(["Pogoda?"]);
  });

  it("pomija puste i nieznane role", () => {
    const junk = [
      { id: "e", role: "user" as const, text: "   ", time: "" },
      { id: "f", role: "system" as unknown as "user", text: "x", time: "" },
    ];
    expect(planChatImport(junk, [], NOW)).toEqual([]);
  });
});

describe("toConversationMessage", () => {
  it("import zachowuje oryginalną godzinę i autora", () => {
    const m = toConversationMessage({
      id: "1",
      role: "jarvis",
      content: "Witaj",
      created_at: "2026-10-16T05:00:00Z",
      metadata: { local_time: "09:00:02", agent_name: "FRIDAY" },
    });
    expect(m).toEqual({
      id: "1",
      role: "jarvis",
      text: "Witaj",
      time: "09:00:02",
      agentName: "FRIDAY",
    });
  });

  it("zwykła wiadomość bierze godzinę z created_at, bez autora", () => {
    const m = toConversationMessage({
      id: "2",
      role: "user",
      content: "Hej",
      created_at: "2026-10-16T05:00:00Z",
      metadata: null,
    });
    expect(m.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(m.agentName).toBeUndefined();
  });
});
