// Odwieszanie agentów, którzy zostali oznaczeni jako zajęci i nikt ich nie
// zwolnił.
//
// AWARIA. Kafel „ACTIVE TASK · PROGRESS: 10% · TIME: 558m" nad I.N.S.I.G.H.T.
// dziewięć godzin po tym, jak zadanie realnie umarło. Agent nie pracował —
// tak wyglądał WIERSZ, którego nikt nie posprzątał.
//
// MECHANIZM, DOKŁADNIE TEN SAM CO PRZY ZADANIACH DOKUMENTOWYCH, TYLKO INNA
// TABELA. `runOrchestrator` na starcie ustawia `agents.status = 'busy'`,
// a zeruje to w ścieżce sukcesu albo w `catch`. Obie leżą WEWNĄTRZ tego
// samego wywołania serwera. Gdy przeglądarka zostanie uśpiona, wywołanie
// ginie w połowie — i nie wykonuje się ani jedna, ani druga. Wiersz zostaje
// „zajęty" na zawsze.
//
// To jest luka w poprzedniej naprawie i trzeba to powiedzieć wprost:
// tamta pilnowała `document_jobs`, a widżet 3D czyta `agents` i
// `agent_runs`. Zadanie było już zamknięte, a matryca dalej świeciła.
//
// Plik jest czysty — sama reguła, bez bazy.

/**
 * Po jakim czasie „zajęty" przestaje być wiarygodny.
 *
 * Najdłuższy uczciwy przebieg to potok dokumentowy: research, budowa pliku,
 * bramka jakości i jedna poprawka. Dwadzieścia minut daje mu zapas i nadal
 * jest o rząd wielkości mniej niż dziewięć godzin z ekranu.
 */
export const AGENT_STALE_AFTER_MS = 20 * 60_000;

export type AgentSnapshot = {
  status: string;
  /** Od kiedy agent jest zajęty; null, gdy nie jest. */
  busySince: string | null;
};

/**
 * Czy agent wisi — czyli jest opisany jako zajęty, a nikt go nie zwolnił.
 *
 * `busySince` ma tu rolę pulsu: bez niego nie da się odróżnić agenta, który
 * pracuje od minuty, od tego, który „pracuje" od wczoraj. Brak znacznika
 * przy statusie „busy" traktujemy jako wiszenie — wiersz jest wtedy
 * niespójny sam ze sobą i nic go już nie posprząta.
 */
export function isWedged(agent: AgentSnapshot, now: Date = new Date()): boolean {
  if (agent.status !== "busy") return false;
  if (!agent.busySince) return true;

  const age = now.getTime() - Date.parse(agent.busySince);
  if (!Number.isFinite(age)) return true;
  return age >= AGENT_STALE_AFTER_MS;
}

/** Powód wpisywany do przerwanego przebiegu — ma tłumaczyć, nie tylko znaczyć. */
export function wedgedRunReason(): string {
  return (
    "Przebieg przerwany bez zakończenia — najczęstsza przyczyna to zamknięcie " +
    "lub uśpienie aplikacji w trakcie pracy agenta. Status odwieszony automatycznie."
  );
}
