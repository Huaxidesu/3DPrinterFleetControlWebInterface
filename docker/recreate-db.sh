#!/usr/bin/env bash
# 清空 MySQL 数据卷并按 docker/.env 重新初始化（网页数据会清空）
# 用法（在 docker/ 目录）：
#   chmod +x recreate-db.sh
#   ./recreate-db.sh
#   ./recreate-db.sh docker-compose.fnos.yml
set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DOCKER_DIR"

FILE="${1:-}"
if [ -z "$FILE" ]; then
  if [ -f docker-compose.fnos.yml ]; then
    FILE=docker-compose.fnos.yml
  else
    FILE=docker-compose.yml
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[错误] 未检测到 Docker。" >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "[错误] 需要 docker compose。" >&2
  exit 1
fi

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "[OK] 已从 .env.example 生成 .env"
  else
    echo "[错误] 缺少 docker/.env ，请先放好 .env" >&2
    exit 1
  fi
fi

echo "[..] 停止容器并删除 MySQL 数据卷（编排: $FILE）…"
"${COMPOSE[@]}" -f "$FILE" down -v --remove-orphans || true
docker rm -f hanye-app hanye-mysql 2>/dev/null || true

# 飞牛 / 旧项目名可能留下不带前缀或带前缀的卷
for v in $(docker volume ls -q | grep -E 'hanye_mysql' || true); do
  echo "[..] 删除数据卷 $v"
  docker volume rm -f "$v" || true
done

echo "[..] 按当前 .env 重新启动…"
"${COMPOSE[@]}" -f "$FILE" up -d

echo ""
echo "已重建数据库。打开 http://NAS的IP:17890/  登录 admin / admin123"
echo "若仍报 Access denied：飞牛项目路径必须是本 docker/ 目录，然后在 SSH 再跑一次本脚本。"
