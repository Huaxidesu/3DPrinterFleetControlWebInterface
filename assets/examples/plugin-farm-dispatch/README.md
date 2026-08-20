# 巡查派单（farm_dispatch）1.0.1

四个页面均在**监控台侧栏**打开（与其它插件页相同），勿再用独立 `/farm/*` 窗口。

| 侧栏 | 权限 / 用户组 |
|------|----------------|
| 巡查看板 | `plugin.farm_dispatch.patrol` / 巡查 |
| 派单审核 | `plugin.farm_dispatch.audit` / 审核 |
| 提交打印 | `plugin.farm_dispatch.submit` / 派单申请 |
| 派单日志 | `plugin.farm_dispatch.logs` |

## 安装

1. 上传 ZIP → 启用  
2. **软件设置 → 巡查派单 → 初始化用户组**  
3. 用户加入对应组后刷新，侧栏即出现入口  

## 流程

申请人提交 → 审核通过智能派单 → 无匹配机则通知巡查换料 → 确认后重派。驳回必填原因。全部记日志。

## 打包

```bash
cd assets/examples/plugin-farm-dispatch
zip -r farm_dispatch-1.0.1.zip plugin.json main.js client.js theme.css install.js uninstall.js pages modules cover.png README.md
```
