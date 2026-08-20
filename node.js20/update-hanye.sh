#!/bin/bash
# 韩叶监控台 — 网页「关于 → 更新」后执行（build + 重启）
# 用法：chmod +x update-hanye.sh && ./update-hanye.sh

set -e

export PATH=/var/apps/nodejs_v20/target/bin:$PATH

APP_DIR="/vol2/1000/3d/hanye-printer-monitor-4.0.8"
LOG="/home/hanye/hanye-update.log"
STOP="/home/hanye/stop-hanye.sh"
START="/home/hanye/start-hanye.sh"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

cd "$APP_DIR" || {
  log "错误：目录不存在 $APP_DIR"
  exit 1
}

log "======== 开始更新 ========"
log "目录: $APP_DIR"

log "1/4 npm install ..."
npm install 2>&1 | tee -a "$LOG"

log "2/4 npm run build ..."
npm run build 2>&1 | tee -a "$LOG"

if [ ! -f dist/server/server/nodeServer.js ]; then
  log "错误：构建失败，缺少 dist/server/server/nodeServer.js"
  exit 1
fi

log "3/4 停止旧进程 ..."
if [ -x "$STOP" ]; then
  "$STOP" 2>&1 | tee -a "$LOG"
else
  pkill -f "nodeServer.js" 2>/dev/null || true
fi

sleep 2

log "4/4 启动新进程 ..."
if [ -x "$START" ]; then
  "$START" 2>&1 | tee -a "$LOG"
else
  nohup node dist/server/server/nodeServer.js >> /home/hanye/hanye.log 2>&1 &
  log "已启动 PID=$!"
fi

sleep 2
if curl -fsS http://127.0.0.1:17890/api/health >/dev/null 2>&1; then
  ver=$(node -p "require('./package.json').version" 2>/dev/null || echo '?')
  log "完成：服务正常，当前版本 v$ver"
  log "访问: http://$(hostname -I 2>/dev/null | awk '{print $1}'):17890/"
else
  log "警告：服务可能未就绪，请查看 tail -f /home/hanye/hanye.log"
  exit 1
fi
