#!/bin/bash
# Google-Workspace-MCP (Gmail/Kalender/Drive/Docs/Sheets) für die Dashboard-Jarvis-Session.
# Läuft headless im stdio-Modus mit dem gecachten OAuth-Token aus config/.gcreds.
cd "$HOME/AIOS" || exit 1
set -a; source .env 2>/dev/null; set +a
export OAUTHLIB_INSECURE_TRANSPORT=1
export WORKSPACE_MCP_CREDENTIALS_DIR="$HOME/AIOS/config/.gcreds"
export GOOGLE_OAUTH_REDIRECT_URI="http://localhost:8765/oauth2callback"
export USER_GOOGLE_EMAIL="${USER_GOOGLE_EMAIL:-your-google-account@example.com}"
exec "$HOME/.local/bin/workspace-mcp" --single-user --tools gmail calendar drive docs sheets
