# `node.js20/` — 飞牛 NAS（Node 20）运维脚本

本目录给 **飞牛 NAS 等用系统 Node.js 20 直装** 的场景用，**不是** Docker 安装包。

把监控台源码解压到 NAS 后，用这里的脚本做日常启停、开机自启，以及网页「检查更新」之后的重新构建。

## 里面有什么

| 文件 | 作用 |
|------|------|
| `start-hanye.sh` | 启动监控台（`node dist/server/server/nodeServer.js`） |
| `stop-hanye.sh` | 停止服务 |
| `update-hanye.sh` | 网页更新源码后：`npm install` + `build` + 重启 |
| `自启说明.txt` | 逐步操作说明（上传路径、chmod、crontab） |
| `README.md` | 本说明 |

> 目录名表示面向 **Node.js 20** 环境（飞牛应用常为 `/var/apps/nodejs_v20/...`），与仓库根目录的 Docker 方案并列。

## 怎么用（摘要）

1. 按 [ops/docs/INSTALL.md](../ops/docs/INSTALL.md) 把源码装到 NAS（例如 `/vol2/1000/3d/hanye-printer-monitor-x.x.x`）。
2. 用编辑器改 `start-hanye.sh` / `update-hanye.sh` 里的 **`APP_DIR=`**，改成你的实际解压路径。
3. 把三个 `.sh` 拷到用户目录（如 `/home/hanye/`），`chmod +x` 后执行 `start-hanye.sh`。
4. 开机自启：见 `自启说明.txt`（建议用 **root crontab** `@reboot`）。
5. 软件设置里点「更新」拉完源码后，务必再跑一次 **`update-hanye.sh`**（Node 直装不会自动 rebuild）。

详细步骤以 **`自启说明.txt`** 和 **INSTALL.md → 飞牛 / NAS** 为准。

## 不会提交什么

本目录下的 `*.zip` 源码包被根目录 `.gitignore` 忽略，请自行从 GitHub Release / Tag 下载，不要把大 zip 推进仓库。
