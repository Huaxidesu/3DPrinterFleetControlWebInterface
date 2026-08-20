#!/bin/bash
# 停止韩叶监控台

PIDFILE="/home/hanye/hanye.pid"

if [ -f "$PIDFILE" ]; then
  pid=$(cat "$PIDFILE")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    echo "[stop-hanye] 已停止 PID=$pid"
  fi
  rm -f "$PIDFILE"
fi

pkill -f "nodeServer.js" 2>/dev/null && echo "[stop-hanye] 已结束 nodeServer 进程" || true
