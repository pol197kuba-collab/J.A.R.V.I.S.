## Cel
Dodać nowy moduł "Schema Explorer" (Eksplorator Bazy), w którym możesz podejrzeć wszystkie tabele w backendzie: kolumny, typy, klucze obce (zależności) i polityki RLS — w stylistyce reszty aplikacji (HUD Stark/JARVIS).

## Zakres — tylko UI + odczyt schematu

### 1. Server function (odczyt schematu)
Nowy plik `src/lib/schema/schema.functions.ts` z jedną chronioną funkcją `getDatabaseSchema` (`requireSupabaseAuth` + weryfikacja roli `admin` przez `has_role`, żeby tylko właściciel widział strukturę). Funkcja czyta z `information_schema` / `pg_catalog`:
- lista tabel schematu `public`
- kolumny (nazwa, typ, nullable, default)
- klucze obce (tabela → tabela, kolumny)
- polityki RLS (nazwa, komenda, role) — sam fakt istnienia, bez ujawniania sekretów
- enumy (`app_role`)

Zwraca zserializowany DTO. Bez żadnych zmian w schemacie bazy.

### 2. Nowa trasa `/schema` (pod `_authenticated`, ale utrzymamy istniejący wzorzec)
Plik `src/routes/schema.tsx` w stylu pozostałych modułów (jak `system-logs.tsx`, `agent-hub.tsx`):
- Nagłówek HUD z tytułem "SCHEMA / DATABASE TOPOLOGY"
- Lewa kolumna: lista tabel (nazwy + liczba kolumn / policies) z filtrem/wyszukiwarką
- Prawa kolumna dla wybranej tabeli:
  - tabela kolumn: `column`, `type`, `nullable`, `default`
  - sekcja "Foreign keys" — strzałki `col → other_table.col` z klikalnym przejściem do docelowej tabeli
  - sekcja "RLS policies" — lista nazw + komend (SELECT/INSERT/UPDATE/DELETE)
- Widok "Graph" (prosty, SVG) — węzły = tabele, linie = FK; klik w węzeł otwiera szczegóły. Layout siatkowy, bez zewnętrznej biblioteki graf, żeby nie dokładać zależności.

### 3. Sidebar
`src/components/jarvis/AppSidebar.tsx` — dodać pozycję "SCHEMA" z ikoną (np. `Database` z lucide) prowadzącą do `/schema`. Pokazywana tylko dla admina (masz tę rolę — `pol197.kuba@gmail.com`).

### 4. Bez zmian w bazie
Nie tworzymy nowych tabel, migracji, grantów ani polityk. Funkcja czyta tylko metadane z `information_schema` przez `context.supabase` (uprawnienia `authenticated` do tych widoków są standardowe). Jeśli któryś fragment nie będzie widoczny bez wyższych uprawnień (np. `pg_policies` dla ról), wtedy ta konkretna sekcja przejdzie przez `supabaseAdmin` załadowany wewnątrz handlera — dopiero PO sprawdzeniu roli `admin`.

## Poza zakresem
- Edycja schematu z UI (tylko podgląd)
- Podgląd danych w wierszach (to osobny temat)
- Eksport SQL / migracji

## Rezultat
Nowa zakładka "SCHEMA" w sidebarze → widzisz wszystkie tabele, kolumny, typy, relacje FK i istniejące RLS policies w spójnej stylistyce HUD, bez wchodzenia w zewnętrzne dashboardy.