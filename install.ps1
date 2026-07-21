# ===================================================================
# AIOS: Ein-Befehl-Installer (Windows / PowerShell)
# Nutzung:  irm https://raw.githubusercontent.com/MigSanja/amplify-aios-dist/main/install.ps1 | iex
# ===================================================================
$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:AIOS_REPO_URL) { $env:AIOS_REPO_URL } else { "https://github.com/MigSanja/amplify-aios-dist.git" }
$Dest    = if ($env:AIOS_DIR)      { $env:AIOS_DIR }      else { Join-Path $HOME "AIOS" }

function Say($m) { Write-Host ("> " + $m) -ForegroundColor Cyan }
function Ok($m)  { Write-Host ("[ok] " + $m) -ForegroundColor Green }
function Die($m) { Write-Host ("[fehler] " + $m) -ForegroundColor Red; exit 1 }

Say "AIOS wird installiert..."

# ---- Voraussetzungen ----
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Die "Git fehlt. Installiere Git (dann Befehl neu starten):  winget install --id Git.Git"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die "Node.js fehlt. Installiere Node >= 18 (dann neu starten):  winget install OpenJS.NodeJS.LTS"
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) { Die "Node ist zu alt ($(node -v)). Bitte Node >= 18 installieren." }
Ok "Node $(node -v)"

# Git Bash ist nuetzlich fuer die Shell-Jobs (Claude Code richtet den Rest ein)
if (-not (Get-Command bash -ErrorAction SilentlyContinue)) {
  Write-Host "[hinweis] Git Bash nicht gefunden - fuer einige Hintergrund-Jobs spaeter noetig (kommt mit 'winget install --id Git.Git')." -ForegroundColor Yellow
}

# ---- Holen / Aktualisieren ----
if (Test-Path (Join-Path $Dest ".git")) {
  Say "Vorhandene Installation gefunden, aktualisiere..."
  git -C $Dest pull --ff-only
} elseif (Test-Path $Dest) {
  Die "$Dest existiert schon, ist aber kein Git-Repo. Bitte umbenennen/entfernen."
} else {
  Say "Klone nach $Dest ..."
  git clone --depth 1 $RepoUrl $Dest
}
Ok "AIOS liegt in $Dest"

# ---- .env vorbereiten ----
$envFile = Join-Path $Dest ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $Dest ".env.example") $envFile
  Ok ".env aus Vorlage erstellt (leer, wird im Onboarding gefuellt)"
}

Write-Host ""
Ok "Fertig installiert."
Write-Host ""
Write-Host "Naechster Schritt:"
Write-Host "  1) Oeffne den Ordner in Claude Code:   $Dest"
Write-Host "  2) Tippe:   /aios-setup"
Write-Host ""
Write-Host "Claude Code fuehrt dich durch alles (erkennt Windows automatisch, Schritt fuer Schritt)."
