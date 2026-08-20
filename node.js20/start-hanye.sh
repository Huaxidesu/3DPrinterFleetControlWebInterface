#!/bin/bash
# 韩叶监控台 — 飞牛 NAS 开机/手动启动（方案 A：JSON 存储，不用 Docker）
# 用法：chmod +x start-hanye.sh && ./start-hanye.sh

export PATH=/var/apps/nodejs_v20/target/bin:$PATH

APP_DIR="/vol2/1000/3d/hanye-printer-monitor-4.0.7"
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

# 等网络/磁盘就绪（开机 crontab 调用时有效）
sleep 45

nohup node dist/server/server/nodeServer.js >> "$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "[start-hanye] 已启动 PID=$(cat "$PIDFILE")"
echo "[start-hanye] 日志: $LOG"
echo "[start-hanye] 访问: http://$(hostname -I 2>/dev/null | awk '{print $1}'):17890/"
