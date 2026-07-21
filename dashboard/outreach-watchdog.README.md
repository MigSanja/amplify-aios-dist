# outreach-watchdog.sh — Sicherheitsnetz für die Outreach-Tageskette

**Was es macht:** Prüft stündlich, ob die Tageskette von `outreach-alex` heute **abgeschlossen** ist.
Läuft sie gerade → nicht reinfunken. Steht sie (Server-/Session-Absturz) → hängende Session beenden,
Nachzug-Auftrag mit nur den fehlenden Schritten senden, ein Telegram-Ping. So geht kein Tag mehr still verloren.

**Trigger:** launchd `com.jarvis.outreach-watchdog`, **stündlich 10–18 Uhr (:20)**.
Manuell: `bash dashboard/outreach-watchdog.sh`.

**Abschluss-Kriterium:** `agents/outreach-alex/runs/<datum>-tageskette.md` existiert = fertig.
Trail (`runs/.live-<datum>.jsonl`) in den letzten 15 min beschrieben = läuft gerade → in Ruhe lassen.

**Ablauf, wenn die Kette steht:**
1. Chrome 9222 + Dashboard sicherstellen (claude-Auflösung update-fest via `claude-bin.sh`)
2. hängende Session stoppen (`/api/agent-console-stop`)
3. Nachzug-Auftrag: Ist-Stand aus `stats.json`, Regeln aus `daily-run-prompt.json`, nur fehlende Schritte
4. 25s-Verify (Trail bewegt sich) → genau EIN Telegram-Ping (Erfolg oder Alarm)

**Pause:** Liegt `agents/outreach-alex/.paused`, greift der Watchdog NICHT ein (kein Nachzug, kein
Neustart) und pingt bewusst NICHT (sonst bis zu 9 Pings/Tag).

**Log:** `dashboard/outreach-watchdog.log`.

## Häufige Fehler
- **„Tageskette steht UND Dashboard startet nicht"** → Dashboard-Server auf 4321 prüfen
  (`node dashboard/server.js`), Log ansehen.
- **„Nachzug NICHT angelaufen"** → Chrome 9222 / Agent-Console prüfen; oft dieselbe Chrome-Ursache wie
  bei daily-run.
