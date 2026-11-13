// „Otwórz zakładkę NARZĘDZIA w Agent Hub (dla agenta X)” z innego modułu
// (Ustawienia, szczegóły agenta). Moduły zmienia się przez startTransition,
// który przyjmuje samą ścieżkę — prośba czeka w sessionStorage, aż Agent Hub
// się zamontuje, tak jak openDocumentBus dla /documents.
const KEY = "jarvis_agent_hub_tools";

export function requestToolsTab(agentSlug: string | null = null): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, agentSlug ?? "");
  } catch {
    /* tryb prywatny — Agent Hub otworzy się na liście agentów */
  }
}

/** null = brak prośby; "" = narzędzia bez filtra; slug = narzędzia agenta. */
export function consumeToolsTab(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return v;
  } catch {
    return null;
  }
}
