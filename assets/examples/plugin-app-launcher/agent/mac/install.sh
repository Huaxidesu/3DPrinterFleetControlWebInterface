#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Applications/HanyeLauncher.app"
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
cp -R "$ROOT/HanyeLauncher.app" "$DEST"
chmod +x "$DEST/Contents/MacOS/hanye-launcher"

PLIST="$HOME/Library/LaunchAgents/com.hanye.launcher.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hanye.launcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>$DEST/Contents/MacOS/hanye-launcher</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/hanye-launcher.log</string>
  <key>StandardErrorPath</key><string>/tmp/hanye-launcher.err</string>
</dict>
</plist>
EOF
launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"
echo "已安装并开机启动（无 Dock 图标）。请回到监控台「软件设置 → 快捷启动」点「绑定当前账号」。"
