# Registriert einen AIOS-Hintergrund-Job als Windows-Scheduled-Task (Pendant zu launchd auf dem Mac).
# Claude Code nutzt das im Onboarding. Beispiel:
#   powershell -File templates\windows\register-job.ps1 -Label aios-nightwork -Script nightwork.sh -At 23:30
#   powershell -File templates\windows\register-job.ps1 -Label aios-wa-heartbeat -Script wa-heartbeat.sh -EveryMinutes 10
param(
  [Parameter(Mandatory=$true)][string]$Label,     # z.B. aios-nightwork
  [Parameter(Mandatory=$true)][string]$Script,    # Skript in dashboard/, z.B. nightwork.sh
  [string]$At = "23:30",                           # taegliche Uhrzeit (wenn nicht -EveryMinutes)
  [int]$EveryMinutes = 0                           # >0 = alle N Minuten statt taeglich
)
$Repo    = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # templates/windows -> Repo-Root
$Node    = (Get-Command node).Source
$RunJob  = Join-Path $Repo "dashboard\run-job.js"
$ScriptP = Join-Path $Repo ("dashboard\" + $Script)
$Action  = New-ScheduledTaskAction -Execute $Node -Argument ('"{0}" "{1}"' -f $RunJob, $ScriptP)
if ($EveryMinutes -gt 0) {
  $Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)
} else {
  $Trigger = New-ScheduledTaskTrigger -Daily -At $At
}
Register-ScheduledTask -TaskName $Label -Action $Action -Trigger $Trigger -Force | Out-Null
Write-Host "Scheduled Task '$Label' registriert."
# Hinweis: Die .sh-Job-Skripte laufen ueber Git Bash. Stelle sicher, dass Git (mit Git Bash) installiert ist.
