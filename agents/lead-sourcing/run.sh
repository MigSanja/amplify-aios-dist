#!/usr/bin/env bash
# Lead Sourcing Agent — Orchestrator. Fährt alle Stufen: (Batch-Sheet) -> Sourcing -> Import -> Enrichment -> Verify.
#   agents/lead-sourcing/run.sh "Berlin" "Immobilienmakler,Immobilienbüro" "Makler Berlin"
#     $1 = Stadt   $2 = Suchbegriffe (Komma)   $3 = Batch-Name (optional -> neues Sheet im Drive-Ordner "Lead Scraping")
# Ohne $3 schreibt es ins Default-Sheet (LEAD_SHEET_ID / gsheet-client-Default).
set -uo pipefail

LEADS="$HOME/AIOS/agents/lead-sourcing"
CITY="${1:-Berlin}"
TERMS="${2:-Immobilienmakler,Immobilienbüro,Immobilienvermittlung,Immobilienagentur,Immobilienberatung}"
BATCH="${3:-}"

echo "== Lead Sourcing Agent  |  $CITY  |  $(date '+%Y-%m-%d %H:%M') =="

if [ -n "$BATCH" ]; then
  echo "[0/4] Neues Batch-Sheet '$BATCH' im Drive-Ordner 'Lead Scraping' ..."
  SID=$(node "$LEADS/create-batch-sheet.js" "$BATCH") || { echo "  ✗ Batch-Sheet fehlgeschlagen"; exit 1; }
  export LEAD_SHEET_ID="$SID"
  echo "  Sheet-ID: $SID"
fi
SHEET="https://docs.google.com/spreadsheets/d/${LEAD_SHEET_ID}"

echo "[1/4] Sourcing (Google Maps) ..."
DS=$(node "$LEADS/source-gmaps.js" "$CITY" "$TERMS") || { echo "  ✗ Sourcing fehlgeschlagen"; exit 1; }
echo "  Dataset: $DS"

echo "[2/4] Import ins Sheet + Header ..."
node "$LEADS/import-maps.js" "$DS" || { echo "  ✗ Import fehlgeschlagen"; exit 1; }
node "$LEADS/format-header.js" Tabellenblatt1 L

echo "[3/4] GF-Enrichment (persönliche Maps-Mails + AnyMailFinder) ..."
node "$LEADS/find-gf.js" || echo "  ! übersprungen (ANYMAILFINDER_API_KEY fehlt in .env?)"

echo "[4/4] Verify (MillionVerifier) ..."
node "$LEADS/verify-emails.js" || echo "  ! Verify fehlgeschlagen"

echo "== Fertig. Sheet: $SHEET =="
