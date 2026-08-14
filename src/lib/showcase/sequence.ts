// The scripted tour "Jarvis, pokaż co potrafisz" walks through. Each step
// navigates to a real route (so the viewer sees the actual, live app — not a
// mockup) and speaks a short narration line while it's on screen. How long a
// step stays on screen is NOT authored here — ShowcaseContext measures each
// narration line via estimateNarrationMs() (timing.ts) and paces the visuals
// to match, instead of a hand-guessed fixed duration.
export type ShowcaseStep = {
  id: string;
  path: string;
  /** Module name shown in the corner badge, e.g. "AGENT HUB". */
  label: string;
  /** Spoken line, shown as a caption while the step is on screen. */
  narration: string;
  /** Special full-screen flourish rendered on top of the real page, or a
   *  side effect fired the moment the step is revealed. */
  flourish?: "agent-orbit" | "agent-matrix-demo";
};

export const SHOWCASE_COLD_OPEN = {
  narration:
    "Dobry wieczór, Panie Sławiński. Pozwoli Pan, że zaprezentuję pełny zakres moich możliwości.",
};

// Opens on the J.A.R.V.I.S. core panel — now the primary command center (the
// Dashboard module is being retired/repurposed, so it's deliberately absent
// from this tour; the "main command deck" narration lives here instead).
export const SHOWCASE_SEQUENCE: ShowcaseStep[] = [
  {
    id: "jarvis",
    path: "/jarvis",
    label: "J.A.R.V.I.S. CORE",
    narration:
      "To mój główny panel dowodzenia, Panie Sławiński — rdzeń Arc Reactor, strumień zdarzeń na żywo i rozmowa ze mną, głosem albo tekstem, z pełną pamięcią kontekstu. Niech Pan patrzy na Agent Matrix — zaraz deleguję zadania do zespołu na żywo.",
    flourish: "agent-matrix-demo",
  },
  {
    id: "commands",
    path: "/commands",
    label: "COMMANDS",
    narration:
      "Każde polecenie, które rozumiem, jest tu skatalogowane — wraz z poligonem do testowania nowych komend na żywo.",
  },
  {
    id: "agent-hub",
    path: "/agent-hub",
    label: "AGENT HUB",
    narration: "Nie działam sam. Cały zespół wyspecjalizowanych agentów stoi do Pana dyspozycji.",
    flourish: "agent-orbit",
  },
  {
    id: "sub-systems",
    path: "/sub-systems",
    label: "SUB-SYSTEMS",
    narration:
      "Monitor paliwa, kalkulator RTO, optymalizator CV — narzędzia operacyjne, wszystkie pod jednym dachem.",
  },
  {
    id: "situation-room",
    path: "/situation-room",
    label: "SITUATION ROOM",
    narration:
      "Telemetria satelitarna, radar pozycji i puls wydarzeń — pełna świadomość sytuacyjna.",
  },
  {
    id: "vision",
    path: "/vision",
    label: "VISION",
    narration: "Analiza obrazu na żądanie — jedno polecenie, i widzę to, co Pan widzi.",
  },
  {
    id: "documents",
    path: "/documents",
    label: "DOCUMENTS",
    narration:
      "Archiwum dokumentów. Insight wyszuka informacje, Forge wygeneruje z nich prezentację, PDF czy dokument Word, a Metric przeanalizuje treść tego, co Pan tu prześle.",
  },
  {
    id: "schema",
    path: "/schema",
    label: "SCHEMA",
    narration:
      "Eksplorator schematu — pełna topologia bazy danych: tabele, kolumny, relacje i reguły dostępu, w jednym miejscu.",
  },
  {
    id: "system-logs",
    path: "/system-logs",
    label: "SYSTEM LOGS",
    narration:
      "Każde zdarzenie systemowe trafia do tego dziennika. Agent Strażnik może go przeanalizować i zdać raport, co ostatnio szwankowało.",
  },
  {
    id: "settings",
    path: "/settings",
    label: "SETTINGS",
    narration: "A tutaj dostraja mnie Pan do siebie — głos, model AI i uprawnienia narzędzi.",
  },
];

export const SHOWCASE_OUTRO = {
  narration: "To pełen zakres moich możliwości, Panie Sławiński. Gotowy na kolejne polecenia.",
};

/** Tension-building "constructing module" transition shown before each reveal. */
export const SHOWCASE_BUILD_MS = 700;
