#!/bin/bash
# Jarvis — Runner wieder anschalten (nach Token-Crunch 04.–08.07.2026).
# Am 04.07. wurden 5 Claude-fressende launchd-Jobs pausiert (bootout), um das
# Wochen-Kontingent bis zum Reset am 08.07. zu schonen. Dieses Skript holt sie zurück.
# Aufruf:  bash ~/AIOS/dashboard/runners-resume.sh
U=$(id -u)
LA="$HOME/Library/LaunchAgents"
# upwork-scan bewusst NICHT hier: bleibt aus, bis Alex wieder Upwork-Outreach macht
# (04.07. entkoppelt). Manuell an:  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jarvis.upwork-scan.plist
# Läuft dann nur Mo–Fr 08:00 (Plist-Weekday 1–5). ToDo dazu: brain/07_Tasks/tasks.md.
JOBS=(heartbeat nightwork obsidian-nightly github-trends)
echo "=== Runner wieder anschalten ($(date '+%F %T')) ==="
for J in "${JOBS[@]}"; do
  P="$LA/com.jarvis.$J.plist"
  if [ -f "$P" ]; then
    launchctl bootstrap gui/$U "$P" 2>&1 && echo "an: com.jarvis.$J" || echo "FEHLER (evtl. schon an): com.jarvis.$J"
  else
    echo "PLIST FEHLT: $P"
  fi
done
echo "--- aktive com.jarvis-Jobs:"
launchctl list | grep com.jarvis | awk '{print $3}' | sort
echo ""
echo "WICHTIG danach: Heartbeat + Nacht-Werker VOR dem Anschalten auf ein günstigeres"
echo "Modell pinnen (--model claude-haiku-4-5 für Heartbeat, claude-sonnet-4-5 für Nacht-Werker),"
echo "damit sie nicht wieder den CLI-Default (= aktuell gewähltes Top-Modell) erben. Siehe now.md."
