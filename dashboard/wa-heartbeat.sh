#!/bin/bash
# wa-heartbeat.sh — Belt-and-braces für das WhatsApp-Modul (launchd com.jarvis.wa-heartbeat, alle 10 Min).
# 1) Stößt den Scheduler-Tick an (Server hat zwar sein eigenes setInterval, aber falls der Server
#    frisch gestartet/gehangen hat, garantiert das hier den Lauf). 2) Prüft Server + Tunnel und
#    pingt via Telegram, wenn etwas down ist (max. 1 Ping pro 6h, Marker-Datei).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKER="$ROOT/dashboard/data/.wa-heartbeat-alerted"
alert() {
  if [ -f "$MARKER" ] && [ $(( $(date +%s) - $(stat -f %m "$MARKER") )) -lt 21600 ]; then return; fi
  touch "$MARKER"
  /usr/local/bin/node "$ROOT/dashboard/notify.js" --title "🟢 WA-Modul" "$1"
}

# Server erreichbar?
if ! curl -s --max-time 5 http://127.0.0.1:4321/api/wa/threads >/dev/null 2>&1; then
  alert "Dashboard-Server down — WhatsApp-Ticks und Webhook laufen nicht. (daily-run/ensure_dashboard startet ihn beim nächsten Lauf, oder manuell: node dashboard/server.js)"
  exit 0
fi

# Tick anstoßen (idempotent; Antwort loggen)
TICK="$(curl -s --max-time 290 -X POST http://127.0.0.1:4321/api/wa/tick)"
echo "$(date '+%F %T') tick: $TICK"

# Tunnel-Prozess prüfen (nur wenn Webhook-Host konfiguriert)
HOST="$(/usr/local/bin/node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).whatsapp.webhookHost||"")}catch(e){console.log("")}' "$ROOT/dashboard/data/settings.json")"
if [ -n "$HOST" ]; then
  if ! pgrep -f "ngrok http 4321" >/dev/null 2>&1; then
    alert "ngrok-Tunnel läuft nicht — eingehende WhatsApp-Nachrichten kommen nicht an. launchd com.jarvis.wa-tunnel prüfen."
  elif ! curl -s --max-time 10 -o /dev/null -w "%{http_code}" "https://$HOST/webhooks/wa" | grep -q "403\|405"; then
    # 403 (ohne Token) ist die ERWARTETE Antwort — alles andere heißt: Tunnel kaputt geroutet
    alert "Webhook über https://$HOST/webhooks/wa nicht erreichbar (Tunnel up, aber Route kaputt?)."
  else
    rm -f "$MARKER" 2>/dev/null
  fi
fi
exit 0
