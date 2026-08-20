#!/bin/bash
set -euo pipefail
PLIST="$HOME/Library/LaunchAgents/com.hanye.launcher.plist"
launchctl unload "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
rm -rf "$HOME/Applications/HanyeLauncher.app"
echo "已卸载本机助手。"
