#!/bin/bash
# wa-tunnel.sh — ngrok-Tunnel für den WhatsApp-Webhook (Meta braucht öffentliches HTTPS).
# Läuft als launchd-Job com.jarvis.wa-tunnel (KeepAlive). Exponiert NUR das Dashboard auf 4321.
# SELBSTHEILEND (11.07.): braucht KEINE statische Domain mehr. Ablauf bei jedem Start:
#   1. ngrok starten — mit statischer Domain aus settings.json (whatsapp.webhookHost), falls
#      gesetzt; sonst mit Zufalls-URL (Free-Plan, kein Dashboard-Login nötig).
#   2. Öffentliche URL aus der lokalen ngrok-API (127.0.0.1:4040) lesen.
#   3. URL als Webhook bei Meta anmelden (App-Token = APP_ID|APP_SECRET, Graph /subscriptions
#      inkl. Verify-Handshake + Felder messages/message_template_status_update).
# Damit überlebt der Webhook Neustarts auch mit wechselnder Zufalls-URL.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_ID="${WA_APP_ID}"
HOST="$(/usr/local/bin/node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).whatsapp.webhookHost||"")}catch(e){console.log("")}' "$ROOT/dashboard/data/settings.json")"

ARGS=(http 4321 --log=stdout --log-level=warn)
if [ -n "$HOST" ]; then
  echo "$(date '+%F %T') wa-tunnel: statische Domain $HOST"
  ARGS+=(--url="https://$HOST")
else
  echo "$(date '+%F %T') wa-tunnel: keine statische Domain — Zufalls-URL + Auto-Registrierung"
fi

/usr/local/bin/ngrok "${ARGS[@]}" &
NGROK_PID=$!
trap 'kill "$NGROK_PID" 2>/dev/null' EXIT TERM INT

# Auf Tunnel warten und öffentliche URL holen
URL=""
for _ in $(seq 1 30); do
  sleep 1
  URL="$(curl -sf http://127.0.0.1:4040/api/tunnels 2>/dev/null | /usr/local/bin/node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).tunnels[0]||{}).public_url||"")}catch(e){console.log("")}})')"
  [ -n "$URL" ] && break
done
if [ -z "$URL" ]; then
  echo "$(date '+%F %T') wa-tunnel: Tunnel kam nicht hoch (ngrok-Log oben) — Neustart via launchd"
  exit 1
fi
echo "$(date '+%F %T') wa-tunnel: Tunnel aktiv → $URL → 127.0.0.1:4321"

# Webhook bei Meta (re-)registrieren — Meta verifiziert dabei sofort gegen den Tunnel
APP_SECRET="$(grep '^WA_APP_SECRET=' "$ROOT/.env" | cut -d= -f2- | tr -d '\r')"
VERIFY="$(grep '^WA_VERIFY_TOKEN=' "$ROOT/.env" | cut -d= -f2- | tr -d '\r')"
if [ -n "$APP_SECRET" ] && [ -n "$VERIFY" ]; then
  OK=""
  for _ in 1 2 3; do
    RES="$(curl -sf -X POST "https://graph.facebook.com/v25.0/$APP_ID/subscriptions" \
      --data-urlencode "object=whatsapp_business_account" \
      --data-urlencode "callback_url=$URL/webhooks/wa" \
      --data-urlencode "verify_token=$VERIFY" \
      --data-urlencode "fields=messages,message_template_status_update" \
      --data-urlencode "access_token=$APP_ID|$APP_SECRET")" && OK=1 && break
    sleep 5
  done
  if [ -n "$OK" ]; then
    echo "$(date '+%F %T') wa-tunnel: Webhook bei Meta registriert ($RES)"
  else
    echo "$(date '+%F %T') wa-tunnel: Webhook-Registrierung FEHLGESCHLAGEN"
    /usr/local/bin/node "$ROOT/dashboard/notify.js" --title "🟢 WA-Tunnel" "Webhook-Registrierung bei Meta fehlgeschlagen. Tunnel läuft auf $URL, aber Meta kennt die URL evtl. nicht." 2>/dev/null
  fi
else
  echo "$(date '+%F %T') wa-tunnel: WA_APP_SECRET/WA_VERIFY_TOKEN fehlen in .env — keine Auto-Registrierung"
fi

wait "$NGROK_PID"
