// Mózg 3D — dane demonstracyjne (workflow „Brain Demo” → scripts/brain-demo.ts).
//
// Po przeprowadzce na własną bazę notatki i wspomnienia były puste, więc
// galaktyka nie miała z czego powstać. Te dane ją zapełniają „dla efektu”.
//
// ZASADY, bo wspomnienia to pamięć, z której J.A.R.V.I.S. korzysta w
// prawdziwych rozmowach:
// - NOTATKI to wiedza i pomysły na tematy właściciela (projekt, rynki,
//   paliwa, Excel/VBA, praca PO, analiza danych, opieka nad spanielem) —
//   żadnych zmyślonych zdarzeń z jego życia;
// - WSPOMNIENIA tylko z faktów, które właściciel sam podał (rola, VBA,
//   Marvel, sposób pracy) — nic, co J.A.R.V.I.S. powtarzałby jako prawdę,
//   a co nią nie jest;
// - wszystko z tagiem DEMO_TAG — `remove` usuwa dokładnie te wiersze.

export const DEMO_TAG = "demo-mozg";
/** Na ile dni wstecz rozłożyć daty demo — inaczej suwak czasu nie ma czego pokazać. */
export const DEMO_SPREAD_DAYS = 90;
export const DEMO_SOURCE = "demo";

export type DemoNote = { title: string; body: string; tags: string[] };
/**
 * Data „powstania” i-tej pozycji demo: rozłożone równo na ostatnie
 * DEMO_SPREAD_DAYS dni, od najstarszej, z godziną zależną od indeksu —
 * deterministycznie, żeby powtórny seed dał tę samą oś czasu.
 */
export function demoCreatedAt(i: number, total: number, now: Date = new Date()): string {
  const day = 86_400_000;
  const fraction = total <= 1 ? 1 : i / (total - 1);
  const daysAgo = Math.round((1 - fraction) * DEMO_SPREAD_DAYS);
  const hour = 8 + ((i * 7) % 13);
  const d = new Date(now.getTime() - daysAgo * day);
  d.setUTCHours(hour, (i * 17) % 60, 0, 0);
  return d.toISOString();
}

export type DemoMemory = { key: string; value: string; importance: number; tags: string[] };

const note = (title: string, body: string, ...tags: string[]): DemoNote => ({
  title,
  body,
  tags: [DEMO_TAG, ...tags],
});

