#!/usr/bin/env bash
# Crea un Postgres temporal, aplica 01/02/03 con los stubs y corre casos.sql.
# Requiere los binarios de PostgreSQL (initdb, pg_ctl, psql). No usa red.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DIR="$(mktemp -d)"
COMO=""
if [ "$(id -u)" = "0" ]; then chown postgres "$DIR"; COMO="su postgres -c"; fi
correr() { if [ -n "$COMO" ]; then $COMO "$*"; else bash -c "$*"; fi; }
correr "$BIN/initdb -D $DIR/data -A trust >/dev/null"
correr "$BIN/pg_ctl -D $DIR/data -o '-k $DIR -c listen_addresses=' -l $DIR/log -w start >/dev/null"
trap 'correr "$BIN/pg_ctl -D $DIR/data -m fast stop >/dev/null"; rm -rf "$DIR"' EXIT
PSQL="psql -h $DIR -U postgres -v ON_ERROR_STOP=1 -q -X"
$PSQL -f "$RAIZ/pruebas/sql/stubs-local.sql"
$PSQL -f "$RAIZ/supabase/01-catalogo.sql" >/dev/null 2>&1
sed '/create extension/d' "$RAIZ/supabase/02-sincronizacion.sql" | $PSQL >/dev/null 2>&1
$PSQL -f "$RAIZ/supabase/03-pedidos.sql" >/dev/null 2>&1
$PSQL -At -F ' | ' -f "$RAIZ/pruebas/sql/casos.sql"
