import { describe, it, expect, vi, afterEach } from "vitest";
import { runOrchestrator } from "./runtime.server";
import { getToolByName } from "./tools.server";
import { AGENT_SLUGS } from "@/lib/constants/agentSlugs";
import {
  HERALD,
  KEYS_GEMINI_ONLY,
  finalRunRow,
  geminiBodies,
  geminiCall,
  geminiText,
  loggedMessages,
  providerFetch,
  worldDb,
} from "./runtime.testkit";

// Bramka narzędzi (plan naprawczy, etap 1).
//
// A1: pętla wykonuje wyłącznie narzędzie zadeklarowane modelowi w tej turze.
// Wyłączenie narzędzia w Ustawieniach usuwa je z deklaracji, ale model może
// je i tak „wywołać” (zgadując nazwę z promptu albo pod wpływem treści ze
// strony) — do tej pory wykonywało się wtedy normalnie.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Odpowiedź narzędzia, którą dostał model w turze nr `turn` (od 0). */
function functionResponses(bodies: Record<string, unknown>[], turn: number) {
  const contents = bodies[turn].contents as Array<{ role: string; parts: unknown[] }>;
  return contents
    .filter((c) => c.role === "function")
    .flatMap((c) => c.parts as Array<{ functionResponse: { name: string; response: unknown } }>)
    .map((p) => p.functionResponse);
}

describe("A1 — tylko zadeklarowane narzędzia", () => {
  it("wywołanie wyłączonego narzędzia nie uruchamia execute, model dostaje tool_not_enabled", async () => {
    const execute = vi.spyOn(getToolByName("delete_note")!, "execute");
    const fetchMock = providerFetch({
      gemini: [geminiCall("delete_note", { id: "n1" }), geminiText("Nie mogę usunąć notatki.")],
    });
    vi.stubGlobal("fetch", fetchMock);
    // Herald nie ma w bazie żadnego narzędzia — delete_note nie jest zadeklarowane.
    const { db, calls } = worldDb({ agents: [HERALD], secrets: KEYS_GEMINI_ONLY });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "Usuń notatkę n1",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.status).toBe("done");
    expect(result.output).toBe("Nie mogę usunąć notatki.");

    const [response] = functionResponses(geminiBodies(fetchMock), 1);
    expect(response).toEqual({
      name: "delete_note",
      response: { error: "tool_not_enabled", tool: "delete_note" },
    });
    expect(loggedMessages(calls)).toContain("narzędzie spoza deklaracji: delete_note");
    // Próba zostaje na liście wywołań (widać ją w drzewie przebiegu).
    const row = finalRunRow(calls, "run-1")!;
    expect((row.output as { tool_calls: Array<{ name: string }> }).tool_calls[0].name).toBe(
      "delete_note",
    );
  });

  it("run delegowany nie steruje interfejsem, nawet gdy model wywoła perform_ui_action", async () => {
    const fetchMock = providerFetch({
      gemini: [geminiCall("perform_ui_action", { action: "open_tasks" }), geminiText("Gotowe.")],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db } = worldDb({ agents: [HERALD], secrets: KEYS_GEMINI_ONLY });

    const result = await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "pokaż zadania",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    expect(result.action).toBeUndefined();
    const [response] = functionResponses(geminiBodies(fetchMock), 1);
    expect(response.response).toEqual({ error: "tool_not_enabled", tool: "perform_ui_action" });
  });

  it("zadeklarowane narzędzie wykonuje się jak dotąd", async () => {
    const fetchMock = providerFetch({
      gemini: [geminiCall("list_notes", {}), geminiText("Brak notatek.")],
    });
    vi.stubGlobal("fetch", fetchMock);
    const execute = vi.spyOn(getToolByName("list_notes")!, "execute");
    const { db } = worldDb({
      agents: [HERALD],
      secrets: KEYS_GEMINI_ONLY,
      toolSlugs: ["list_notes"],
    });

    await runOrchestrator({
      supabase: db,
      userId: "u1",
      agentSlug: AGENT_SLUGS.HERALD,
      input: "notatki?",
      history: [],
      delegationDepth: 1,
      parentRunId: "run-parent",
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });
});
