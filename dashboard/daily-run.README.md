# daily-run.sh — LinkedIn-Outreach-Tageslauf (Alex)

**Was es macht:** Startet einmal täglich die komplette Outreach-Tageskette von `outreach-alex`
(Leads → Vernetzen → Erstkontakt → InMail → Follow-up), gated und sequenziell.

**Trigger:** launchd `com.jarvis.outreach-alex`, **07:00**. Manuell: `bash dashboard/daily-run.sh`.

**Was dazugehört:**
- Auftrag/Regeln: `dashboard/daily-run-prompt.json` (Feld `msg` = voller Tagesauftrag, inkl. Wochenend-Regel Sa/So nur Schritt 1+2)
- Chrome: Port **9222**, Profil `~/.jarvis-chrome/alex` (siehe `launch-chrome.README.md`)
- Agent-Spawn über Dashboard-Agent-Console (`/api/agent-console-send`), nicht nacktes `claude -p`
- Log: `dashboard/daily-run.log` · Trail (Lauf-Beweis): `agents/outreach-alex/runs/.live-<datum>.jsonl` · Report: `runs/<datum>-tageskette.md`
- Absicherung nach dem Lauf: Watchdog (`outreach-watchdog.README.md`)

**Selbstheilung:** Baut zuerst den Kunden-Index neu (`kunden-index.js`), dann bis zu 3 Versuche mit
Backoff (10/30/60s): Chrome + Dashboard sicherstellen, Befehl posten, 20s warten, Trail prüfen
(nicht nur `ok:true` vom Dashboard — das heißt nur „Befehl angenommen", nicht „Agent lief"). Alle 3
Versuche gescheitert → **Telegram-Alarm** statt stillem Abbruch.

**Pause:** Liegt `agents/outreach-alex/.paused` (Stop im Dashboard), startet der Lauf NICHT — genau
ein Telegram-Ping als Erinnerung. Play im Dashboard hebt es auf.

## Häufige Fehler
- **„07:00-Lauf nach 3 Versuchen NICHT gestartet"** → `dashboard/daily-run.log` ansehen. Meist Chrome
  9222 tot oder Dashboard nicht auf 4321.
- **Agent meldet „Chrome läuft nicht", obwohl Chrome frisch startete** → war der Bug bis 12.07.: eine
  alte Agent-Session hing per chrome-devtools-mcp am toten Chrome. `ensure_chrome` beendet jetzt VOR
  dem Chrome-Neustart die Session (`/api/agent-console-stop`), der nächste Befehl baut eine frische
  MCP-Verbindung auf. Wenn es wiederkommt: prüfen, ob dieser Session-Stop noch im Skript steht.
- **Chrome killt des Nutzers eigenes Fenster** → NIE `pkill "Google Chrome"`; Neustart nur über
  `launch-chrome.sh` (killt nur per Profil-Ordner). Siehe `agents/CLAUDE.md`.
