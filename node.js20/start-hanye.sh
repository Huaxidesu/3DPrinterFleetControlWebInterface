#!/bin/bash
# 韩叶监控台 — 飞牛 NAS 开机/手动启动（方案 A：JSON 存储，不用 Docker）
# 用法：chmod +x start-hanye.sh && ./start-hanye.sh
# 可覆盖：HANYE_APP_DIR=/path/to/app ./start-hanye.sh

export PATH=/var/apps/nodejs_v20/target/bin:$PATH

# Prefer directory whose package.json version is newest (folder name may stay 4.0.5).
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
  echo "[start-hanye] 未找到安装目录，请设置 HANYE_APP_DIR" >&2
  exit 1
}
LOG="/home/hanye/hanye.log"
PIDFILE="/home/hanye/hanye.pid"

cd "$APP_DIR" || {
  echo "[start-hanye] 目录不存在: $APP_DIR" >&2
  exit 1
}

if [ ! -f dist/server/server/nodeServer.js ]; then
  echo "[start-hanye] 未构建，请先: npm install && npm run build" >&2
  exit 1
fi

# 已在运行则跳过
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "[start-hanye] 已在运行 PID=$(cat "$PIDFILE")"
  exit 0
fi
if pgrep -f "nodeServer.js" >/dev/null 2>&1; then
  echo "[start-hanye] 已在运行"
  exit 0
fi

# 等网络/磁盘就绪（开机 crontab）；更新脚本可设 HANYE_SKIP_BOOT_SLEEP=1
if [ "${HANYE_SKIP_BOOT_SLEEP:-}" != "1" ]; then
  sleep 45
fi

VER=$(node -p "try{require('./package.json').version}catch(e){'?'}" 2>/dev/null || echo '?')
nohup node dist/server/server/nodeServer.js >>"$LOG" 2>&1 &
echo $! >"$PIDFILE"
echo "[start-hanye] 已启动 PID=$(cat "$PIDFILE") dir=$APP_DIR v=$VER"
echo "[start-hanye] 日志: $LOG"
echo "[start-hanye] 访问: http://$(hostname -I 2>/dev/null | awk '{print $1}'):17890/"
