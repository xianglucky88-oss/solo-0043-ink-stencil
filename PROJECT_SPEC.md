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

## 工作流

| 工作流 | 接口 | 正常结果 | 替代或失败结果 | 生产检查 |
| --- | --- | --- | --- | --- |
| 逐像素合成 | `POST /api/preview` | 在有限预算内输出带透明的 PNG 与像素统计 | 非法画布尺寸或轮廓拒绝 | `node tools/workflow.mjs proof` |
| 局部轮廓变换 | `POST /api/preview 的 transform` | 旋转和缩放后仍按局部轮廓判覆盖 | 零缩放拒绝 | `node tools/workflow.mjs transform` |
| 几何遮罩链 | `POST /api/preview 的 mask` | 隐藏遮罩仍参与前序链相交但不着色 | 缺失、向后或自引用拒绝 | `node tools/workflow.mjs masks` |
| 透明度与混色 | `POST /api/preview 的 blend` | 正常、乘色和滤色按图层顺序合成 | 未知色值或混合模式拒绝 | `node tools/workflow.mjs blend` |
| 边缘子像素 | `POST /api/preview 的 samples` | 网格子样点先合成后求平均，输出保留边缘透明度 | 超过预算拒绝 | `node tools/workflow.mjs sampling` |
| 连续局部校样 | `POST /api/preview` 的 `{base,document}` 信封 | 仅隐藏遮罩移动时局部重算，结果与整图渲染逐字节一致；晚到响应不覆盖新校样 | 画布/采样变化或可见层改动回退整图；缓存未命中现场重建 | `node tools/workflow.mjs incremental` |
| 导入文档 | `POST /api/preview` | 规范输入进入校样计算 | 非法 UTF-8、JSON 或字段直接拒绝；不覆盖已有冻结资产 | `node tools/workflow.mjs import` |
| 冻结校样 | `POST /api/library` | 相同规范输入与产物复用同一摘要；并行提交只创建一次 | 无法规范化的草稿不会签发 | `node tools/workflow.mjs freeze` |
| 下载版本产物 | `GET /api/library/:id/asset` | 返回冻结资产原始字节、正确媒体类型和文件名 | 不存在的资产返回 404 | `node tools/workflow.mjs download` |
| 重启后复取 | `GET /api/library 与 GET /api/library/:id` | 恢复已有规范文档及成品校样摘要 | 未知或无法读取的版本不会替换当前校样 | `node tools/workflow.mjs reopen` |
| 完整性复核 | `GET /api/library/:id[/asset]` | 元数据与媒体字节读取前均核对内容摘要 | 磁盘内容不匹配时返回 409 | `node tools/workflow.mjs integrity` |

## 代码职责

| 模块 | 参与的生产工作流 |
| --- | --- |
| `product/document.mjs` | 逐像素合成、局部轮廓变换、几何遮罩链、透明度与混色、边缘子像素、导入文档 |
| `product/raster.mjs` | 逐像素合成、局部轮廓变换、几何遮罩链、透明度与混色、边缘子像素、连续局部校样 |
| `product/incremental.mjs` | 连续局部校样 |
| `product/png.mjs` | 逐像素合成、边缘子像素、连续局部校样 |
| `product/index.mjs` | 逐像素合成、导入文档、冻结校样、连续局部校样 |
| `product/transform.mjs` | 局部轮廓变换、连续局部校样 |
| `product/shapes.mjs` | 局部轮廓变换、几何遮罩链 |
| `product/masks.mjs` | 几何遮罩链、边缘子像素 |
| `product/color.mjs` | 透明度与混色 |
| `product/blend.mjs` | 透明度与混色 |
| `server/router.mjs` | 导入文档、冻结校样、下载版本产物、重启后复取、完整性复核、连续局部校样 |
| `server/preview-cache.mjs` | 连续局部校样 |
| `server/request-body.mjs` | 导入文档 |
| `server/library.mjs` | 冻结校样、下载版本产物、重启后复取、完整性复核 |
| `server/canonical.mjs` | 冻结校样、下载版本产物、重启后复取、完整性复核、连续局部校样 |
| `server/atomic-write.mjs` | 冻结校样 |
| `server/environment.mjs` | 重启后复取 |

`web/app.mjs`协调编辑与预览生命周期；`web/proof-session.mjs`纯逻辑管理请求序号、晚到响应丢弃与脏稿标记；`web/surface.mjs`装配本产品校样组件。HTML、CSS、DOM、Canvas 或 HTML Audio 均为原生，无前端框架。

## 存储和验证边界

请求 JSON 最多 6 MiB。预览不持久化：局部校样的基准像素只保存在进程内 LRU 缓存（默认 64 份，重启即失），冻结摘要绑定规则版本、规范文档、摘要指标和导出字节。单个文件通过同目录临时文件和排他硬链接发布，同内容重复提交复用原版本。复取会校验内容摘要；最近版本列表只显示最新 20 个。临时文件与最终目录需要位于支持硬链接的本机文件系统上。本应用不提供跨机器同步、账号权限或面向网络的部署。

### 连续局部校样规则

- 预览请求可发送 `{base, document}` 信封，`base` 为上一份成功提交的规范稿；不带信封或 `base` 为空时按整图渲染。
- 仅当画布尺寸、采样倍率、图层数量与顺序、各层静态声明（轮廓、颜色、不透明度、混合、遮罩引用、可见性）完全一致，且差异只包含隐藏层 `transform` 时，才走局部重算；移动可见层、改画布或采样倍率一律整图重算。冻结与重新打开冻结件不受影响。
- 受影响像素矩形由移动遮罩新旧变换包围盒，对所有子样点求并集得到。矩形内每个像素只计一次，不因子样点数量重复；矩形外像素只搬运或编码，不计入重算。
- 局部结果在矩形外复用基准像素、矩形内按新稿重算并拼回，再统一 PNG 编码；其画面、像素探针、非透明/半透明像素数、图层样本数与对新稿从头整图渲染逐字节一致。
- 每次提交获得单调序号；只有最新请求的成功结果能替换显示校样，较早请求的晚到结果或任何拒绝都不覆盖新校样，也不回写编辑器。拒绝或在途时可继续展示最近一次成功校样，但状态文案必须说明它不对应编辑器现稿。

完整自动化测试套件暂缓。`.project-runtime.json` 中的工作流命令从真实路由操作临时工作目录，不改变用户版本库。
