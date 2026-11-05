// Every name and sentence below comes from the J.A.R.V.I.S. repo:
// agent identity migration, system prompts, modules.ts and route descriptions.
export const AGENTS = [
  { slug: 'shield', name: 'S.H.I.E.L.D.', role: 'Security & Compliance', text: 'Monitoruje kondycję systemu: skanuje logi, wyłapuje błędy i nieudane uruchomienia agentów.' },
  { slug: 'herald', name: 'H.E.R.A.L.D.', role: 'Strategy & Content', text: 'Pisze hasła, posty i treści kampanii. Ton i długość dopasowuje do zadania.' },
  { slug: 'insight', name: 'I.N.S.I.G.H.T.', role: 'Deep Research', text: 'Robi głęboki research i wraca z materiałem, na którym reszta zespołu może pracować.' },
  { slug: 'metric', name: 'M.E.T.R.I.C.', role: 'Performance Insights', text: 'Analizuje Twoje dokumenty i przeszukuje je semantycznie, zamiast zgadywać.' },
  { slug: 'forge', name: 'F.O.R.G.E.', role: 'Content Creation / Execution', text: 'Kompiluje treść do gotowych plików: prezentacji, dokumentów Word i PDF.' },
];

export const MODULES = [
  ['Dashboard', 'Poranny briefing, budżet i zadania'],
  ['Feed', 'Dziennik tego, co zrobił zespół'],
  ['Mózg', 'Mapa wiedzy 3D i mapa bazy danych'],
  ['Agent Town', 'Pixel-artowe biuro na żywych danych'],
  ['Wydatki', 'Paragony zeskanowane w Vision'],
  ['Paliwa', 'Hurtowe ceny Orlenu od 2004 roku'],
  ['Rynki', 'Wykresy instrumentów i paper fund'],
  ['Vision', 'Kamera z nakładką HUD i skanerem'],
  ['Zadania', 'Kolejka, którą prowadzą agenci'],
  ['Notatki', 'Archiwum Twoje i J.A.R.V.I.S.-a'],
  ['Dokumenty', 'Baza pod wyszukiwanie M.E.T.R.I.C.-a'],
  ['Situation Room', 'Centrum dowodzenia zespołem'],
];
