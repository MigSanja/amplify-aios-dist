# launchd-Templates

Die Hintergrund-Jobs (Nachtwerker, Heartbeat, WhatsApp-Tunnel, Content-Watch, Watcher …) laufen unter
macOS als launchd-Agents. Sie liegen NICHT fertig im Repo, weil sie den echten node-Pfad und den echten
Repo-Pfad dieses Rechners brauchen. Das Onboarding (`/aios-setup`) rendert sie aus `com.aios.JOB.plist.tmpl`.

Platzhalter:
- `__LABEL__`   z.B. `com.aios.nightwork`
- `__NODE__`    Ausgabe von `command -v node` (Apple Silicon oft `/opt/homebrew/bin/node`)
- `__REPO__`    absoluter Pfad zu diesem Repo (z.B. `$HOME/AIOS`)
- `__SCRIPT__`  das Shell-Skript in `dashboard/` (z.B. `nightwork.sh`)
- `__LOG__`     Logdatei (z.B. `nightwork.launchd.log`)
- `__SCHEDULE__` Zeitplan (StartCalendarInterval / StartInterval / RunAtLoad)

Alle Jobs starten über `dashboard/run-job.js` (TCC-Workaround + Log-Rotation).
Laden:  `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<LABEL>.plist`
Prüfen: `launchctl list | grep aios`
