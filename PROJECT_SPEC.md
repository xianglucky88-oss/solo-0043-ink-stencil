# 墨版 · 项目规格

## 使用场景

动态图形设计师使用局部坐标矢量图层、仿射参数、遮罩引用、混合模式及输出尺寸。按局部轮廓、遮罩相交和混色逐像素生成画面；在透明背景上检查画面、像素与图层，冻结并下载 PNG。
样例在本机合成，页面展示生产工作流，无需外部服务。

## 业务和数据规则

- `width,height` 为 16–512 px，`samples` 为 1 或 2，最多 16 层。`width × height × samples² × layers` 不超过 8,000,000。
- `layers` 从底到顶排列。轮廓为 `ellipse`、`rect`（支持半径 `radius`）或 `diamond`。局部原点在形状中心；`transform` 先沿 X/Y 缩放、再旋转（屏幕坐标下正角顺时针）、最后移动中心。
- `mask` 为空或指向前序层唯一 ID；对每个子样点，沿前序链取几何交集，遮罩不读取颜色、`visible` 或透明度。隐藏层仅用于几何判定，不绘制。
- 颜色为 `#RRGGBB` 或 `#RRGGBBAA`，`opacity` 与颜色 alpha 相乘。`normal`、`multiply`、`screen` 在输入编码的 RGB 数值空间按 source-over 合成。采样后平均预乘值，再还原到直通 alpha RGBA PNG；完全透明的像素编码为零。
- `hits` 统计绘制时通过几何的子样点，不等于最后仍可见的贡献。页面的 Canvas 像素读数遵循浏览器的颜色/alpha 表示；PNG 原始字节以下载件为准。

## 帧安排与循环 APNG

工作稿可附带 `animation`（也接受 `timeline`、`schedule`、`frames` 等常见键名）：

```json
"animation": {
  "end": 500,
  "frames": [
    { "at": 0 },
    { "at": 120, "layers": { "cut": { "x": 22 } } },
    { "at": 370 }
  ]
}
```

- 首帧 `at` 为 `0`，后续 `at` 是严格递增的整数毫秒；`end` 是大于末帧起点且 `≤ 10000` 的整数毫秒，末帧保持到 `end`。上例三帧在 APNG 文件中的保持时长为 `120 / 250 / 130 ms`，`acTL.num_plays = 0`（无限循环）。
- 每帧用 `layers`（或 `changes/updates`，支持 id 映射、改动数组、`{layer,x,y,opacity}` 扁平形式与 `cut.x` 点号键）给出指定图层的 `x`、`y`（可包在 `transform`/`position` 中）和 `opacity`。未填的 x、y、opacity 各自沿用上一帧的有效值；首帧未填则取工作稿原值。
- 任意一帧都从工作稿原值把 `0..i` 的改动折叠得到，不修改规范化文档，因此可直接、按任意顺序选帧，同一帧结果一致。每帧全画布重新栅格化，移动裁边后旧区域自然透明；边缘 alpha 仍按该帧几何的 `samples²` 子样点计算。
- 整段循环预算为 `Σ_frames width × height × samples² × layers ≤ 8,000,000`，单帧预览与 APNG 导出同一口径。引用未知图层、帧安排非法或总量超限一律 `422`，且在完整编码前拒绝，不产生部分动图。

接口：`POST /api/preview` 加 `"frame": i`（或 `?frame=i`，也接受毫秒 `at/time`）返回该帧 PNG 校样；`POST /api/apng`（别名 `/api/animation`、`/api/timeline`、`/api/frames` 等）默认返回含 `base64`/`apngBase64`/`delays` 的 JSON，`Accept: image/apng`、`?raw=1` 或 `/api/export/apng`、`/api/apng/raw` 返回 `image/apng` 文件字节。导出无需冻结；普通 `/api/preview` 的 `base64`/`summary`、`POST /api/library` 冻结与原 PNG 资产下载均不变。APNG 每帧为全画布 `fcTL`（`blend_op=SOURCE`、`dispose_op=BACKGROUND`）+ filter 0 扫描行，保证解码后完整画面就是该帧栅格，循环回首帧不带上末帧颜色。

## 工作流

