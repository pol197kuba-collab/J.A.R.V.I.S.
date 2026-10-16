#!/usr/bin/env bash
# Migracje z supabase/migrations → baza Supabase, bez SQL editora.
#
#   scripts/db-migrations.sh check              co by weszło (nic nie zmienia)
#   scripts/db-migrations.sh push               wgrywa brakujące migracje
#   scripts/db-migrations.sh baseline <wersja>  JEDNORAZOWO: oznacza migracje
#                                               do <wersja> włącznie jako już
#                                               wgrane (bez uruchamiania SQL)
#
# Połączenie z SUPABASE_DB_URL — connection string „Session pooler" z panelu
# Supabase (Connect), hasło zakodowane procentowo. Pooler, nie bezpośredni
# adres db.<ref>.supabase.co: ten jest tylko po IPv6, a runnery GitHuba go
# nie mają.
#
# Dlaczego baseline: CLI wie, co już jest w bazie, z tabeli
# supabase_migrations.schema_migrations. Dotąd migracje wklejaliśmy ręcznie,
# więc ta tabela jest pusta i `push` próbowałby odtworzyć całą bazę od zera
# na istniejących tabelach. Dlatego przy pustej historii `push` odmawia, a
# baseline raz zapisuje stan faktyczny.
set -euo pipefail

# Wersja CLI przypięta tak jak tsx w pozostałych jobach — bez dopisywania
# zależności do package.json.
CLI=(npx --yes supabase@2.48.3)
MIGRATIONS_DIR="$(dirname "$0")/../supabase/migrations"

mode="${1:-check}"
db_url="${SUPABASE_DB_URL:?Brak SUPABASE_DB_URL (connection string Session pooler z panelu Supabase)}"

local_versions() {
  find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -printf '%f\n' | sed -E 's/^([0-9]+)_.*/\1/' | sort
}

# Liczba wpisów w historii migracji; 0 także wtedy, gdy tabeli jeszcze nie ma.
# Błąd połączenia przerywa skrypt — nie może udawać pustej historii.
history_count() {
  local exists
  exists=$(psql "$db_url" -tAX -v ON_ERROR_STOP=1 \
    -c "select to_regclass('supabase_migrations.schema_migrations') is not null")
  if [ "$exists" != "t" ]; then
    echo 0
    return
  fi
  psql "$db_url" -tAX -v ON_ERROR_STOP=1 -c "select count(*) from supabase_migrations.schema_migrations"
}

case "$mode" in
  check)
    if [ "$(history_count)" = "0" ]; then
      echo "::warning::Historia migracji w bazie jest pusta — przed pierwszym push uruchom baseline (instrukcja w TODO.md, sekcja 0)."
      echo "Migracje w repo: $(local_versions | wc -l), ostatnia: $(local_versions | tail -1)"
      exit 0
    fi
    "${CLI[@]}" db push --db-url "$db_url" --include-all --dry-run
    ;;

  push)
    if [ "$(history_count)" = "0" ]; then
      echo "::error::Historia migracji w bazie jest pusta — push odtworzyłby całą bazę od zera. Najpierw baseline (TODO.md, sekcja 0)."
      exit 1
    fi
    "${CLI[@]}" db push --db-url "$db_url" --include-all --yes
    ;;

  baseline)
    up_to="${2:?Podaj wersję, np. baseline 20261016180000}"
    if ! local_versions | grep -qx "$up_to"; then
      echo "::error::Wersji $up_to nie ma w supabase/migrations."
      exit 1
    fi
    mapfile -t versions < <(local_versions | awk -v max="$up_to" '$1 <= max')
    echo "Oznaczam ${#versions[@]} migracji (do $up_to włącznie) jako wgrane — SQL nie jest uruchamiany."
    "${CLI[@]}" migration repair --db-url "$db_url" --status applied --yes "${versions[@]}"
    "${CLI[@]}" migration list --db-url "$db_url"
    ;;

  *)
    echo "Użycie: $0 check | push | baseline <wersja>" >&2
    exit 2
    ;;
esac