export const DEMO_NOTES: DemoNote[] = [
  // ---------- projekt J.A.R.V.I.S. ----------
  note(
    "Mózg 3D — po co",
    "Mapa wiedzy: notatki, wspomnienia i dokumenty jako gwiazdy, bliskie tematy w gromadach. Pytanie w czacie ma rozświetlać gwiazdy, z których J.A.R.V.I.S. bierze odpowiedź.",
    "jarvis",
    "mozg",
  ),
  note(
    "Tryb STRUKTURA w Mózgu",
    "Ta sama scena co WIEDZA, ale tabele bazy jako planety: rozmiar = liczba wierszy, linie = klucze obce. Podgląd danych tylko przez RLS, bez tabel z sekretami.",
    "jarvis",
    "mozg",
    "supabase",
  ),
  note(
    "Darwin — ewolucja promptów",
    "Warianty promptu agenta rywalizują na prawdziwych zadaniach. Typer ma obiektywną ocenę (rozliczone prognozy), więc startujemy od niego. Awans championa tylko ręcznie.",
    "jarvis",
    "darwin",
  ),
  note(
    "Darwin — arena na historii",
    "Prognozy rozliczają się po tygodniu, więc pokolenie na żywo trwa miesiąc. Arena odtwarza prognozy na przeszłych dniach z danymi dostępnymi w dniu prognozy — bez zaglądania w przyszłość.",
    "jarvis",
    "darwin",
  ),
  note(
    "Fundusz J.A.R.V.I.S. — zasady",
    "Paper trading: 100 000 zł na gracza, jeden portfel, bez krótkiej sprzedaży, realizacja po kolejnym zamknięciu. Benchmark kup-i-trzymaj i małpa z rzutkami jako uczciwe linie odniesienia.",
    "jarvis",
    "fundusz",
  ),
  note(
    "Vision AR — tryby",
    "Paragon → Wydatki, licznik auta → koszt kilometra, dokument → RAG, lodówka → przepis. Zawsze ekran potwierdzenia przed zapisem.",
    "jarvis",
    "vision",
  ),
  note(
    "Migracje bez SQL editora",
    "Workflow DB Migrations: check na PR, push po merge, baseline jednorazowo. Push odmawia przy pustej historii migracji — inaczej odtwarzałby bazę od zera.",
    "jarvis",
    "supabase",
  ),
  note(
    "pg_cron i pg_net",
    "Baza sama uruchamia zadania o stałych porach (np. dokładanie nowych gwiazd co 10 minut) i woła funkcje przez HTTP. Zastępuje cron w GitHub Actions tam, gdzie harmonogram ma być per użytkownik.",
    "jarvis",
    "supabase",
  ),
  note(
    "Agent Town — zasada",
    "Town pokazuje wyłącznie prawdziwą aktywność agentów z agent_runs. Żadnego wymyślania, co agent robi — jeśli nic nie robi, czeka przy biurku.",
    "jarvis",
    "town",
  ),
  note(
    "Kolory tylko z tokenów",
    "Każdy kolor z tokenów w styles.css, nigdy literał ani paleta Tailwinda. Nowy motyw to jeden blok CSS, nie polowanie po komponentach.",
    "jarvis",
    "ui",
  ),
  note(
    "Panele: container queries",
    "Układ wewnątrz panelu zależy od jego szerokości, nie od orientacji telefonu. Panel bywa wąski na szerokim ekranie i odwrotnie.",
    "jarvis",
    "ui",
  ),
  note(
    "Strażnik logów",
    "S.H.I.E.L.D. skanuje system_events (warn/error) bez filtra źródła — każde nowe miejsce, które loguje błąd, jest od razu pod nadzorem.",
    "jarvis",
    "agenci",
  ),

  // ---------- rynki i typer ----------
  note(
    "Typer — test A/B",
    "ai = model z dotychczasowym promptem, ai_learned = ten sam model + wnioski z rozliczonych prognoz. Porównanie trafności odpowiada, czy wnioski pomagają, czy tylko ładnie brzmią.",
    "rynki",
    "typer",
  ),
  note(
    "Pasmo „bez zmian” ze zmienności",
    "Stały próg ±1% był za wąski dla krypto i za szeroki dla obligacji. Pasmo liczone ze zmienności instrumentu daje trzy wyniki mniej więcej równie prawdopodobne.",
    "rynki",
    "typer",
  ),
  note(
    "Reżim rynku przy prognozie",
    "Ta sama prognoza wzrostu znaczy co innego w trendzie wzrostowym i w konsolidacji. Zapisywany reżim pozwala liczyć trafność osobno dla każdego.",
    "rynki",
    "typer",
  ),
  note(
    "Mała próbka to nie wniosek",
    "Prognozy z kolejnych dni dotyczą w dużej części tego samego tygodnia — 60 prognoz z trzech tygodni to kilka niezależnych obserwacji. Ściąganie do poziomu losowego chroni przed skrajnymi wnioskami.",
    "rynki",
    "statystyka",
  ),
  note(
    "Watchlista — co obserwować",
    "CD Projekt, Orlen, PKO BP, Apple, Nvidia, Microsoft, bitcoin, ether, złoto, srebro, Brent, gaz, USD/PLN, EUR/PLN i indeksy: WIG20, S&P 500, Nasdaq 100.",
    "rynki",
  ),
  note(
    "WIG20 a ETF WIG20TR",
    "Dla samego indeksu źródła podają tylko ostatnie notowanie, więc wykres to jeden punkt. ETF na WIG20TR ma pełną historię — lepszy kandydat na watchlistę.",
    "rynki",
  ),
  note(
    "RSI — jak czytać",
    "Powyżej 70 rynek uznawany za wykupiony, poniżej 30 za wyprzedany. Sam sygnał nie wystarcza: w silnym trendzie RSI potrafi długo stać w strefie skrajnej.",
    "rynki",
    "analiza-techniczna",
  ),
  note(
    "Średnie kroczące 50/200",
    "Przecięcie średniej 50-dniowej nad 200-dniową (złoty krzyż) to klasyczny sygnał zmiany trendu — spóźniony z natury, bo średnie reagują z opóźnieniem.",
    "rynki",
    "analiza-techniczna",
  ),
  note(
    "Krypto chodzi 24/7",
    "Dlatego osobny przebieg weekendowy: notowania krypto i rozliczenia prognoz, którym termin wypadł w sobotę albo niedzielę.",
    "rynki",
  ),
  note(
    "Kurs walut a wycena portfela",
    "Akcje z USA wyceniane w PLN zmieniają wartość także wtedy, gdy kurs akcji stoi — wystarczy ruch USD/PLN. W funduszu trzeba to rozdzielać w raporcie.",
    "rynki",
    "fundusz",
  ),

  // ---------- paliwa ----------
  note(
    "Hurt Orlenu a ceny na stacjach",
    "Ceny na stacjach reagują na zmiany hurtowe z kilkudniowym opóźnieniem. Spadek w hurcie dziś to sygnał, że za 2–3 dni tankowanie będzie tańsze.",
    "paliwa",
  ),
  note(
    "Ropa Brent i złotówka",
    "Cena paliwa w hurcie zależy od Brenta i kursu USD/PLN naraz. Tania ropa przy słabej złotówce potrafi nic nie zmienić na dystrybutorze.",
    "paliwa",
    "rynki",
  ),
  note(
    "Stałe rozkazy na paliwa",
    "Próg ceny dla Pb95 albo diesla — system sam melduje, kiedy warunek zajdzie. Z martwej serii nie melduje: siedem dni bez nowego punktu = milczenie.",
    "paliwa",
    "jarvis",
  ),
  note(
    "Koszt kilometra",
    "Spalanie × cena litra / 100. Z licznikiem z Vision AR i cenami z /paliwa da się liczyć prawdziwy koszt każdego przejechanego kilometra.",
    "paliwa",
    "vision",
  ),
  note(
    "Pb95 czy diesel — porównanie",
    "Diesel bywa droższy za litr, ale przy niższym spalaniu wygrywa na długich trasach. Porównywać koszt na 100 km, nie cenę litra.",
    "paliwa",
  ),
  note(
    "Kiedy tankować do pełna",
    "Gdy hurt rośnie od kilku dni, a stacje jeszcze nie podniosły cen — tankować teraz. Gdy hurt spada — tankować tyle, ile trzeba.",
    "paliwa",
  ),

  // ---------- Excel / VBA ----------
  note(
    "VBA: szybkie makra",
    "Application.ScreenUpdating = False, Calculation = xlCalculationManual i EnableEvents = False na start makra; przywrócić w bloku obsługi błędów, inaczej Excel zostanie „zamrożony”.",
    "vba",
    "excel",
  ),
  note(
    "VBA: tablice zamiast komórek",
    "Wczytać zakres do tablicy (arr = Range(...).Value), przeliczyć w pamięci i wpisać raz z powrotem. Pętla po komórkach jest setki razy wolniejsza.",
    "vba",
    "excel",
  ),
  note(
    "VBA: Dictionary do deduplikacji",
    "Scripting.Dictionary z kluczem z kolumny daje unikalne wartości i sumy po grupach w jednym przebiegu — szybciej niż COUNTIF w pętli.",
    "vba",
    "excel",
  ),
  note(
    "VBA: Option Explicit",
    "Zawsze na górze modułu. Literówka w nazwie zmiennej przestaje być cichym błędem, a staje się błędem kompilacji.",
    "vba",
  ),
  note(
    "VBA: obsługa błędów",
    "On Error GoTo Handler z jednym wyjściem przez etykietę Cleanup — tam przywracanie ustawień Excela i zamykanie połączeń, niezależnie od tego, czy był błąd.",
    "vba",
  ),
  note(
    "Excel ↔ J.A.R.V.I.S. — pomysł",
    'Funkcje arkusza =JARVIS.KURS("CDR"), =JARVIS.PALIWO("PB95") przez REST Supabase z modułu VBA. W drugą stronę: local-worker uruchamia makro na prośbę z czatu.',
    "vba",
    "jarvis",
    "pomysl",
  ),
  note(
    "Power Query zamiast makra",
    "Powtarzalny import i czyszczenie danych lepiej zrobić w Power Query — kroki są zapisane i odświeżalne. VBA zostawić na to, czego Power Query nie umie.",
    "excel",
    "dane",
  ),
  note(
    "Tabele strukturalne",
    "Ctrl+T zamienia zakres w tabelę: formuły z nazwami kolumn, zakres rośnie sam, a pivot i Power Query nie gubią nowych wierszy.",
    "excel",
  ),
  note(
    "XLOOKUP zamiast VLOOKUP",
    "Szuka w dowolną stronę, ma wartość domyślną przy braku dopasowania i nie psuje się po wstawieniu kolumny.",
    "excel",
  ),
  note(
    "Tabela przestawna — dobre praktyki",
    "Źródło jako tabela strukturalna, pola daty grupowane po miesiącach, wartości jako procent sumy wiersza przy porównaniach struktury.",
    "excel",
    "dane",
  ),

  // ---------- Product Owner ----------
  note(
    "RICE — priorytetyzacja",
    "Reach × Impact × Confidence / Effort. Wymusza liczenie zasięgu i pewności, zamiast porównywać „ważność” na wyczucie.",
    "po",
    "priorytety",
  ),
  note(
    "MoSCoW na sprint",
    "Must / Should / Could / Won't. Najwięcej daje kategoria Won't — jawnie zapisane, czego w tym sprincie NIE robimy.",
    "po",
    "priorytety",
  ),
  note(
    "User story — szablon",
    "Jako [rola] chcę [cel], żeby [korzyść]. Do tego kryteria akceptacji w formie Given / When / Then — testowalne, nie opisowe.",
    "po",
  ),
  note(
    "Definition of Done",
    "Kod po review, testy przechodzą, migracje wgrane, sprawdzone na telefonie i desktopie, dokumentacja zaktualizowana. Wspólna dla zespołu, nie per zadanie.",
    "po",
  ),
  note(
    "Refinement backlogu",
    "Raz w tygodniu, krótko: doprecyzowanie najbliższych historii, podział dużych, wycena. Backlog powyżej dwóch sprintów do przodu nie musi być dopięty.",
    "po",
  ),
  note(
    "Retrospektywa — format",
    "Co pomogło, co przeszkadzało, co zmieniamy. Maksymalnie dwie zmiany na sprint, z właścicielem — inaczej retro produkuje listy, nie poprawę.",
    "po",
    "zespol",
  ),
  note(
    "Roadmapa: teraz / następne / później",
    "Zamiast dat — trzy kolumny. Daty obiecują pewność, której nie ma; kolejność jest uczciwsza.",
    "po",
    "priorytety",
  ),
  note(
    "Metryka North Star",
    "Jedna liczba, która najlepiej oddaje wartość dla użytkownika. Reszta metryk to dźwignie, które na nią wpływają.",
    "po",
    "dane",
  ),
  note(
    "Demo co sprint",
    "Działające oprogramowanie zamiast slajdów. Jeśli czegoś nie da się pokazać, to nie jest skończone.",
    "po",
  ),
  note(
    "Kiedy pytać, a kiedy decydować",
    "Wątpliwości co do zakresu wyjaśnić przed implementacją, a nie w review. Taniej zadać pytanie niż przepisać funkcję.",
    "po",
    "zespol",
  ),

  // ---------- analiza danych ----------
  note(
    "SQL: funkcje okna",
    "SUM() OVER (PARTITION BY ... ORDER BY ...) daje sumy narastające bez self-joinów. ROW_NUMBER() do wyboru najnowszego rekordu w grupie.",
    "sql",
    "dane",
  ),
  note(
    "SQL: CTE dla czytelności",
    "WITH dzieli zapytanie na nazwane kroki — łatwiej debugować i czytać niż zagnieżdżone podzapytania.",
    "sql",
    "dane",
  ),
  note(
    "Średnia czy mediana",
    "Przy rozkładach skośnych (czas realizacji, kwoty zamówień) mediana mówi więcej. Średnią ciągną w górę pojedyncze skrajne wartości.",
    "dane",
    "statystyka",
  ),
  note(
    "Korelacja to nie przyczynowość",
    "Dwie serie mogą rosnąć razem, bo obie zależą od trzeciej. Zanim wniosek trafi do decyzji — szukać mechanizmu, nie tylko współczynnika.",
    "dane",
    "statystyka",
  ),
  note(
    "Wykres: jedna myśl",
    "Każdy wykres odpowiada na jedno pytanie, a tytuł mówi wniosek, nie nazwę metryki. „Sprzedaż spadła w marcu”, nie „Sprzedaż wg miesięcy”.",
    "dane",
    "wizualizacja",
  ),
  note(
    "Kohorty",
    "Grupowanie użytkowników po miesiącu startu pokazuje, czy produkt się poprawia — średnia z całości miesza nowych ze starymi.",
    "dane",
  ),
  note(
    "Jakość danych na wejściu",
    "Duplikaty, puste pola, różne formaty dat. Sprawdzić przed analizą — najdroższy błąd to poprawny wynik na złych danych.",
    "dane",
  ),
  note(
    "Test A/B — wielkość próby",
    "Liczyć próbę przed startem, nie zatrzymywać testu, gdy wynik akurat wygląda dobrze. Wczesne zerkanie zawyża liczbę fałszywych sukcesów.",
    "dane",
    "statystyka",
  ),
  note(
    "Embeddingi w skrócie",
    "Tekst zamieniony na wektor liczb; podobne znaczenia lądują blisko siebie. Na tym działa wyszukiwanie w RAG i układ Mózgu 3D.",
    "dane",
    "jarvis",
  ),

  // ---------- Marvel (spaniel) ----------
  note(
    "Spaniel — ruch",
    "Spaniele to psy pracujące: potrzebują co najmniej godziny ruchu dziennie, najlepiej z elementem węszenia albo aportu, nie tylko spaceru na smyczy.",
    "marvel",
    "pies",
  ),
  note(
    "Spaniel — uszy",
    "Długie, opadające uszy łatwo łapią wilgoć i stany zapalne. Sprawdzać po kąpieli i spacerach w deszczu, czyścić preparatem do uszu.",
    "marvel",
    "pies",
  ),
  note(
    "Spaniel — sierść",
    "Czesanie kilka razy w tygodniu, szczególnie za uszami i na łapach, gdzie sierść się filcuje. Strzyżenie łap co kilka tygodni.",
    "marvel",
    "pies",
  ),
  note(
    "Węszenie męczy bardziej niż bieganie",
    "Mata węchowa albo chowanie smakołyków po domu to dobra praca dla głowy w deszczowy dzień, gdy spacer jest krótszy.",
    "marvel",
    "pies",
  ),
  note(
    "Spacer a pogoda",
    "Pomysł: J.A.R.V.I.S. wskazuje najlepsze okno na spacer z Marvelem z prognozy godzinowej — np. „16:40–17:20, potem leje”.",
    "marvel",
    "jarvis",
    "pomysl",
  ),
  note(
    "Marvel w Agent Town",
    "Pies właściciela chodzi po biurze w Town i reaguje na nastrój. To osobisty element, nie dekoracja — zostaje.",
    "marvel",
    "town",
  ),
  note(
    "Kleszcze — sezon",
    "Od wiosny do jesieni przegląd po każdym spacerze w trawie i zabezpieczenie przeciw kleszczom zgodnie z zaleceniem weterynarza.",
    "marvel",
    "pies",
  ),
];