| 工作流 | 接口 | 正常结果 | 替代或失败结果 | 生产检查 |
| --- | --- | --- | --- | --- |
| 逐像素合成 | `POST /api/preview` | 在有限预算内输出带透明的 PNG 与像素统计 | 非法画布尺寸或轮廓拒绝 | `node tools/workflow.mjs proof` |
| 局部轮廓变换 | `POST /api/preview 的 transform` | 旋转和缩放后仍按局部轮廓判覆盖 | 零缩放拒绝 | `node tools/workflow.mjs transform` |
| 几何遮罩链 | `POST /api/preview 的 mask` | 隐藏遮罩仍参与前序链相交但不着色 | 缺失、向后或自引用拒绝 | `node tools/workflow.mjs masks` |
| 透明度与混色 | `POST /api/preview 的 blend` | 正常、乘色和滤色按图层顺序合成 | 未知色值或混合模式拒绝 | `node tools/workflow.mjs blend` |
| 边缘子像素 | `POST /api/preview 的 samples` | 网格子样点先合成后求平均，输出保留边缘透明度 | 超过预算拒绝 | `node tools/workflow.mjs sampling` |
| 循环揭幕帧校样与 APNG | `POST /api/preview 的 frame`、`POST /api/apng` | 任意顺序选帧结果一致；APNG 记录 120/250/130 ms 并输出逐帧一致的透明完整画面 | 未知图层、非法帧安排或整段预算超限拒绝且无部分产物 | `node tools/workflow.mjs animation` |
| 导入文档 | `POST /api/preview` | 规范输入进入校样计算 | 非法 UTF-8、JSON 或字段直接拒绝；不覆盖已有冻结资产 | `node tools/workflow.mjs import` |
| 冻结校样 | `POST /api/library` | 相同规范输入与产物复用同一摘要；并行提交只创建一次 | 无法规范化的草稿不会签发 | `node tools/workflow.mjs freeze` |
| 下载版本产物 | `GET /api/library/:id/asset` | 返回冻结资产原始字节、正确媒体类型和文件名 | 不存在的资产返回 404 | `node tools/workflow.mjs download` |
| 重启后复取 | `GET /api/library 与 GET /api/library/:id` | 恢复已有规范文档及成品校样摘要 | 未知或无法读取的版本不会替换当前校样 | `node tools/workflow.mjs reopen` |
| 完整性复核 | `GET /api/library/:id[/asset]` | 元数据与媒体字节读取前均核对内容摘要 | 磁盘内容不匹配时返回 409 | `node tools/workflow.mjs integrity` |

## 代码职责

| 模块 | 参与的生产工作流 |
| --- | --- |
| `product/document.mjs` | 逐像素合成、局部轮廓变换、几何遮罩链、透明度与混色、边缘子像素、导入文档 |
| `product/raster.mjs` | 逐像素合成、局部轮廓变换、几何遮罩链、透明度与混色、边缘子像素 |
| `product/png.mjs` | 逐像素合成、边缘子像素 |
| `product/index.mjs` | 逐像素合成、导入文档、冻结校样 |
| `product/transform.mjs` | 局部轮廓变换 |
| `product/shapes.mjs` | 局部轮廓变换、几何遮罩链 |
| `product/masks.mjs` | 几何遮罩链、边缘子像素 |
| `product/color.mjs` | 透明度与混色 |
| `product/blend.mjs` | 透明度与混色 |
| `server/router.mjs` | 导入文档、冻结校样、下载版本产物、重启后复取、完整性复核 |
| `server/request-body.mjs` | 导入文档 |
| `server/library.mjs` | 冻结校样、下载版本产物、重启后复取、完整性复核 |
| `server/canonical.mjs` | 冻结校样、下载版本产物、重启后复取、完整性复核 |
| `server/atomic-write.mjs` | 冻结校样 |
| `server/environment.mjs` | 重启后复取 |

`web/app.mjs`协调编辑与预览生命周期；`web/surface.mjs`装配本产品校样组件。HTML、CSS、DOM、Canvas 或 HTML Audio 均为原生，无前端框架。

## 存储和验证边界

请求 JSON 最多 6 MiB。预览不持久化。冻结摘要绑定规则版本、规范文档、摘要指标和导出字节。单个文件通过同目录临时文件和排他硬链接发布，同内容重复提交复用原版本。复取会校验内容摘要；最近版本列表只显示最新 20 个。临时文件与最终目录需要位于支持硬链接的本机文件系统上。本应用不提供跨机器同步、账号权限或面向网络的部署。

完整自动化测试套件暂缓。`.project-runtime.json` 中的工作流命令从真实路由操作临时工作目录，不改变用户版本库。
