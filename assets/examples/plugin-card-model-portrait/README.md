# 机型肖像卡片（plugin）v1.4

按设备 **机型** 显示产品肖像图。内置图在 `static/models/`（离线）；也可在 **软件设置 → 机型肖像** 自行补充或更换 PNG。

## 设置页

管理员可在软件设置中：

1. 选择品牌、填写机型、上传 PNG（也支持 JPG/WebP）
2. 保存后，该机型固定使用此图（优先于内置图）
3. 对已有自定义图可「更换」或「删除」；对内置图可「覆盖」

## 已内置机型（节选）

- Bambu：P1S / P1P / A1 / A1 mini / X1C / X1E / P2S
- 创想：K1 / K1 Max / K1C / Ender-3 V3 / K2
- 爱乐库：Neptune 4 / Mars 5
- 纵维：Kobra 2 / Kobra 3
- Snapmaker：Artisan / J1
- 闪铸：Adventurer 5M
- 启迪：Plus4
- Voron：2.4

未匹配机型 → 默认透明图。仅占用槽位 `device.card.before`。

## 安装

打 ZIP 后在 **软件设置 → 插件** 上传启用。
