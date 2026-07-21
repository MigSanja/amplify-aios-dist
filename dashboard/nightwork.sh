#!/bin/bash
# Jarvis — Nacht-Werker: autonome Nächte. launchd com.jarvis.nightwork, täglich 23:30.
# (23:30 bewusst: Heartbeat endet 19:15, obsidian-nightly 22:00 ist durch, Backup 03:30 —
#  mit 90-Min-Budget endet der Lauf spätestens ~01:00, nie parallel zum Backup.)
# Nimmt sich pro Lauf GENAU EINEN offenen 🤖-Punkt:
#   Prio 1: brain/03_Projects/aios-audit-fixes.md (unerledigte 🤖-Fixes)
#   Prio 2: brain/07_Tasks/tasks.md (nur Sektion 🎯 Signal)
# Reine 🤖-Punkte — Zeilen mit 👤/🧑‍💻/👥 oder ⏸ (wartet auf Alex) werden NIE genommen.
# Arbeitet den Punkt nach der aios-pr-review-SOP ab, hakt ihn in der Quelldatei ab
# (Pflicht), committet lokal (kein Push). Blocker → Telegram-Ping via notify.js statt raten.
# PROVIDER (Runner-Pilot): 'claude' (Subscription-CLI, Default) | 'codex' (OpenAI-$20-Sub via
#   codex exec — spart Claude-Tokens). Auswahl: data/runner-profiles.json → "nightwork" (launchd
#   reicht keine Args durch); manuell/Test überschreibbar mit  --provider codex. Codex braucht einmal
#   'npm i -g @openai/codex' + 'codex login'. Details/Findings: brain/03_Projects/codex-integration.md
# Historie: dashboard/data/nightwork-runs.jsonl (Feld 'provider') · Log: dashboard/nightwork.log.
# Test ohne Lauf:  bash dashboard/nightwork.sh --dry-run   (zeigt Provider + Task-Auswahl)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.claude/local"

ROOT="$HOME/AIOS"
LOG="$ROOT/dashboard/nightwork.log"
LOCK="$ROOT/dashboard/data/nightwork.lock"
RUNS="$ROOT/dashboard/data/nightwork-runs.jsonl"
PROFILES="$ROOT/dashboard/data/runner-profiles.json"
CODEX_MODEL="gpt-5.5"
CODEX_ACCOUNT_MODEL_ERROR="not supported when using Codex with a ChatGPT account"
DRY=0; PROVIDER_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --provider) shift; PROVIDER_ARG="$1" ;;
    --provider=*) PROVIDER_ARG="${1#*=}" ;;
  esac
  shift
done
cd "$ROOT" || exit 1
mkdir -p "$ROOT/dashboard/data"

# --- Provider-Auflösung: Arg (nur manuell/Test) > runner-profiles.json > "claude" ---
# run-job.js reicht bei launchd keine Args durch → für den Nachtlauf zaehlt NUR die JSON.
PROVIDER="$PROVIDER_ARG"
if [ -z "$PROVIDER" ] && [ -f "$PROFILES" ]; then
  PROVIDER=$(node -e 'try{const p=require(process.argv[1]);process.stdout.write(String(p.nightwork||""))}catch(e){}' "$PROFILES" 2>/dev/null)
fi
[ -z "$PROVIDER" ] && PROVIDER="claude"

# Überlappungsschutz (Muster heartbeat.sh): Lock jünger als 100 Min → anderer Lauf aktiv, leise raus.
if [ "$DRY" -eq 0 ] && [ -f "$LOCK" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || echo 0) ))
  [ "$AGE" -lt 6000 ] && exit 0
fi
[ "$DRY" -eq 0 ] && { touch "$LOCK"; trap 'rm -f "$LOCK"' EXIT; }

# --- Task-Auswahl: erster offener reiner 🤖-Punkt, Prio 1 vor Prio 2 ---
pick_task() { # $1 = Datei, $2 = 1 → nur Sektion "## 🎯 Signal"
  awk -v sig="$2" '
    sig=="1" && /^## /   { insig = ($0 ~ /🎯 Signal/) }
    sig=="1" && !insig   { next }
    /^- \[ \]/ && /🤖/ && !/👤/ && !/🧑‍💻/ && !/👥/ && !/⏸/ { print; exit }
  ' "$1" 2>/dev/null
}
SRC="brain/03_Projects/aios-audit-fixes.md"
TASK=$(pick_task "$SRC" 0)
if [ -z "$TASK" ]; then SRC="brain/07_Tasks/tasks.md"; TASK=$(pick_task "$SRC" 1); fi

if [ "$DRY" -eq 1 ]; then
  echo "DRY-RUN: Provider = $PROVIDER"
  if [ -z "$TASK" ]; then echo "DRY-RUN: kein offener 🤖-Punkt → Lauf wäre IDLE"; else echo "DRY-RUN: würde arbeiten an [$SRC]:"; echo "  $TASK"; fi
  exit 0
fi

