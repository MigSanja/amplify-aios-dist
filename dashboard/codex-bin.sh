#!/bin/bash
# codex-bin.sh — löst die OpenAI-Codex-CLI-Binary auf (Gegenstück zu claude-bin.sh).
# Codex läuft headless über die ChatGPT-Subscription ($20-Plan): EINMAL interaktiv
#   codex login        (Browser-OAuth, Token landet in ~/.codex/auth.json)
# danach läuft `codex exec "..."` nicht-interaktiv auf der Sub — KEIN API-Key-Zusatzgeld.
# Installation (einmalig, braucht Alex):  npm i -g @openai/codex   (oder: brew install codex)
# Dieses Skript sourcen → setzt $CODEX_BIN auf die gefundene Binary.
# Nutzung:  source "$(dirname "$0")/codex-bin.sh"   →   "$CODEX_BIN" exec "..."

CODEX_BIN="$(command -v codex 2>/dev/null)"

# Fallbacks: übliche npm-global- und Homebrew-Pfade (launchd-PATH ist knapp)
if [ -z "$CODEX_BIN" ]; then
  for _cand in \
    "$HOME/.npm-global/bin/codex" \
    "/opt/homebrew/bin/codex" \
    "/usr/local/bin/codex" \
    "$HOME/.local/bin/codex"; do
    if [ -x "$_cand" ]; then CODEX_BIN="$_cand"; break; fi
  done
fi

export CODEX_BIN
