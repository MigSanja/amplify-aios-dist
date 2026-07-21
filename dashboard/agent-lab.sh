#!/bin/bash
# Jarvis — Agent-Lab: der Agent, dessen Job die anderen Agenten sind.
# launchd com.jarvis.agent-lab, täglich 01:30 (nach dem Nacht-Werker 23:30 + 90-Min-Budget,
# vor dem Backup 03:30 — so liest er die Läufe der Nacht schon mit und kollidiert mit nichts).
#
# Was er tut: liest die ECHTEN Läufe aller Agenten (runs/, Trails, learnings.md, Job-Historie)
# und legt max. 3 belegte Verbesserungs-Vorschläge an. Er ändert KEINE Agent-Datei.
# Freigabe: Telegram-Buttons (08:30, guardrail-morning) oder Dashboard → Org · Agents.
# Freigegeben → Task wandert nach brain/03_Projects/aios-audit-fixes.md → Nacht-Werker führt aus.
#
# Regelwerk: agents/agent-lab/agent.md · Empfehlungen: dashboard/data/agent-lab-recs.json
# Schreibweg: NUR node dashboard/agent-lab-add.js (Single-Writer) · Log: dashboard/agent-lab.log
# Historie: dashboard/data/agent-lab-runs.jsonl
# Test ohne Lauf:  bash dashboard/agent-lab.sh --dry-run   (zeigt Agenten + Kontext-Umfang)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.claude/local"

ROOT="$HOME/AIOS"
LOG="$ROOT/dashboard/agent-lab.log"
LOCK="$ROOT/dashboard/data/agent-lab.lock"
RUNS="$ROOT/dashboard/data/agent-lab-runs.jsonl"
RECS="$ROOT/dashboard/data/agent-lab-recs.json"
DRY=0
[ "$1" = "--dry-run" ] && DRY=1
cd "$ROOT" || exit 1
mkdir -p "$ROOT/dashboard/data"

# Überlappungsschutz (Muster nightwork.sh): Lock jünger als 60 Min → anderer Lauf aktiv, leise raus.
if [ "$DRY" -eq 0 ] && [ -f "$LOCK" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || echo 0) ))
  [ "$AGE" -lt 3600 ] && exit 0
fi
[ "$DRY" -eq 0 ] && { touch "$LOCK"; trap 'rm -f "$LOCK"' EXIT; }

