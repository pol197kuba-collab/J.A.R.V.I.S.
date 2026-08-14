// The scripted tour "Jarvis, pokaż co potrafisz" walks through. Each step
// navigates to a real route (so the viewer sees the actual, live app — not a
// mockup) and speaks a short narration line while it's on screen. Timing is
// authored per step (not derived from narration length) so pacing stays
// predictable and snappy — narration lines are written short on purpose to
// fit comfortably inside displayMs at normal TTS speaking rate.
export type ShowcaseStep = {
  id: string;
  path: string;
  /** Module name shown in the corner badge, e.g. "AGENT HUB". */
  label: string;
  /** Spoken line, shown as a caption while the step is on screen. */
  narration: string;
  /** How long the step stays on screen once revealed, in ms. */
  displayMs: number;
  /** Special full-screen flourish rendered on top of the real page. */
  flourish?: "agent-orbit";
};

export const SHOWCASE_COLD_OPEN = {
  narration:
    "Dobry wieczór, Panie Sławiński. Pozwoli Pan, że zaprezentuję pełny zakres moich możliwości.",
  durationMs: 2800,
};

export const SHOWCASE_SEQUENCE: ShowcaseStep[] = [
  {
    id: "dashboard",
    path: "/",
    label: "DASHBOARD",
    narration:
      "Oto mój główny pulpit dowodzenia — rdzeń Arc Reactor, strumień zdarzeń na żywo i bezpośredni kanał czatu.",
    displayMs: 4600,
  },
  {
    id: "jarvis",
    path: "/jarvis",
    label: "J.A.R.V.I.S. CORE",
    narration:
      "Tutaj rozmawiamy — głosem albo tekstem, w czasie rzeczywistym, z pełną pamięcią kontekstu.",
    displayMs: 4200,
  },
  {
    id: "commands",
    path: "/commands",
    label: "COMMANDS",
    narration:
      "Każde polecenie, które rozumiem, jest tu skatalogowane — wraz z poligonem do testowania nowych komend na żywo.",
    displayMs: 4600,
  },
  {
    id: "agent-hub",
    path: "/agent-hub",
    label: "AGENT HUB",
    narration: "Nie działam sam. Cały zespół wyspecjalizowanych agentów stoi do Pana dyspozycji.",
    displayMs: 5200,
    flourish: "agent-orbit",
  },
  {
    id: "sub-systems",
    path: "/sub-systems",
    label: "SUB-SYSTEMS",
    narration:
      "Monitor paliwa, kalkulator RTO, optymalizator CV — narzędzia operacyjne, wszystkie pod jednym dachem.",
    displayMs: 4600,
  },
  {
    id: "situation-room",
    path: "/situation-room",
    label: "SITUATION ROOM",
    narration:
      "Telemetria satelitarna, radar pozycji i puls wydarzeń — pełna świadomość sytuacyjna.",
    displayMs: 4400,
  },
  {
    id: "vision",
    path: "/vision",
    label: "VISION",
    narration: "Analiza obrazu na żądanie — jedno polecenie, i widzę to, co Pan widzi.",
    displayMs: 3800,
  },
  {
    id: "documents",
    path: "/documents",
    label: "DOCUMENTS",
    narration: "Archiwum dokumentów z inteligentnym wyszukiwaniem i podglądem plików.",
    displayMs: 3800,
  },
  {
    id: "settings",
    path: "/settings",
    label: "SETTINGS",
    narration: "A tutaj dostraja mnie Pan do siebie — głos, model AI i uprawnienia narzędzi.",
    displayMs: 4200,
  },
];

export const SHOWCASE_OUTRO = {
  narration: "To pełen zakres moich możliwości, Panie Sławiński. Gotowy na kolejne polecenia.",
  durationMs: 3200,
};

/** Tension-building "constructing module" transition shown before each reveal. */
export const SHOWCASE_BUILD_MS = 700;
