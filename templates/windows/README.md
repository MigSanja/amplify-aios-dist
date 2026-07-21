# Windows-Hintergrund-Jobs

Auf dem Mac laufen die Jobs (Nachtwerker, Heartbeat, WhatsApp-Tunnel, Watcher ...) ueber launchd.
Auf Windows uebernimmt das der **Task Scheduler**. Das Onboarding (`/aios-setup`) richtet das per
`register-job.ps1` ein.

- Job registrieren (taeglich):   `powershell -File templates\windows\register-job.ps1 -Label aios-nightwork -Script nightwork.sh -At 23:30`
- Job registrieren (alle N Min):  `powershell -File templates\windows\register-job.ps1 -Label aios-wa-heartbeat -Script wa-heartbeat.sh -EveryMinutes 10`
- Jobs pruefen:  `Get-ScheduledTask -TaskName aios-*`
- Job entfernen: `Unregister-ScheduledTask -TaskName aios-nightwork -Confirm:$false`

Die Job-Skripte in `dashboard/*.sh` laufen ueber **Git Bash** (kommt mit Git for Windows).
Der Kern (Dashboard, Jarvis-Copilot, Brain, WhatsApp) laeuft nativ mit Node, ohne diese Jobs.
