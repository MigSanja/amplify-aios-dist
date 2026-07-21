#!/bin/bash
# Jarvis — Outreach-Watchdog (Ersatz für die frühere 13:00-Claude-Routine, rein lokal).
# launchd stündlich 10–18 Uhr (:20). Prüft, ob die Tageskette von outreach-alex heute
# ABGESCHLOSSEN ist (Abschluss-Report runs/<heute>-tageskette.md = Vertrag der Kette).
# Läuft sie gerade (Trail <15 min frisch) → nicht reinfunken. Steht sie (kein Report,
# Trail alt/fehlt) → hängende Session stoppen, Nachzug-Auftrag senden, EIN Telegram-Ping.
# Damit überlebt die Kette Server-/Session-Abstürze — kein Tag geht mehr still verloren.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ROOT="$HOME/AIOS"
LOG="$ROOT/dashboard/outreach-watchdog.log"
AGENT="outreach-alex"
TODAY="$(date +%F)"
REPORT="$ROOT/agents/$AGENT/runs/$TODAY-tageskette.md"
TRAIL="$ROOT/agents/$AGENT/runs/.live-$TODAY.jsonl"
cd "$ROOT" || exit 1

log() { echo "$1" >> "$LOG"; }
notify() { node "$ROOT/dashboard/notify.js" --title "🐶 Outreach-Watchdog" "$1" >> "$LOG" 2>&1; }

echo "=== $(date '+%F %T') watchdog ===" >> "$LOG"

# 0a) Meeting-Modus: läuft gerade ein Call (Sales Copilot "Mithören")? Nicht reinfunken —
#     der Call soll flüssig bleiben. Selbstheilend: Flag älter als Kappe (2h) → verwerfen.
MEETING_FLAG="$ROOT/dashboard/.meeting-mode"
if [ -f "$MEETING_FLAG" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$MEETING_FLAG" 2>/dev/null || echo 0) ))
  if [ "$AGE" -lt 7200 ]; then log "  Meeting-Modus aktiv (${AGE}s) — Watchdog ruht."; exit 0; fi
  log "  Meeting-Flag abgelaufen (${AGE}s) — entferne, fahre fort."; rm -f "$MEETING_FLAG"
fi

# 0) Stop heißt Stop: pausierter Agent (.paused via Dashboard-Stop) wird NICHT angefasst —
#    kein Nachzug, kein Neustart, ein eingefrorener Lauf bleibt eingefroren bis Play.
if [ -f "$ROOT/agents/$AGENT/.paused" ]; then
  log "  Agent pausiert (.paused) — Watchdog greift nicht ein."
  exit 0
fi

# 1) Fertig? Abschluss-Report existiert → nichts zu tun.
if [ -f "$REPORT" ]; then log "  Report da — Kette abgeschlossen."; exit 0; fi

# 2) Läuft gerade? Trail in den letzten 15 Min beschrieben → in Ruhe lassen.
if [ -f "$TRAIL" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$TRAIL" 2>/dev/null || echo 0) ))
  if [ "$AGE" -lt 900 ]; then log "  Trail ${AGE}s alt — läuft gerade."; exit 0; fi
  log "  Trail seit ${AGE}s still, kein Report — Kette steht."
else
  log "  Kein Trail heute, kein Report — Kette nie gestartet."
fi

# 3) Infrastruktur sicherstellen (wie daily-run.sh, aber mit update-fester claude-Auflösung).
source "$ROOT/dashboard/claude-bin.sh"
if ! curl -s --max-time 3 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  log "  Chrome 9222 down → starte"
  bash "$ROOT/dashboard/launch-chrome.sh" 9222 "$HOME/.jarvis-chrome/alex" >> "$LOG" 2>&1
fi
if ! curl -s --max-time 3 http://localhost:4321/api/agents >/dev/null 2>&1; then
  log "  Dashboard down → starte"
  nohup node "$ROOT/dashboard/server.js" >> "$ROOT/dashboard/server.local.log" 2>&1 &
  disown
  sleep 5
fi
if ! curl -s --max-time 3 http://localhost:4321/api/agents >/dev/null 2>&1; then
  log "  Dashboard-Start fehlgeschlagen"
  notify "Watchdog: Tageskette steht UND Dashboard startet nicht. Log: dashboard/outreach-watchdog.log"
  exit 1
fi

# 4) Hängende/tote Session sauber beenden, dann Nachzug anstoßen.
curl -s -X POST http://localhost:4321/api/agent-console-stop \
  -H 'Content-Type: application/json' --data "{\"agent\":\"$AGENT\"}" >> "$LOG" 2>&1

STATS="$(node -e "try{const s=require('$ROOT/agents/$AGENT/stats.json')['$TODAY']||{};console.log(JSON.stringify(s));}catch(e){console.log('{}')}")"
MSG="WATCHDOG-NACHZUG ($(date '+%H:%M')): Die heutige Tageskette ist noch nicht abgeschlossen (kein $TODAY-tageskette.md). Dein Tagesauftrag mit ALLEN Regeln steht in dashboard/daily-run-prompt.json (Feld msg) — lies ihn und befolge ihn. Heutiger Stand laut stats.json: $STATS. Prüfe zusätzlich Trail/CRM, überspringe bereits erledigte Schritte und arbeite NUR die fehlenden Schritte der Kette ab (Wochenend-Regel beachten). Am Ende wie im Tagesauftrag: Report an runs/$TODAY-tageskette.md + GENAU EINE Telegram-Abschlussmeldung."
node -e "console.log(JSON.stringify({agent:'$AGENT',msg:process.argv[1]}))" "$MSG" > /tmp/jarvis-watchdog-msg.json
RESP="$(curl -s -X POST http://localhost:4321/api/agent-console-send \
  -H 'Content-Type: application/json' --data-binary @/tmp/jarvis-watchdog-msg.json)"
log "  send: $RESP"

# 5) Verifizieren, dass der Nachzug WIRKLICH läuft (Trail bewegt sich) — sonst Alarm.
sleep 25
NEWAGE=$(( $(date +%s) - $(stat -f %m "$TRAIL" 2>/dev/null || echo 0) ))
if echo "$RESP" | grep -q '"ok":true' && [ "$NEWAGE" -lt 60 ]; then
  log "  Nachzug läuft."
  notify "Tageskette stand (Stand: $STATS) — Nachzug gestartet."
else
  log "  Nachzug NICHT angelaufen (resp=$RESP, trail age=${NEWAGE}s)"
  notify "Tageskette steht und der Nachzug ist NICHT angelaufen. Bitte Dashboard/Log prüfen: dashboard/outreach-watchdog.log"
fi