# --- Zu prüfende Agenten: alle mit agent.md, außer sich selbst (kein Selbstbezug) ---
TARGETS=$(for d in "$ROOT"/agents/*/; do
  n=$(basename "$d")
  [ "$n" = "agent-lab" ] && continue
  [ -f "$d/agent.md" ] && echo "$n"
done | tr '\n' ' ')

OFFEN=$(node -e 'try{const d=require(process.argv[1]);process.stdout.write(String((d.recs||[]).filter(r=>r.status==="offen").length))}catch(e){process.stdout.write("0")}' "$RECS" 2>/dev/null)
[ -z "$OFFEN" ] && OFFEN=0

if [ "$DRY" -eq 1 ]; then
  echo "DRY-RUN: prüft diese Agenten: $TARGETS"
  echo "DRY-RUN: offene Empfehlungen aktuell: $OFFEN"
  echo "DRY-RUN: Empfehlungen würden nach $RECS geschrieben (via agent-lab-add.js)"
  exit 0
fi

# Stau-Bremse: liegen schon 3+ unentschiedene Vorschläge, macht ein vierter niemanden schlauer.
if [ "$OFFEN" -ge 3 ]; then
  echo "=== $(date '+%F %T') agent-lab SKIP: $OFFEN offene Empfehlungen warten auf der Nutzer ===" >> "$LOG"
  node -e 'const fs=require("fs");const t=Math.floor(Date.now()/1000);fs.appendFileSync(process.argv[1],JSON.stringify({start:t,end:t,ok:true,neu:0,report:"SKIP: "+process.argv[2]+" offene Empfehlungen"})+"\n");' "$RUNS" "$OFFEN" 2>>"$LOG"
  exit 0
fi

echo "=== $(date '+%F %T') agent-lab start (Agenten: $TARGETS) ===" >> "$LOG"

PROMPT="Du bist das AGENT-LAB in des Nutzers Jarvis-OS (autonomer Nachtlauf, niemand schaut zu).
Dein Regelwerk steht in agents/agent-lab/agent.md — lies es ZUERST und halte dich strikt daran.

DEIN AUFTRAG: Finde heraus, wo die anderen Agenten schlechter arbeiten als sie könnten, und
schlage maximal DREI belegte Verbesserungen vor. Zu prüfende Agenten: $TARGETS

So gehst du vor:
1. Lies agents/agent-lab/agent.md (dein Regelwerk) und agents/CLAUDE.md (die harten Agent-Regeln,
   gegen die du prüfst: Freunde-Schutz, kanalübergreifende De-Dupe, max. 2 Follow-ups,
   Browser-Disziplin, Schreibstil ohne Em-Dashes).
2. Lies pro Agent die ECHTEN Läufe der letzten 7 Tage: agents/<id>/runs/*.md (neueste zuerst),
   agents/<id>/learnings.md, agents/<id>/agent.md, agents/<id>/playbooks/*.md, config.json.
   Dazu systemweit die Job-Historie: dashboard/data/nightwork-runs.jsonl,
   dashboard/data/heartbeat-runs.jsonl, dashboard/data/notifications-log.jsonl.
   Lies gezielt, kein Voll-Scan. Kein Research-Feed, keine AI-Papers — nur echte Läufe.
3. Suche nach diesen Mustern (Reihenfolge = Priorität):
   a) Learning steht in learnings.md, ist aber nie ins Playbook/agent.md nachgezogen worden.
   b) Derselbe Fehler/Blocker/Abbruch tauchte >=2x in 7 Tagen auf → Regel-Loch, nicht Pech.
   c) Widerspruch: agent.md sagt A, Playbook sagt B — oder ein Lauf verstieß gegen agents/CLAUDE.md.
   d) Agent ist überladen (zu viele Zuständigkeiten/Playbooks) und gehört gesplittet.
   e) Playbook-Schritte, die seit Wochen nie ausgeführt wurden (toter Ballast).
   f) Agent hat X Tage nichts geliefert, ohne dass es jemandem aufgefallen ist.
4. Lege JEDEN Fund per Bash so an (das ist dein EINZIGER Schreibweg):
   node dashboard/agent-lab-add.js '{\"agent\":\"<id>\",\"titel\":\"<eine Zeile>\",\"befund\":\"<was belegt ist, mit Datei + Datum>\",\"fix\":\"<welche Datei wie ändern>\",\"schwere\":\"hoch|mittel|niedrig\"}'
   Das Skript de-dupliziert selbst — 'SKIP' heißt, der Vorschlag lag schon mal vor (evtl. abgelehnt).
   Dann NICHT umformulieren, um ihn durchzudrücken. Abgelehnt bleibt abgelehnt.

HARTE REGELN:
- NUR VORSCHLAGEN, NIE ÄNDERN. Du fasst keine Agent-Datei an, kein Edit, kein Write, kein git commit.
  Dein einziger Write ist agent-lab-add.js. Wer ausführt, entscheidet der Nutzer.
- BELEG ODER NICHTS. Jeder Befund nennt Datei + Datum aus einem echten Lauf. Keine Vermutung,
  keine 'könnte man auch'-Idee. Findest du nichts Belegtes: leg NICHTS an. Null ist ein gutes Ergebnis.
- MAX 3. Die drei mit dem größten Hebel. Lieber ein präziser Fund als drei schwammige.
- Der Fix muss konkret sein: welche Datei, welche Zeile/Regel, was soll dort stehen.
- Keine Em-Dashes (— oder –) in Titel/Befund/Fix.
- Bewerte dich NICHT selbst (agent-lab ist ausgenommen).
- Keine Secrets in Befund/Fix/Log.

Antworte am Ende NUR mit einem Kurz-Report (max. 5 Zeilen, Deutsch):
Zeile 1: 'NEU: <n>' — wie viele Empfehlungen du angelegt hast (0 ist ok).
Danach je eine Zeile pro Empfehlung: <agent> · <titel> · <schwere>.
Nichts gefunden? Nur: 'NEU: 0' + eine Zeile, was du geprüft hast."

START_TS=$(date +%s)
BEFORE=$(node -e 'try{const d=require(process.argv[1]);process.stdout.write(String((d.recs||[]).length))}catch(e){process.stdout.write("0")}' "$RECS" 2>/dev/null)
[ -z "$BEFORE" ] && BEFORE=0

source "$ROOT/dashboard/claude-bin.sh"
if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then
  echo "FEHLER: claude-Binary nicht gefunden (claude-bin.sh)" >> "$LOG"
  node "$ROOT/dashboard/notify.js" --title "🔬 Agent-Lab" "Claude-CLI nicht gefunden — Agent-Lab-Lauf abgebrochen." >> "$LOG" 2>&1
  exit 1
fi

# 45-Min-Budget: perl-alarm als portabler timeout(1)-Ersatz (macOS hat kein timeout/gtimeout).
# Kein Edit/Write in --allowedTools: der Agent DARF technisch nichts ändern, nicht nur laut Prompt.
OUT=$(perl -e 'alarm shift @ARGV; exec @ARGV or die "exec fehlgeschlagen: $!\n"' 2700 \
  "$CLAUDE_BIN" -p "$PROMPT" --model claude-sonnet-5 \
  --allowedTools "Read" "Glob" "Grep" "Bash" --max-turns 80 2>>"$LOG")
RC=$?
echo "$OUT" >> "$LOG"
[ "$RC" -eq 142 ] && echo "TIMEOUT: 45-Min-Budget erreicht" >> "$LOG"

AFTER=$(node -e 'try{const d=require(process.argv[1]);process.stdout.write(String((d.recs||[]).length))}catch(e){process.stdout.write("0")}' "$RECS" 2>/dev/null)
[ -z "$AFTER" ] && AFTER=0
NEU=$(( AFTER - BEFORE ))

node -e 'const fs=require("fs");const rec={start:+process.argv[1]||0,end:Math.floor(Date.now()/1000),ok:process.argv[2]==="0",neu:+process.argv[4]||0,report:String(process.argv[3]||"").slice(0,2000)};fs.appendFileSync(process.argv[5],JSON.stringify(rec)+"\n");' "$START_TS" "$RC" "$OUT" "$NEU" "$RUNS" 2>>"$LOG"
echo "=== fertig $(date '+%T') rc=$RC neu=$NEU ===" >> "$LOG"
# Kein Ping hier: die offenen Empfehlungen gehen gebündelt um 08:30 mit dem Morgen-Guardrail raus.
