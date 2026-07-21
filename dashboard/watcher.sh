#!/bin/bash
# Jarvis — Wrapper für den Mail- & Kalender-Watcher. launchd alle 10 Min (com.jarvis.watcher).
# Löst die claude-CLI update-fest auf (für die Mail-Triage) und ruft watcher.js.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.claude/local"

ROOT="$HOME/AIOS"
LOG="$ROOT/dashboard/watcher.log"

source "$ROOT/dashboard/claude-bin.sh"   # exportiert CLAUDE_BIN (leer = Triage fällt auf VIP-only zurück)

echo "=== $(date '+%F %T') watcher ===" >> "$LOG"

# Meeting-Modus: läuft gerade ein Call (Sales Copilot "Mithören")? Dann still bleiben,
# damit der Call flüssig ist. Selbstheilend: Flag älter als Kappe (2h) → verwerfen.
MEETING_FLAG="$ROOT/dashboard/.meeting-mode"
if [ -f "$MEETING_FLAG" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$MEETING_FLAG" 2>/dev/null || echo 0) ))
  if [ "$AGE" -lt 7200 ]; then echo "  Meeting-Modus aktiv (${AGE}s) — übersprungen." >> "$LOG"; exit 0; fi
  echo "  Meeting-Flag abgelaufen (${AGE}s) — entferne, fahre fort." >> "$LOG"; rm -f "$MEETING_FLAG"
fi

node "$ROOT/dashboard/watcher.js" >> "$LOG" 2>&1
