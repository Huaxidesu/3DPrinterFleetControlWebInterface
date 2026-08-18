# Build context = 仓库根目录（由 compose 的 context: .. 指定）
# 国内 NAS：默认走 DaoCloud 代理拉官方 node 镜像，避免 Docker Hub 超时
# docker CLI：给「关于」一键更新在独立助手容器里执行 compose 重建
FROM docker.m.daocloud.io/library/docker:cli AS dockercli
RUN mkdir -p /out/cli-plugins \
  && cp /usr/local/bin/docker /out/docker \
  && (cp /usr/local/libexec/docker/cli-plugins/docker-compose /out/cli-plugins/docker-compose \
    || cp /usr/libexec/docker/cli-plugins/docker-compose /out/cli-plugins/docker-compose \
    || cp /usr/local/lib/docker/cli-plugins/docker-compose /out/cli-plugins/docker-compose)

# —— Build stage ——
FROM docker.m.daocloud.io/library/node:20-bookworm AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com \
  && npm ci

COPY tsconfig.json ./
COPY config ./config
COPY src ./src
COPY ops ./ops
COPY assets ./assets

RUN npm run build \
  && npm prune --omit=dev

# —— Runtime ——
FROM docker.m.daocloud.io/library/node:20-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/ops/sql ./ops/sql
COPY --from=builder /app/ops/scripts ./ops/scripts
COPY --from=builder /app/ops/docs ./ops/docs
COPY --from=builder /app/assets ./assets
COPY docker/entrypoint.sh /entrypoint.sh
COPY --from=dockercli /out/docker /usr/local/bin/docker
COPY --from=dockercli /out/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

RUN sed -i 's/\r$//' /entrypoint.sh \
  && chmod +x /entrypoint.sh /usr/local/bin/docker /usr/local/libexec/docker/cli-plugins/docker-compose \
  && mkdir -p /app/data

ENV NODE_ENV=production \
    USE_MYSQL=1 \
    PORT=17890 \
    DATA_ROOT=/app/data \
    MYSQL_HOST=mysql \
    MYSQL_PORT=3306 \
    MYSQL_USER=hanye \
    MYSQL_DATABASE=hanye_printer \
    RUNNING_IN_DOCKER=1 \
    UPDATE_GIT_ROOT=/host-repo \
    DOCKER_CLI_PLUGIN_EXTRA_DIRS=/usr/local/libexec/docker/cli-plugins

EXPOSE 17890
VOLUME ["/app/data"]

ENTRYPOINT ["/entrypoint.sh"]
