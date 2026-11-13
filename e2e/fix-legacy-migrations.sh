#!/usr/bin/env bash
# Poprawki starych migracji WYŁĄCZNIE do odtworzenia ich na czystej bazie
# w teście dymnym (etap 9). Działa na kopii roboczej w CI — pliki w repo
# zostają bez zmian (zasada: istniejących migracji się nie edytuje).
#
# Skąd to: migracje sprzed scripts/db-migrations.sh wklejano ręcznie do
# produkcji, a automat zaczął od zapisu stanu faktycznego (baseline), więc
# nikt dotąd nie nakładał ich po kolei na pustą bazę. Każda poprawka niżej ma
# wpis w Rejestrze usterek planu naprawczego.
set -euo pipefail
cd "$(dirname "$0")/../supabase/migrations"

# replace <plik> <perl-regex> <zamiana> — przerywa, gdy wzorca nie ma
# (poprawka nieaktualna albo plik się zmienił — trzeba spojrzeć).
replace() {
  local file="$1" from="$2" to="$3"
  if ! perl -0ne "exit(/$from/ ? 0 : 1)" "$file"; then
    echo "::error::Poprawka nie pasuje do $file: $from"
    exit 1
  fi
  perl -0pi -e "s/$from/$to/g" "$file"
  echo "poprawione: $file"
}

# 1. to_jsonb na literale $$…$$ bez typu: „could not determine polymorphic
#    type because input has type unknown”. Inne migracje mają tu ::text.
replace 20260817120000_metric_analysis_expansion.sql \
  'powiedz to wprost\.\$\$\n' 'powiedz to wprost.\$\$::text\n'
