#!/bin/bash
# Jarvis — Heartbeat: autonomer Arbeits-Puls. launchd, stündlich 09–19 Uhr (:15).
# Nimmt sich pro Lauf GENAU EINEN offenen 🤖-Task aus brain/07_Tasks/tasks.md,
# arbeitet ihn ab, hakt ihn ab. Bei Blocker/Frage: Telegram-Ping statt still überspringen.
# Sichtbarkeit: dashboard/data/heartbeat-status.json + dashboard/heartbeat.log.
# Läuft über die Claude-Subscription (claude -p via claude-bin.sh, kein API-Geld).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.claude/local"

ROOT="$HOME/AIOS"
LOG="$ROOT/dashboard/heartbeat.log"
STATUS="$ROOT/dashboard/data/heartbeat-status.json"
LOCK="$ROOT/dashboard/data/heartbeat.lock"
cd "$ROOT" || exit 1
mkdir -p "$ROOT/dashboard/data"

# Überlappungsschutz: Lock jünger als 55 Min → anderer Lauf aktiv, leise raus.
if [ -f "$LOCK" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || echo 0) ))
  [ "$AGE" -lt 3300 ] && exit 0
fi
touch "$LOCK"; trap 'rm -f "$LOCK"' EXIT

echo "=== $(date '+%F %T') heartbeat start ===" >> "$LOG"
# Status-Writes atomar (Audit-Fix 2): tmp + mv, der Server liest die Datei parallel.
echo "{\"running\":true,\"started\":$(date +%s)}" > "$STATUS.tmp" && mv -f "$STATUS.tmp" "$STATUS"

source "$ROOT/dashboard/claude-bin.sh"
if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then
  echo "FEHLER: claude-Binary nicht gefunden" >> "$LOG"
  echo "{\"running\":false,\"last\":$(date +%s),\"ok\":false,\"note\":\"claude-CLI fehlt\"}" > "$STATUS.tmp" && mv -f "$STATUS.tmp" "$STATUS"
  exit 1
fi

PROMPT="Du bist Jarvis im HEARTBEAT-Lauf (autonom, niemand schaut zu). Arbeite nach den Karpathy-Regeln aus CLAUDE.md: klein, chirurgisch, kein Gold-Plating.

1. Lies brain/07_Tasks/tasks.md.
2. Wähle GENAU EINEN offenen Task ('- [ ]'), der mit 🤖 markiert ist UND ohne Rückfrage komplett machbar ist (Wissen/Dateien im Repo bzw. Brain reichen). Bevorzugt: der oberste passende in Signal.
3. Arbeite ihn VOLLSTÄNDIG ab. Micro halten: wenn der Task groß ist, erledige ein klar abgeschlossenes Teilstück und vermerke den Fortschritt im Task-Text.
4. Danach PFLICHT: den Task in tasks.md abhaken ('- [x]') bzw. Fortschritt vermerken, mit Kurznotiz '(Heartbeat $(date '+%d.%m.'))'. Ein erledigter, nicht abgehakter Task ist ein Fehler.
5. Blocker oder echte Frage an der Nutzer? NICHT still überspringen, NICHT raten: markiere den Task mit '⏸ wartet auf Alex: <Grund>' und sende GENAU EINEN Telegram-Ping: Bash: node dashboard/notify.js --title \"🫀 Heartbeat\" \"<kurze Frage/Blocker>\". Sparsam — nur wenn wirklich nötig.
6. Kein 🤖-Task offen oder keiner autonom machbar? Dann NICHTS tun außer einer Log-Zeile — keine Tasks erfinden, keine anderen Dateien anfassen.
7. Dokumentiere NUR den Outcome im Brain (Task-Vermerk in tasks.md reicht meist) — nie den ganzen Verlauf, kein Spam.
8. Antworte am Ende AUSSCHLIESSLICH mit einem Kurz-Report (max. 5 Zeilen, Deutsch):
Zeile 1: 'ERLEDIGT: <task>' oder 'TEIL: <task>' oder 'BLOCKER: <task>' oder 'IDLE'
danach stichpunktartig: was konkret gemacht/geändert wurde (Dateien/Ergebnis) und was ggf. offen ist. Dieser Report wird der Nutzer im Dashboard angezeigt."

START_TS=$(date +%s)
OUT=$("$CLAUDE_BIN" -p "$PROMPT" --model claude-haiku-4-5 --allowedTools "Read" "Glob" "Grep" "Edit" "Write" "Bash(node:*)" --max-turns 40 2>>"$LOG")
RC=$?
echo "$OUT" >> "$LOG"
LAST=$(echo "$OUT" | head -1 | head -c 200 | sed 's/"/\\"/g')
echo "{\"running\":false,\"last\":$(date +%s),\"ok\":$([ $RC -eq 0 ] && echo true || echo false),\"note\":\"$LAST\"}" > "$STATUS.tmp" && mv -f "$STATUS.tmp" "$STATUS"
# Run-Historie für das Dashboard (Copilot → Autoruns): eine JSON-Zeile pro Lauf.
node -e 'const fs=require("fs");const rec={start:+process.argv[1]||0,end:Math.floor(Date.now()/1000),ok:process.argv[2]==="0",report:String(process.argv[3]||"").slice(0,2000)};fs.appendFileSync(process.argv[4],JSON.stringify(rec)+"\n");' "$START_TS" "$RC" "$OUT" "$ROOT/dashboard/data/heartbeat-runs.jsonl" 2>>"$LOG"
echo "=== fertig $(date '+%T') rc=$RC ===" >> "$LOG"
