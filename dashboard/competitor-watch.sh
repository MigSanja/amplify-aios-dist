#!/bin/bash
# Jarvis — Competitor Watch (launchd, täglich 08:30). Scrapt via Apify die US-Accounts der
# Beobachtungsliste (data/competitor-watch.json), macht daraus deutsche Post-Ideen und legt
# sie als quelle "research" in den Ideen-Feed der Content-Pipeline. Logik: competitor-watch.js
ROOT="$HOME/AIOS"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$ROOT" || exit 1

# Dashboard-Server muss laufen (Ideen gehen über /api/content-idea-add) — sonst kurz warten/starten
if ! curl -s --max-time 3 http://localhost:4321/api/content-pipeline >/dev/null 2>&1; then
  echo "Dashboard down → starte" >> "$ROOT/dashboard/competitor-watch.log"
  CB="$(command -v claude || echo "")"
  CLAUDE_BIN="$CB" nohup node "$ROOT/dashboard/server.js" >> "$ROOT/dashboard/server.local.log" 2>&1 &
  disown
  sleep 6
fi

node "$ROOT/dashboard/competitor-watch.js"
