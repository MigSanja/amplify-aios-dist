#!/bin/bash
# Jarvis — nächtliches Backup (Audit-Fix 1). launchd com.jarvis.backup, täglich 03:30,
# gestartet via node run-job.js (TCC-Muster). Sichert dashboard/data/ + brain/ +
# agents/*/stats.json + agents/*/runs/ als tar.gz nach ~/Backups/jarvis/, 14 Tage Rotation.
# Nebenjob (Audit-Fix 3): Media-Retention — dashboard/data/telegram-media/ > 90 Tage löschen.
# Fehler → Telegram-Ping (nie still), Erfolg → nur Log-Zeile (sparsam).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="$HOME/AIOS"
LOG="$ROOT/dashboard/backup.log"
DEST="$HOME/Backups/jarvis"
STAMP=$(date '+%Y-%m-%d')
TAR="$DEST/jarvis-$STAMP.tar.gz"

fail() {
  echo "FEHLER: $1" >> "$LOG"
  node "$ROOT/dashboard/notify.js" --title "💾 Backup" "Backup fehlgeschlagen: $1" >> "$LOG" 2>&1
  exit 1
}

mkdir -p "$DEST" || fail "Zielordner $DEST nicht anlegbar"
cd "$ROOT" || fail "ROOT $ROOT nicht erreichbar"
echo "=== $(date '+%F %T') backup start ===" >> "$LOG"

# Media-Retention (Audit-Fix 3): Telegram-Medien älter als 90 Tage löschen — VOR dem Backup.
if [ -d "$ROOT/dashboard/data/telegram-media" ]; then
  DELETED=$(find "$ROOT/dashboard/data/telegram-media" -type f -mtime +90 -print -delete 2>>"$LOG" | wc -l | tr -d ' ')
  [ "$DELETED" != "0" ] && echo "telegram-media: $DELETED Datei(en) > 90 Tage gelöscht" >> "$LOG"
fi

# Backup-Inhalt einsammeln (relative Pfade unter ROOT)
ITEMS=()
[ -d "dashboard/data" ] && ITEMS+=("dashboard/data")
[ -d "brain" ] && ITEMS+=("brain")
for f in agents/*/stats.json; do [ -f "$f" ] && ITEMS+=("$f"); done
for d in agents/*/runs; do [ -d "$d" ] && ITEMS+=("$d"); done
[ ${#ITEMS[@]} -gt 0 ] || fail "nichts zu sichern gefunden (dashboard/data, brain, agents fehlen?)"

tar -czf "$TAR" "${ITEMS[@]}" 2>>"$LOG" || fail "tar-Erstellung ($TAR)"

# Verifikation: Archiv muss lesbar/entpackbar sein, sonst ist es kein Backup.
tar -tzf "$TAR" > /dev/null 2>>"$LOG" || fail "Archiv $TAR nicht lesbar (tar -tzf)"
SIZE=$(du -h "$TAR" | cut -f1)

# Brain-Git-Push (Audit-Fix 1, Teil 2): privates Repo <DEIN_BRAIN_BACKUP_REPO> als zweites Netz.
# Pusht die Commits des Nacht-Agenten (22:00) mit; Fehler pingt, bricht aber das Backup nicht ab.
if [ -d "$ROOT/brain/.git" ]; then
  (cd "$ROOT/brain" && git push origin main --quiet) >> "$LOG" 2>&1 \
    || node "$ROOT/dashboard/notify.js" --title "💾 Backup" "brain-Git-Push fehlgeschlagen (tar-Archiv ist ok)" >> "$LOG" 2>&1
fi

# Rotation: Archive älter als 14 Tage löschen.
find "$DEST" -name "jarvis-*.tar.gz" -type f -mtime +14 -delete 2>>"$LOG"
KEPT=$(ls "$DEST"/jarvis-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')

echo "=== fertig $(date '+%T') — $TAR ($SIZE), $KEPT Archive vorgehalten ===" >> "$LOG"