echo "=== $(date '+%F %T') nightwork start (Provider: $PROVIDER) ===" >> "$LOG"
if [ -z "$TASK" ]; then
  echo "IDLE: kein offener 🤖-Punkt in $SRC / tasks.md (Signal)" >> "$LOG"
  node -e 'const fs=require("fs");fs.appendFileSync(process.argv[1],JSON.stringify({start:Math.floor(Date.now()/1000),end:Math.floor(Date.now()/1000),ok:true,src:"",task:"",report:"IDLE"})+"\n");' "$RUNS" 2>>"$LOG"
  exit 0
fi
echo "Task [$SRC]: $TASK" >> "$LOG"

PROMPT="Du bist Jarvis im NACHT-WERKER-Lauf (autonom, der Nutzer schläft, niemand schaut zu).
Arbeite nach der SOP .claude/skills/aios-pr-review/SKILL.md und den Karpathy-Regeln aus CLAUDE.md:
surgical changes — NUR ändern, was der Punkt verlangt; kein Gold-Plating; Node-Stdlib bleibt Node-Stdlib.

DEIN EINZIGER AUFTRAG heute Nacht ist dieser Punkt aus $SRC:
$TASK

Regeln:
1. Arbeite NUR diesen einen Punkt. Ist er groß: ein sauber abgeschlossenes Teilstück, Fortschritt im Task-Text vermerken.
2. Verifikation nach SOP: node --check / bash -n / plutil -lint auf alles Geänderte; server.js-Binding bleibt 127.0.0.1.
3. JSON-Writes nur über dashboard/atomic-write.js. Keine Secrets in Code, Brain oder Logs.
4. DOKU-PFLICHT im selben Durchgang: technische Änderung → SYSTEM.md nachziehen (+ Datum oben); neues Bauteil → brain/03_Projects/aios-produkt.md; Modul-Status → brain/03_Projects/aios-work-map.md.
5. PFLICHT danach: den Punkt in $SRC abhaken ('- [x]') bzw. Fortschritt im Task-Text vermerken, mit Kurznotiz '(Nachtlauf $(date '+%d.%m.'))'. Erledigt-aber-nicht-abgehakt ist ein Fehler.
6. Danach lokal committen (NIE pushen): git add <nur deine geänderten Dateien> und git commit mit kurzer Message. Nichts Fremdes stagen.
7. Blocker oder echte Frage an der Nutzer? NICHT raten, NICHT still überspringen: Punkt mit '⏸ wartet auf Alex: <Grund>' markieren + GENAU EIN Ping: Bash: node dashboard/notify.js --title \"🌙 Nacht-Werker\" \"<kurze Frage/Blocker>\". Sparsam.
8. WIN erkannt (Deal geclosed, Termin gebucht, Zahlung eingegangen)? Dann FEIERN, nicht nur vermerken: GENAU EIN Ping, kleiner Win kurz, Close groß mit Glocke: Bash: node dashboard/notify.js --title \"🔔 Win\" \"<Glückwunsch>\". Sparsam (ein Ping pro Win).
9. Antworte am Ende NUR mit einem Kurz-Report (max. 6 Zeilen, Deutsch):
Zeile 1: 'ERLEDIGT:' oder 'TEIL:' oder 'BLOCKER:' + Punkt-Kurzname; danach stichpunktartig: geänderte Dateien, Verifikation, was offen ist."

