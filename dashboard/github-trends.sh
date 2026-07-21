#!/bin/bash
# Jarvis — tägliche GitHub/AI-Trend-Recherche für AIOS (launchd, 08:00).
# Recherchiert die neuesten Claude-Code-/AI-Skills & Tools, schreibt eine Notiz ins Brain
# und pingt der Nutzer per Telegram. Läuft über die Claude-Subscription (claude -p, kein API-Geld).
ROOT="$HOME/AIOS"
LOG="$ROOT/dashboard/github-trends.log"
DATE=$(date '+%Y-%m-%d')
cd "$ROOT" || exit 1
echo "=== $(date '+%F %T') github-trends start ===" >> "$LOG"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
source "$ROOT/dashboard/claude-bin.sh"
CLAUDE="$CLAUDE_BIN"
if [ -z "$CLAUDE" ] || [ ! -x "$CLAUDE" ]; then
  echo "FEHLER: claude-Binary nicht gefunden — Abbruch" >> "$LOG"
  node "$ROOT/dashboard/notify.js" --title "⚠️ GitHub-Trends" "Abbruch: claude-CLI nicht gefunden (App-Update?)." >> "$LOG" 2>&1
  exit 1
fi

PROMPT="Tägliche GitHub-/AI-Trend-Recherche für AIOS (des Nutzers persönliches Business-OS). Recherchiere per WebSearch die neuesten & trendenden Claude-Code-Skills, AI-Agent-Skills/Plugins und AI-Dev-Tools der letzten ~7 Tage (GitHub trending, Repos mit Momentum/Stars). Wähle die 3-5 spannendsten aus. Für jeden: Repo/Name, 1 Satz was es macht, Stars/Momentum, warum relevant fürs Business-OS (Finance/Outreach/Brain/Marketing/Agents). Schreibe das Ergebnis als NEUE Notiz nach brain/09_Coding-Ideen/github-trends-$DATE.md mit YAML-Frontmatter (type: coding-idee, tags: [coding-idee, github-trends], created: $DATE). Knapp & umsetzbar — Alex will daraus Videos machen und Skills selbst installieren/ausprobieren. Antworte am ENDE mit EINER kurzen Zusammenfassung: die Top-3 als Stichpunkte."

OUT=$("$CLAUDE" -p "$PROMPT" --allowedTools "WebSearch WebFetch Read Write Bash Glob Grep" --permission-mode acceptEdits 2>>"$LOG")
echo "$OUT" >> "$LOG"

SUMMARY=$(echo "$OUT" | tail -5)
[ -n "$SUMMARY" ] && node "$ROOT/dashboard/notify.js" --title "🔎 GitHub-Trends" "$SUMMARY" >> "$LOG" 2>&1
echo "=== fertig $(date '+%T') ===" >> "$LOG"
