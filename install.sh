#!/usr/bin/env bash
# ===================================================================
# AIOS: Ein-Befehl-Installer
# Nutzung:  curl -fsSL https://raw.githubusercontent.com/MigSanja/amplify-aios-dist/main/install.sh | bash
# ===================================================================
set -euo pipefail

REPO_URL="${AIOS_REPO_URL:-https://github.com/MigSanja/amplify-aios-dist.git}"
DEST="${AIOS_DIR:-$HOME/AIOS}"

say()  { printf "\033[1;36m›\033[0m %s\n" "$*"; }
ok()   { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*"; }
die()  { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

say "AIOS wird installiert…"

# ---- Voraussetzungen ----
[ "$(uname)" = "Darwin" ] || die "Läuft aktuell nur auf macOS."
command -v git >/dev/null 2>&1 || die "Git fehlt. Installiere die Xcode Command Line Tools: xcode-select --install"

if ! command -v node >/dev/null 2>&1; then
  die "Node.js fehlt. Installiere Node ≥ 18 von https://nodejs.org und starte den Befehl neu."
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node ist zu alt ($(node -v)). Bitte Node ≥ 18 installieren."
ok "Node $(node -v)"

command -v "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" >/dev/null 2>&1 \
  || [ -d "/Applications/Google Chrome.app" ] \
  || warn "Google Chrome nicht gefunden: für Outreach-Module später nötig."

# ---- Holen / Aktualisieren ----
if [ -d "$DEST/.git" ]; then
  say "Vorhandene Installation gefunden, aktualisiere…"
  git -C "$DEST" pull --ff-only || warn "git pull übersprungen (lokale Änderungen?)."
else
  [ -e "$DEST" ] && die "$DEST existiert schon, ist aber kein Git-Repo. Bitte umbenennen/entfernen."
  say "Klone nach $DEST …"
  git clone --depth 1 "$REPO_URL" "$DEST"
fi
ok "AIOS liegt in $DEST"

# ---- .env vorbereiten ----
if [ ! -f "$DEST/.env" ]; then
  cp "$DEST/.env.example" "$DEST/.env"
  ok ".env aus Vorlage erstellt (leer: wird im Onboarding gefüllt)"
fi

# ---- Nächster Schritt ----
cat <<EOF

$(ok "Fertig installiert.")

Nächster Schritt:
  1) Öffne den Ordner in Claude Code:   $DEST
  2) Tippe:   /aios-setup

Claude Code führt dich dann durch alles (Brain einbinden, WhatsApp verbinden, Module aktivieren).
Jeder Schritt ist überspringbar und später nachholbar.
EOF
