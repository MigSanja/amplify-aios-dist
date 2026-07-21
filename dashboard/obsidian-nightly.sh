#!/bin/bash
# Jarvis — Nacht-Agent (obsidian-second-brain) für das brain/-Vault. launchd, täglich 22:00.
# Sleeptime-Consolidation: schließt den Tag ab, versöhnt Widersprüche, verdichtet Muster,
# heilt Links — ADDITIV, nie destruktiv (Regeln in brain/_CLAUDE.md).
# Vor jedem Lauf: Git-Snapshot (Rollback). Läuft über die Claude-Subscription (claude -p, kein API-Geld).
# PATH explizit setzen — launchd strippt die Umgebung.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.claude/local"

ROOT="$HOME/AIOS"
VAULT="$ROOT/brain"
LOG="$ROOT/dashboard/obsidian-nightly.log"
DATE=$(date '+%Y-%m-%d')
cd "$VAULT" || exit 1

echo "=== $(date '+%F %T') obsidian-nightly start ===" >> "$LOG"

# 1) Git-Snapshot VOR dem Lauf (Rollback-Punkt)
git add -A >> "$LOG" 2>&1
git -c user.name="AIOS" -c user.email="aios@localhost" \
    commit -q -m "auto-snapshot vor nightly $DATE" >> "$LOG" 2>&1 || echo "(nichts zu committen)" >> "$LOG"

source "$ROOT/dashboard/claude-bin.sh"
CLAUDE="$CLAUDE_BIN"
if [ -z "$CLAUDE" ] || [ ! -x "$CLAUDE" ]; then
  echo "FEHLER: claude-Binary nicht gefunden" >> "$LOG"
  node "$ROOT/dashboard/notify.js" --title "⚠️ Nacht-Agent" "Abbruch: claude-CLI nicht gefunden (App-Update?)." >> "$LOG" 2>&1
  exit 1
fi

PROMPT="Du bist der autonome Nacht-Agent für dieses Obsidian-Vault (des Nutzers Second Brain).
LIES ZUERST brain/_CLAUDE.md UND brain/_README.md und befolge sie exakt — besonders die Sicherheitsregeln für autonome Läufe (ADDITIV & korrigierend, NIE löschen/archivieren, keine Fragen mid-run, Identity/Persona nur auf Befehl).

Dies ist ein Sleeptime-Consolidation-Pass — das Vault soll morgen früh schlauer sein als heute Abend. Ordner-Mapping steht in _CLAUDE.md.

Phase 1 — Tag abschließen:
- Lies die heutige Daily-Notiz in 99_Daily/ (falls keine da: lege sie an). Hänge eine '## End of Day' Sektion mit 3-5 Bullet-Zusammenfassung an.
- Verschiebe erledigte Tasks in 07_Tasks/ in den Done-/erledigt-Bereich (nur Status, nichts löschen).

Phase 2 — Reconcile:
- Prüfe 02_People/ auf veraltete Rollen/Firmen/Beschreibungen, die neueren Daily-Notizen widersprechen.
- Prüfe 05_Knowledge/ auf Aussagen, die durch kürzlich hinzugekommene Notizen widerlegt sind.
- Klare Fälle auto-auflösen. Ambige NICHT ändern — als '> [!question]'-Callout in der Notiz flaggen.

Phase 3 — Synthese:
- Finde Konzepte, die in 2+ unabhängigen Notizen (v.a. von heute/gestern) auftauchen.
- Bei echtem Muster: neue Notiz 05_Knowledge/synthese-<thema>.md mit Belegen + Interpretation, verlinkt.

Phase 4 — Heal:
- Heute erstellte Notizen ohne eingehende Links sinnvoll aus bestehenden Seiten verlinken.
- Tippfehler-Links heilen (z.B. [[beispiel-notiz]] -> [[beispiel-notiz]], [[beispiel-notiz]] auf echte Person prüfen).
- Index-/_README-Listen aktualisieren, falls nötig.