START_TS=$(date +%s)
ALERT_SENT=0
# 90-Min-Zeitbudget: perl-alarm als portabler timeout(1)-Ersatz (macOS hat kein timeout/gtimeout;
# alarm überlebt exec, SIGALRM beendet dann den Runner-Prozess → Exit 142).
if [ "$PROVIDER" = "codex" ]; then
  # --- Codex-Pilot: headless über die ChatGPT-Sub, spart Claude-Tokens (Token-Crunch bis 08.07.) ---
  source "$ROOT/dashboard/codex-bin.sh"
  if [ -z "$CODEX_BIN" ] || [ ! -x "$CODEX_BIN" ]; then
    echo "FEHLER: codex-Binary nicht gefunden (codex-bin.sh)" >> "$LOG"
    node "$ROOT/dashboard/notify.js" --title "🌙 Nacht-Werker" "Codex-CLI nicht gefunden (Provider=codex) — Nachtlauf abgebrochen. Fix: 'npm i -g @openai/codex' + einmal 'codex login'." >> "$LOG" 2>&1
    exit 1
  fi
  REPORT_FILE="$ROOT/dashboard/data/nightwork-codex-report.txt"; rm -f "$REPORT_FILE"
  # codex exec = nicht-interaktiv (fragt nie). danger-full-access nötig für Bash/git/notify.js
  # (eigener Mac, eigenes Repo — bewusster Tradeoff, Parität zu Claude-Bash). --skip-git-repo-check
  # unkritisch (ROOT IST ein Repo). Flags-Stand OpenAI-Docs 07/2026 — beim ersten echten Lauf prüfen.
  # Modell aus ~/.codex/models_cache.json (19.07.2026): gpt-5.5 ist fuer des Nutzers
  # ChatGPT-Codex-Account sichtbar; gpt-5.1-codex-max lieferte 09.-15.07. invalid_request_error.
  LOG_BYTES_BEFORE=$(wc -c < "$LOG" 2>/dev/null || echo 0)
  LAST_CODEX_ACCOUNT_MODEL_ERROR=$(grep -F "$CODEX_ACCOUNT_MODEL_ERROR" "$LOG" 2>/dev/null | tail -n 1)
  perl -e 'alarm shift @ARGV; exec @ARGV or die "exec fehlgeschlagen: $!\n"' 5400 \
    "$CODEX_BIN" exec --sandbox danger-full-access --skip-git-repo-check --cd "$ROOT" \
    -m "$CODEX_MODEL" \
    --output-last-message "$REPORT_FILE" "$PROMPT" >> "$LOG" 2>&1
  RC=$?
  OUT=$(cat "$REPORT_FILE" 2>/dev/null)
  NEW_CODEX_ACCOUNT_MODEL_ERROR=$(tail -c +"$((LOG_BYTES_BEFORE + 1))" "$LOG" 2>/dev/null | grep -F "$CODEX_ACCOUNT_MODEL_ERROR" | tail -n 1)
  if [ "$RC" -ne 0 ] && [ -n "$NEW_CODEX_ACCOUNT_MODEL_ERROR" ] && { [ -z "$LAST_CODEX_ACCOUNT_MODEL_ERROR" ] || [ "$NEW_CODEX_ACCOUNT_MODEL_ERROR" = "$LAST_CODEX_ACCOUNT_MODEL_ERROR" ]; }; then
    echo "HARTER CODEX-MODELLFEHLER rc=$RC: $NEW_CODEX_ACCOUNT_MODEL_ERROR" >> "$LOG"
    node "$ROOT/dashboard/notify.js" --title "🌙 Nacht-Werker" "Codex-Modellfehler wiederholt: $NEW_CODEX_ACCOUNT_MODEL_ERROR" >> "$LOG" 2>&1
    ALERT_SENT=1
  fi
else
  # --- Claude (Default): Subscription-CLI ---
  source "$ROOT/dashboard/claude-bin.sh"
  if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then
    echo "FEHLER: claude-Binary nicht gefunden (claude-bin.sh)" >> "$LOG"
    node "$ROOT/dashboard/notify.js" --title "🌙 Nacht-Werker" "Claude-CLI nicht gefunden — Nachtlauf abgebrochen." >> "$LOG" 2>&1
    exit 1
  fi
  OUT=$(perl -e 'alarm shift @ARGV; exec @ARGV or die "exec fehlgeschlagen: $!\n"' 5400 \
    "$CLAUDE_BIN" -p "$PROMPT" --model claude-sonnet-5 --allowedTools "Read" "Glob" "Grep" "Edit" "Write" "Bash" --max-turns 150 2>>"$LOG")
  RC=$?
fi
echo "$OUT" >> "$LOG"
if [ "$RC" -eq 142 ]; then
  echo "TIMEOUT: 90-Min-Budget erreicht" >> "$LOG"
  node "$ROOT/dashboard/notify.js" --title "🌙 Nacht-Werker" "90-Min-Budget erreicht — Punkt evtl. unfertig: $(echo "$TASK" | head -c 140)" >> "$LOG" 2>&1
elif [ "$RC" -ne 0 ] && [ -z "$OUT" ] && [ "$ALERT_SENT" -eq 0 ]; then
  # Harter Fehler ohne Report (z.B. Codex invalid_request_error) — NIE still sterben lassen (Fall 09.-15.07.)
  ERRTAIL=$(tail -n 3 "$LOG" 2>/dev/null | tr '\n' ' ' | head -c 200)
  echo "HARTER FEHLER rc=$RC ohne Report ($PROVIDER)" >> "$LOG"
  node "$ROOT/dashboard/notify.js" --title "🌙 Nacht-Werker" "Nachtlauf ($PROVIDER) hart abgebrochen, rc=$RC, kein Report. Log: $ERRTAIL" >> "$LOG" 2>&1
fi
# Run-Historie: eine JSON-Zeile pro Lauf (Muster heartbeat-runs.jsonl)
node -e 'const fs=require("fs");const rec={start:+process.argv[1]||0,end:Math.floor(Date.now()/1000),ok:process.argv[2]==="0",provider:process.argv[7]||"claude",src:process.argv[5]||"",task:String(process.argv[6]||"").slice(0,300),report:String(process.argv[3]||"").slice(0,2000)};fs.appendFileSync(process.argv[4],JSON.stringify(rec)+"\n");' "$START_TS" "$RC" "$OUT" "$RUNS" "$SRC" "$TASK" "$PROVIDER" 2>>"$LOG"
echo "=== fertig $(date '+%T') rc=$RC ===" >> "$LOG"
