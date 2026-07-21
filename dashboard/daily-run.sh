#!/bin/bash
# Jarvis — täglicher Outreach-Lauf (Alex), getriggert via launchd um 07:00.
# Selbstheilend: startet gehärtetes Chrome (9222) + Dashboard, verifiziert dass der Agent
# WIRKLICH lief (nicht nur dass der Befehl angenommen wurde), retried mit Backoff bei
# Fehlschlag, meldet sich per Telegram wenn alle Versuche scheitern (nie still abbrechen).
ROOT="$HOME/AIOS"
LOG="$ROOT/dashboard/daily-run.log"
# launchd startet mit minimalem PATH — ohne das hier findet er node nicht (kunden-index, notify)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
TRAIL="$ROOT/agents/outreach-alex/runs/.live-$(date +%F).jsonl"
MAX_TRIES=3
BACKOFF=(10 30 60)
cd "$ROOT" || exit 1

notify() { node "$ROOT/dashboard/notify.js" --title "🌅 Tageslauf" "$1" >> "$LOG" 2>&1; }

ensure_chrome() {
  # Chrome schon offen (Debug-Port antwortet) → nicht doppelt öffnen, Session bleibt gültig.
  curl -s --max-time 3 http://127.0.0.1:9222/json/version >/dev/null 2>&1 && return 0
  echo "  Chrome 9222 down → Agent-Session recyceln + Chrome frisch starten" >> "$LOG"
  # WICHTIG (Bug-Fix 12.07., wie upwork-scan.sh): Frisches Chrome heißt, eine noch laufende
  # Agent-Session hängt mit ihrer chrome-devtools-mcp am TOTEN Chrome und meldet fälschlich
  # "Chrome läuft nicht". Session zuerst beenden → der nächste agent-console-send spawnt eine
  # frische MCP-Verbindung zum neuen Chrome. (Kill in launch-chrome.sh trifft nur dieses Profil.)
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

echo "=== $(date '+%Y-%m-%d %H:%M:%S') daily-run start ===" >> "$LOG"

# Meeting-Modus: läuft gerade ein Call (Sales Copilot "Mithören")? Tageslauf jetzt nicht starten,
# der Watchdog zieht ihn nach, sobald der Call vorbei ist. Selbstheilend: Flag >2h → verwerfen.
MEETING_FLAG="$ROOT/dashboard/.meeting-mode"
if [ -f "$MEETING_FLAG" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$MEETING_FLAG" 2>/dev/null || echo 0) ))
  if [ "$AGE" -lt 7200 ]; then echo "  Meeting-Modus aktiv (${AGE}s) — Start verschoben, Watchdog zieht nach." >> "$LOG"; exit 0; fi
  echo "  Meeting-Flag abgelaufen (${AGE}s) — entferne, fahre fort." >> "$LOG"; rm -f "$MEETING_FLAG"
fi

# Stop heißt Stop: hat der Nutzer den Agenten pausiert (.paused via Dashboard-Stop), startet der Tageslauf NICHT.
# Aber nie still überspringen: genau EIN Telegram-Ping als Erinnerung (Watchdog pingt bewusst nicht).
if [ -f "$ROOT/agents/outreach-alex/.paused" ]; then
  echo "  Agent pausiert (.paused gesetzt) — kein Start. Play im Dashboard gibt ihn wieder frei." >> "$LOG"
  notify "⏸️ Outreach-Agent ist pausiert — der Tageslauf wäre jetzt gestartet. Play im Dashboard, wenn er heute laufen soll."
  exit 0
fi

# Kunden-Index neu bauen (kompakter CRM-/Brain-Überblick für Jarvis-Telegram/Copilot).
node "$ROOT/dashboard/kunden-index.js" >> "$LOG" 2>&1 || echo "  kunden-index.js Fehler (nicht fatal)" >> "$LOG"

for ((i = 1; i <= MAX_TRIES; i++)); do
  echo "  Versuch $i/$MAX_TRIES" >> "$LOG"

  if ! ensure_chrome; then
    echo "  Chrome-Start fehlgeschlagen (Versuch $i)" >> "$LOG"
    sleep "${BACKOFF[$((i - 1))]}"
    continue
  fi
  if ! ensure_dashboard; then
    echo "  Dashboard-Start fehlgeschlagen (Versuch $i)" >> "$LOG"
    sleep "${BACKOFF[$((i - 1))]}"
    continue
  fi

  # ab Versuch 2: evtl. hängende Session vom vorigen Fehlschlag sauber beenden
  if [ "$i" -gt 1 ]; then
    curl -s -X POST http://localhost:4321/api/agent-console-stop \
      -H 'Content-Type: application/json' --data '{"agent":"outreach-alex"}' >> "$LOG" 2>&1
  fi

  echo "  poste Lauf-Befehl" >> "$LOG"
  RESP="$(curl -s -X POST http://localhost:4321/api/agent-console-send \
    -H 'Content-Type: application/json' \
    --data-binary @"$ROOT/dashboard/daily-run-prompt.json")"
  echo "$RESP" >> "$LOG"

  if ! echo "$RESP" | grep -q '"ok":true'; then
    echo "  Dashboard lehnte Befehl ab (Versuch $i)" >> "$LOG"
    sleep "${BACKOFF[$((i - 1))]}"
    continue
  fi

  # 20s warten, dann prüfen ob der Agent WIRKLICH lief statt sofort abzubrechen
  # (das war der Bug am 07.07.: "ok":true kam durch, Chrome war aber schon wieder tot)
  sleep 20
  if [ -f "$TRAIL" ] && ! tail -c 2000 "$TRAIL" | grep -qi "nicht erreichbar\|STOPP"; then
    echo "=== Lauf gestartet und läuft (Versuch $i) ===" >> "$LOG"
    exit 0
  fi

  echo "  Agent brach sofort ab (Versuch $i) — letzte Trail-Zeilen:" >> "$LOG"
  tail -c 300 "$TRAIL" >> "$LOG" 2>/dev/null
  echo "" >> "$LOG"
  sleep "${BACKOFF[$((i - 1))]}"
done

echo "=== ALLE $MAX_TRIES VERSUCHE GESCHEITERT ===" >> "$LOG"
notify "07:00-Lauf ist nach $MAX_TRIES Versuchen NICHT gestartet. Log: dashboard/daily-run.log"
