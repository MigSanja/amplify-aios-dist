#!/bin/bash
# claude-bin.sh — löst die claude-CLI-Binary update-fest auf.
# Die Claude-Desktop-App bündelt den CLI unter einem VERSIONIERTEN Pfad:
#   ~/Library/Application Support/Claude/claude-code/<version>/claude.app/Contents/MacOS/claude
# Der <version>-Ordner ändert sich bei jedem App-Update → nie hart pinnen.
# Dieses Skript sourcen → setzt $CLAUDE_BIN auf die NEUESTE vorhandene Version.
# Nutzung:  source "$(dirname "$0")/claude-bin.sh"   →   "$CLAUDE_BIN" -p "..."

_cc_base="$HOME/Library/Application Support/Claude/claude-code"
CLAUDE_BIN=""

if [ -d "$_cc_base" ]; then
  # neueste Version per Versionssortierung (2.1.187 > 2.1.99)
  for _v in $(ls -1 "$_cc_base" 2>/dev/null | sort -t. -k1,1n -k2,2n -k3,3n -r); do
    _cand="$_cc_base/$_v/claude.app/Contents/MacOS/claude"
    if [ -x "$_cand" ]; then CLAUDE_BIN="$_cand"; break; fi
  done
fi

# Fallback: normaler PATH (falls je ein Standalone-CLI installiert wird)
[ -z "$CLAUDE_BIN" ] && CLAUDE_BIN="$(command -v claude 2>/dev/null)"

export CLAUDE_BIN
