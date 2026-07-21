#!/bin/bash
# Startet ein gehärtetes Automations-Chrome für einen Outreach-Account.
# Spurenfrei: sieht für LinkedIn wie ein normaler Chrome auf macOS aus (webdriver=false, AutomationControlled aus).
# Usage: launch-chrome.sh <port> <userDataDir>
#   z.B. launch-chrome.sh 9222 "$HOME/.jarvis-chrome/alex"
set -e
PORT="${1:?Port fehlt}"
DIR="${2:?userDataDir fehlt}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Bestehende Instanz dieses Profils sauber beenden (Login bleibt im Profil-Ordner erhalten)
pkill -f "user-data-dir=$DIR" 2>/dev/null || true
sleep 1

mkdir -p "$DIR"

# Fenster IMMER als normales, begrenztes Fenster starten — NIE Vollbild/bildschirmfüllend.
# Grund: das Agent-Chrome ist eine eigene Instanz DERSELBEN Chrome-App wie des Nutzers
# Alltags-Chrome. Wird es Vollbild/frontmost, übernimmt es Dock + Profil-Wähler und wirft
# der Nutzer aus seinem Fenster. Feste --window-position/--window-size überschreiben den
# gespeicherten (zuletzt bildschirmfüllenden) Fensterzustand beim Start.
case "$PORT" in
  9224) WIN_POS="60,120";  WIN_SIZE="1100,760" ;;   # upwork: oben links versetzt (kein Overlap mit alex)
  9223) WIN_POS="120,200"; WIN_SIZE="1050,740" ;;   # paul: oben links versetzt — kein Overlap mit alex' Fenster (unten rechts)
  *)    WIN_POS="720,310"; WIN_SIZE="1050,740" ;;   # alex: KLEIN unten rechts — wie früher, stört des Nutzers Arbeit nicht
esac

nohup "$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$DIR" \
  --remote-allow-origins=* \
  --disable-blink-features=AutomationControlled \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=Translate \
  --window-position="$WIN_POS" \
  --window-size="$WIN_SIZE" \
  --homepage=about:blank \
  about:blank >/dev/null 2>&1 &

# kurz warten + Debug-Port verifizieren
for i in 1 2 3 4 5 6 7 8; do
  if curl -s "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
    echo "OK: Chrome auf Port $PORT (Profil: $DIR)"
    exit 0
  fi
  sleep 1
done
echo "FEHLER: Port $PORT antwortet nicht"
exit 1
