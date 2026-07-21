# launch-chrome.sh — gehärtetes Automations-Chrome pro Outreach-Account

**Was es macht:** Startet eine eigene, eingeloggte Chrome-Instanz für einen Outreach-Account, an die
die Agents per chrome-devtools-mcp andocken. Spurenfrei (webdriver=false, AutomationControlled aus),
sieht für LinkedIn wie ein normaler Chrome aus. Von daily-run, upwork-scan und dem Watchdog aufgerufen;
manuell fürs Login-Setup.

**Usage:** `bash dashboard/launch-chrome.sh <port> <userDataDir>`
- LinkedIn (Alex): `bash dashboard/launch-chrome.sh 9222 ~/.jarvis-chrome/alex`
- Upwork: `bash dashboard/launch-chrome.sh 9224 ~/.jarvis-chrome/upwork`
- Paul (2. LinkedIn): Port 9223, Profil `~/.jarvis-chrome/paul`

**Wichtige Eigenschaften:**
- **Profil-Isolation:** Jeder Account hat ein eigenes `--user-data-dir`. Beendet wird eine alte Instanz
  NUR per `pkill -f "user-data-dir=<DIR>"` — trifft nie einen anderen Account und nie des Nutzers
  Alltags-Chrome. **NIE `pkill "Google Chrome"`.**
- **Login bleibt erhalten:** Neustart löscht das Profil nicht, der Login lebt im Profil-Ordner.
- **Festes Fenster, NIE Vollbild:** feste `--window-position`/`--window-size` (alex klein unten rechts,
  upwork oben links) erzwingen ein normales Fenster. Grund: Das Agent-Chrome ist eine eigene Instanz
  DERSELBEN Chrome-App wie des Nutzers — Vollbild/frontmost würde Dock + Profil-Wähler kapern und ihn
  aus seinem Fenster werfen.
- **Verify:** wartet bis der Debug-Port (`/json/version`) antwortet, sonst Exit 1 mit „FEHLER".

## Häufige Fehler
- **„FEHLER: Port X antwortet nicht"** → Chrome kam nicht hoch. Prüfen ob eine alte Instanz des Profils
  klemmt, Port frei ist, Chrome-Pfad stimmt (`/Applications/Google Chrome.app`).
- **Agent meldet trotz OK „Chrome läuft nicht"** → nicht dieses Skript, sondern die alte Agent-Session
  hängt am toten Chrome. Fix liegt in den Aufrufern (daily-run/upwork-scan: Session-Stop vor Neustart).
- **Optionales 100%-Isolations-Upgrade:** Chrome Beta installieren und `CHROME=`-Pfad umstellen (eigenes
  Dock-Icon), falls das Dock-Problem je wiederkommt.