Phase 5 — Log:
- Hänge an 99_Daily/$DATE.md an: '## [$DATE] nightly | End of day + X reconciled, Y synthesized, Z orphans linked'.

Phase 6 — Post-Idee (ZUSATZ, erst NACH der Kernarbeit oben — die ist wichtiger):
- Ziel: aus dem Tages-Gedankengang GENAU EINE Content-Idee formen. Muss nicht jeden Tag Gold sein — nur wenn wirklich Substanz da ist. Wenn nichts Gutes da ist: überspringen und im Fazit sagen 'heute keine Post-Idee'.
- Quelle: die heutige Daily-Notiz + die heute erstellten/angefassten Notizen (Business-Gedanken). REIN PRIVATES bleibt draußen (Familie/Gesundheit/Journaling → nie in einen Post).
- Stil: Alex' echter Take, authentisch, seine Sprache, kein generisches KI-Zeug. Entscheide Kanal LinkedIn ODER Instagram (Ton/Format je Kanal). Baue: Titel (kurz), Hook (erster Satz, stark), Kernaussage + kurzes Short-Skript, CTA. Halte dich an brain/_CLAUDE.md / Alex' Anti-Slop-Regeln (KEINE Gedankenstriche — oder –).
- Ablage (per curl an den laufenden Dashboard-Server, Single-Writer, keine JSON-Direktschreibung):
  1) Idee in die Content-Pipeline:
     curl -s -X POST -H 'Content-Type: application/json' -d '{\"titel\":\"...\",\"hook\":\"...\",\"kanal\":\"LinkedIn\",\"quelle\":\"nachtwerker\",\"score\":7,\"scoreGrund\":\"...\",\"notiz\":\"Kernaussage + Short-Skript + CTA hier\"}' http://localhost:4321/api/content-idea-add
  2) Signal in Alex' Inbox (damit die Idee morgens sichtbar ist):
     curl -s -X POST -H 'Content-Type: application/json' -d '{\"titel\":\"🔥 Post-Idee für heute: <Titel>\",\"detail\":\"<Hook> — Kanal: <LinkedIn/Instagram>\",\"quelle\":\"nachtwerker\"}' http://localhost:4321/api/aktion-add
  - JSON sauber escapen (Anführungszeichen im Text vermeiden oder mit \\\" schützen). Schlägt curl fehl (Server aus): einmal im Fazit vermerken, nicht abbrechen.

Stelle KEINE Fragen. Ändere nichts Destruktives — nur hinzufügen, aktualisieren, verlinken. Speichere und stoppe.
Antworte am ENDE mit EINER kurzen deutschen Zusammenfassung (3-5 Bullets): was du reconciled/synthesized/verlinkt hast + ob eine Post-Idee rauskam (Titel + Kanal) oder heute keine."

OUT=$("$CLAUDE" -p "$PROMPT" --allowedTools "Read Write Edit Glob Grep Bash" --permission-mode acceptEdits 2>>"$LOG")
echo "$OUT" >> "$LOG"

# 2) Snapshot NACH dem Lauf (Diff sichtbar)
git add -A >> "$LOG" 2>&1
git -c user.name="AIOS" -c user.email="aios@localhost" \
    commit -q -m "nightly $DATE — autonome Consolidation" >> "$LOG" 2>&1 || echo "(nightly: keine Änderungen)" >> "$LOG"
CHANGED=$(git show --stat --oneline HEAD 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')

# 3) Telegram-Ping (nie still — Prinzip: Blocker/Ergebnis immer melden)
SUMMARY=$(echo "$OUT" | tail -8)
[ -n "$SUMMARY" ] && node "$ROOT/dashboard/notify.js" --title "🌙 Nacht-Agent ($CHANGED Dateien)" "$SUMMARY" >> "$LOG" 2>&1
echo "=== fertig $(date '+%T') — $CHANGED Dateien geändert ===" >> "$LOG"
