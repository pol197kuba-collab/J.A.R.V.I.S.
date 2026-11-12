import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A8 (plan naprawczy, etap 5): czat nie ma już ścieżki przeglądarkowej.
// askJarvis zawsze idzie przez runAgent (serwer); przy awarii serwera —
// gotowe kwestie zastępcze, NIGDY bezpośrednie wywołanie Gemini z kluczem
// z przeglądarki. Stare wpisy klucza i trybu czatu znikają z localStorage.

const runAgent = vi.fn();
vi.mock("@/lib/agents/runtime.functions", () => ({
  runAgent,
  getActiveConversation: vi.fn().mockResolvedValue({ conversationId: "conv-1" }),
}));
vi.mock("@/lib/system/logClientEvent", () => ({ logClientEvent: vi.fn() }));

function fakeStorage(initial: Record<string, string>) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

let storage: ReturnType<typeof fakeStorage>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  runAgent.mockReset();
  storage = fakeStorage({
    jarvis_gemini_api_key: "AIza-stary-klucz",
    jarvis_chat_routing_server: "1",
    jarvis_server_gemini_linked: "1",
  });
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("askJarvis — tylko serwer", () => {
  it("przy starcie sprząta klucz i tryb czatu z localStorage", async () => {
    await import("./jarvisBrain");
    expect(storage.store.has("jarvis_gemini_api_key")).toBe(false);
    expect(storage.store.has("jarvis_chat_routing_server")).toBe(false);
  });

  it("idzie przez runAgent nawet bez flag w localStorage", async () => {
    storage.store.clear();
    runAgent.mockResolvedValue({ status: "done", output: "Dzień dobry.", action: "none" });
    const { askJarvis } = await import("./jarvisBrain");
    const reply = await askJarvis({ prompt: "Cześć" });
    expect(reply).toEqual({ action: "none", speech: "Dzień dobry." });
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("błąd serwera: kwestia zastępcza, bez wywołania Gemini z przeglądarki", async () => {
    runAgent.mockResolvedValue({ status: "error", output: "", error: "Brak klucza Gemini." });
    const { askJarvis } = await import("./jarvisBrain");
    const reply = await askJarvis({ prompt: "Cześć", fallbackKind: "greeting" });
    expect(reply.action).toBe("none");
    expect(reply.speech.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wyjątek (serwer nie odpowiada): kwestia zastępcza", async () => {
    runAgent.mockRejectedValue(new Error("network"));
    const { askJarvis } = await import("./jarvisBrain");
    const reply = await askJarvis({ prompt: "Cześć" });
    expect(reply.speech.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hasGeminiKey odzwierciedla klucz NA SERWERZE (flaga), nie klucz w przeglądarce", async () => {
    const { hasGeminiKey, setServerKeyLinked } = await import("./jarvisBrain");
    setServerKeyLinked(false);
    expect(hasGeminiKey()).toBe(false);
    setServerKeyLinked(true);
    expect(hasGeminiKey()).toBe(true);
    expect(storage.store.has("jarvis_gemini_api_key")).toBe(false);
  });
});
