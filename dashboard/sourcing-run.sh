#!/bin/bash
# Jarvis — globaler Lead-Sourcing-Lauf (Alex' SalesNav, für BEIDE Accounts). Architektur 20.07.
# Sammelt Kandidaten für Alex (1-10 MA) + Paul (11-50 MA) in zwei .candidates-<datum>.jsonl.
# VERNETZT NICHT, schickt KEINE Nachricht — reines Sammeln. Danach vernetzen die Outreach-Läufe.
# Selbstheilend wie daily-run.sh (Chrome 9222 + Dashboard sicherstellen, Session recyceln, Retry, Verify, Alert).
# ⚠️ Automatik (launchd 04:00) ist bewusst NOCH AUS — erster Lauf supervised. Manuell/supervised startbar.
ROOT="$HOME/AIOS"
LOG="$ROOT/dashboard/sourcing-run.log"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
TRAIL="$ROOT/agents/outreach-alex/runs/.live-$(date +%F).jsonl"
MAX_TRIES=3
BACKOFF=(10 30 60)
cd "$ROOT" || exit 1

notify() { node "$ROOT/dashboard/notify.js" --title "🔎 Sourcing" "$1" >> "$LOG" 2>&1; }

ensure_chrome() {
  curl -s --max-time 3 http://127.0.0.1:9222/json/version >/dev/null 2>&1 && return 0
  echo "  Chrome 9222 down → Agent-Session recyceln + Chrome frisch starten" >> "$LOG"
  curl -s -X POST http://localhost:4321/api/agent-console-stop \
    -H 'Content-Type: application/json' --data '{"agent":"outreach-alex"}' >> "$LOG" 2>&1
  bash "$ROOT/dashboard/launch-chrome.sh" 9222 "$HOME/.jarvis-chrome/alex" >> "$LOG" 2>&1
  curl -s --max-time 3 http://127.0.0.1:9222/json/version >/dev/null 2>&1
}

ensure_dashboard() {
  curl -s --max-time 3 http://localhost:4321/api/agents >/dev/null 2>&1 && return 0
  echo "  Dashboard down → starte" >> "$LOG"
  CB="$(command -v claude || echo "")"
  CLAUDE_BIN="$CB" nohup node "$ROOT/dashboard/server.js" >> "$LOG" 2>&1 &
  disown
  sleep 5
  curl -s --max-time 3 http://localhost:4321/api/agents >/dev/null 2>&1
}

echo "=== $(date '+%Y-%m-%d %H:%M:%S') sourcing-run start ===" >> "$LOG"

# Meeting-Modus (laufender Call) → nicht starten.
MEETING_FLAG="$ROOT/dashboard/.meeting-mode"
if [ -f "$MEETING_FLAG" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$MEETING_FLAG" 2>/dev/null || echo 0) ))
  if [ "$AGE" -lt 7200 ]; then echo "  Meeting-Modus aktiv (${AGE}s) — Sourcing verschoben." >> "$LOG"; exit 0; fi
  rm -f "$MEETING_FLAG"
fi

# Stop heißt Stop: ist der Alex-Agent pausiert (.paused), startet auch das Sourcing NICHT.
if [ -f "$ROOT/agents/outreach-alex/.paused" ]; then
  echo "  Alex-Agent pausiert (.paused) — kein Sourcing." >> "$LOG"
  notify "⏸️ Sourcing-Lauf übersprungen — Alex-Agent ist pausiert (.paused). Play im Dashboard, wenn er quellen soll."
  exit 0
fi

for ((i = 1; i <= MAX_TRIES; i++)); do
  echo "  Versuch $i/$MAX_TRIES" >> "$LOG"
  if ! ensure_chrome; then echo "  Chrome-Start fehlgeschlagen (Versuch $i)" >> "$LOG"; sleep "${BACKOFF[$((i - 1))]}"; continue; fi
  if ! ensure_dashboard; then echo "  Dashboard-Start fehlgeschlagen (Versuch $i)" >> "$LOG"; sleep "${BACKOFF[$((i - 1))]}"; continue; fi
  if [ "$i" -gt 1 ]; then
    curl -s -X POST http://localhost:4321/api/agent-console-stop \
      -H 'Content-Type: application/json' --data '{"agent":"outreach-alex"}' >> "$LOG" 2>&1
  fi

  echo "  poste Sourcing-Befehl" >> "$LOG"
  RESP="$(curl -s -X POST http://localhost:4321/api/agent-console-send \
    -H 'Content-Type: application/json' \
    --data-binary @"$ROOT/dashboard/sourcing-prompt.json")"
  echo "$RESP" >> "$LOG"

  if ! echo "$RESP" | grep -q '"ok":true'; then
    echo "  Dashboard lehnte Befehl ab (Versuch $i)" >> "$LOG"; sleep "${BACKOFF[$((i - 1))]}"; continue
  fi

  sleep 20
  if [ -f "$TRAIL" ] && ! tail -c 2000 "$TRAIL" | grep -qi "nicht erreichbar\|STOPP"; then
    echo "=== Sourcing gestartet und läuft (Versuch $i) ===" >> "$LOG"
    exit 0
  fi
  echo "  Sourcing brach sofort ab (Versuch $i)" >> "$LOG"; tail -c 300 "$TRAIL" >> "$LOG" 2>/dev/null; echo "" >> "$LOG"
  sleep "${BACKOFF[$((i - 1))]}"
done

echo "=== ALLE $MAX_TRIES VERSUCHE GESCHEITERT ===" >> "$LOG"
notify "Sourcing-Lauf ist nach $MAX_TRIES Versuchen NICHT gestartet. Log: dashboard/sourcing-run.log"
