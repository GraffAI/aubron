#!/usr/bin/env bash
#
# Install the World Cup scoreboard as a macOS LaunchAgent so it streams to WLED
# automatically and stays up across reboots and crashes.
#
# It writes ~/Library/LaunchAgents/io.aubron.worldcup.plist with absolute paths
# resolved on THIS machine (launchd has a minimal PATH and can't find an nvm
# node otherwise), then boots the agent.
#
# Secrets stay out of the repo: the API key is read from the environment and
# written only into the per-user plist under your home directory.
#
# Usage:
#   WC_WLED_HOST=192.168.1.125 WC_API_KEY=xxxx ./deploy/install-launchd.sh
#
# Re-run it any time paths change (e.g. after upgrading node) to refresh the plist.
set -euo pipefail

LABEL="io.aubron.worldcup"
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/worldcup.log"

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "error: node not found on PATH" >&2; exit 1; }
NODE_BIN="$(cd "$(dirname "$NODE_BIN")" && pwd)/$(basename "$NODE_BIN")"
NODE_DIR="$(dirname "$NODE_BIN")"

: "${WC_WLED_HOST:?set WC_WLED_HOST to your WLED IP (e.g. 192.168.1.125)}"
: "${WC_API_KEY:?set WC_API_KEY to your api-football key}"
WC_PROVIDER="${WC_PROVIDER:-api-football}"

echo "Building the package…"
( cd "$PKG_DIR" && pnpm build >/dev/null )

ENTRY="$PKG_DIR/dist/index.js"
[ -f "$ENTRY" ] || { echo "error: build did not produce $ENTRY" >&2; exit 1; }

echo "Writing $PLIST"
mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ENTRY</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WC_WLED_HOST</key><string>$WC_WLED_HOST</string>
    <key>WC_PROVIDER</key><string>$WC_PROVIDER</string>
    <key>WC_API_KEY</key><string>$WC_API_KEY</string>
    <key>PATH</key><string>$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST_EOF

DOMAIN="gui/$(id -u)"
echo "Booting the agent ($DOMAIN/$LABEL)…"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo "Done. Tail the log with:  tail -f \"$LOG\""
