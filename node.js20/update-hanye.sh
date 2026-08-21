#!/bin/bash
# 韩叶监控台 — 网页「关于 → 更新」后执行（build + 重启）
# 用法：chmod +x update-hanye.sh && ./update-hanye.sh
# 可覆盖：HANYE_APP_DIR=/path/to/app ./update-hanye.sh

set -e

export PATH=/var/apps/nodejs_v20/target/bin:$PATH

resolve_app_dir() {
  if [ -n "${HANYE_APP_DIR:-}" ] && [ -f "${HANYE_APP_DIR}/package.json" ]; then
    echo "$HANYE_APP_DIR"
    return
  fi
  local best="" best_ver="" cand ver
  for cand in /vol2/1000/3d/hanye-printer-monitor-*; do
    [ -d "$cand" ] || continue
    [ -f "$cand/package.json" ] || continue
    ver=$(node -p "try{require('$cand/package.json').version}catch(e){''}" 2>/dev/null || true)
    [ -n "$ver" ] || continue
    if [ -z "$best" ]; then
      best="$cand"
      best_ver="$ver"
      continue
    fi
    if [ "$(printf '%s\n%s\n' "$best_ver" "$ver" | sort -V | tail -1)" = "$ver" ] && [ "$ver" != "$best_ver" ]; then
      best="$cand"
      best_ver="$ver"
    fi
  done
  if [ -n "$best" ]; then
    echo "$best"
    return
  fi
  return 1
}

APP_DIR="$(resolve_app_dir)" || {
  echo "错误：未找到安装目录，请设置 HANYE_APP_DIR" >&2
  exit 1
}
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

# Prefer git pull when repo is present
if [ -d .git ]; then
  log "0/4 git pull ..."
  git pull --ff-only 2>&1 | tee -a "$LOG" || log "警告：git pull 失败，继续用当前源码构建"
fi

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
  # skip boot sleep when called from update
  HANYE_SKIP_BOOT_SLEEP=1 "$START" 2>&1 | tee -a "$LOG" || {
    nohup node dist/server/server/nodeServer.js >> /home/hanye/hanye.log 2>&1 &
    log "直接启动 PID=$!"
  }
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