/** Wyłącznie fakty, które właściciel sam podał. */
export const DEMO_MEMORIES: DemoMemory[] = [
  {
    key: "Rola zawodowa",
    value: "Właściciel jest analitykiem danych i Product Ownerem.",
    importance: 4,
    tags: [DEMO_TAG, "o-mnie", "praca"],
  },
  {
    key: "Język programowania",
    value: "Na co dzień programuje głównie w VBA (Excel).",
    importance: 4,
    tags: [DEMO_TAG, "o-mnie", "vba"],
  },
  {
    key: "Pies Marvel",
    value: "Właściciel ma spaniela o imieniu Marvel; Marvel występuje też w Agent Town.",
    importance: 5,
    tags: [DEMO_TAG, "o-mnie", "marvel"],
  },
  {
    key: "Sposób pracy",
    value:
      "Woli, żeby przed wdrożeniem zmian dopytać o niejasności, i chętnie słucha propozycji optymalizacji.",
    importance: 4,
    tags: [DEMO_TAG, "o-mnie", "po"],
  },
  {
    key: "Język rozmowy",
    value: "Rozmawia po polsku.",
    importance: 3,
    tags: [DEMO_TAG, "o-mnie"],
  },
  {
    key: "Kolejność modułów",
    value: "Wybrana kolejność budowy: Mózg 3D, potem Darwin, Fundusz J.A.R.V.I.S. i Vision AR.",
    importance: 3,
    tags: [DEMO_TAG, "jarvis", "plan"],
  },
  {
    key: "Darwin — decyzja",
    value: "Nowego championa w Darwinie zatwierdza ręcznie, nigdy automatycznie.",
    importance: 3,
    tags: [DEMO_TAG, "jarvis", "darwin"],
  },
  {
    key: "Fundusz — decyzja",
    value: "Fundusz J.A.R.V.I.S. ma jeden wspólny portfel (akcje, surowce, krypto razem).",
    importance: 3,
    tags: [DEMO_TAG, "jarvis", "fundusz"],
  },
  {
    key: "Paragony — decyzja",
    value: "Paragony ze skanera Vision AR mają trafiać do nowego modułu Wydatki.",
    importance: 3,
    tags: [DEMO_TAG, "jarvis", "vision"],
  },
  {
    key: "Mózg — oczekiwania",
    value:
      "Mózg 3D ma dobrze działać na smartfonie i mieć drugi tryb do przeglądania struktury bazy danych.",
    importance: 3,
    tags: [DEMO_TAG, "jarvis", "mozg"],
  },
];
