#!/bin/bash
cd "$HOME/AIOS" || exit 1
source "$HOME/AIOS/dashboard/claude-bin.sh"
echo "Starte Claude Remote Control (Handy-Fernsteuerung)..."
echo "Fenster offen lassen. Zum Beenden: Ctrl+C."
exec "$CLAUDE_BIN" --remote-control Jarvis-Mac
