# 墨版 · 项目规格

## 使用场景

动态图形设计师使用局部坐标矢量图层、仿射参数、遮罩引用、混合模式及输出尺寸。按局部轮廓、遮罩相交和混色逐像素生成画面；在透明背景上检查画面、像素与图层，冻结并下载 PNG。
样例在本机合成，页面展示生产工作流，无需外部服务。

## 业务和数据规则

- `width,height` 为 16–512 px，`samples` 为 1 或 2，最多 16 层。`width × height × samples² × layers` 不超过 8,000,000。
- `layers` 从底到顶排列。轮廓为 `ellipse`、`rect`（支持半径 `radius`）或 `diamond`。局部原点在形状中心；`transform` 先沿 X/Y 缩放、再旋转（屏幕坐标下正角顺时针）、最后移动中心。
- 遮罩按图层唯一 ID 引用，可指向画面堆栈中的任意位置，与图层叠放顺序无关；调换层序只改变有色区域的遮盖，不重接已有裁边关系。旧写法 `mask` 为空或指向单个图层 ID，等价于单遮罩交集。
- 新写法 `masks` 为 1–2 项：首项 `operation` 为 `intersect`，与自身轮廓取交集；第二项用 `union` 把遮罩轮廓并入，或用 `subtract` 从第一个遮罩轮廓里扣除。取用的是每个遮罩按当前放置和自身裁边后留下的轮廓。
- 对每个子样点做布尔几何组合，而不是叠加两张已经平滑的遮罩；两倍采样时扣孔或拼接即使经过像素中心，也保留图案原色与正确的半透明边，不漏出半透明圈。遮罩不读取颜色、`visible` 或透明度：隐藏层、透明色或零不透明度的图层仍提供完整轮廓，但本身不绘制。
- 找不到的遮罩、自引用或绕一圈回到自身的成环关系，更新校样与冻结都拒绝该文档，不会以未裁画面顶替。
- 颜色为 `#RRGGBB` 或 `#RRGGBBAA`，`opacity` 与颜色 alpha 相乘。`normal`、`multiply`、`screen` 在输入编码的 RGB 数值空间按 source-over 合成。采样后平均预乘值，再还原到直通 alpha RGBA PNG；完全透明的像素编码为零。
- `hits` 统计绘制时通过几何的子样点，不等于最后仍可见的贡献。页面的 Canvas 像素读数遵循浏览器的颜色/alpha 表示；PNG 原始字节以下载件为准。

## 工作流

| 工作流 | 接口 | 正常结果 | 替代或失败结果 | 生产检查 |
| --- | --- | --- | --- | --- |
| 逐像素合成 | `POST /api/preview` | 在有限预算内输出带透明的 PNG 与像素统计 | 非法画布尺寸或轮廓拒绝 | `node tools/workflow.mjs proof` |
| 局部轮廓变换 | `POST /api/preview 的 transform` | 旋转和缩放后仍按局部轮廓判覆盖 | 零缩放拒绝 | `node tools/workflow.mjs transform` |
| 几何遮罩图 | `POST /api/preview 的 mask/masks` | 任意堆栈位置的遮罩按交/并/扣参与子样点布尔裁边，隐藏遮罩不着色 | 缺失、自引用或成环拒绝，更新与冻结均不签发 | `node tools/workflow.mjs masks` |
| 透明度与混色 | `POST /api/preview 的 blend` | 正常、乘色和滤色按图层顺序合成 | 未知色值或混合模式拒绝 | `node tools/workflow.mjs blend` |
| 边缘子像素 | `POST /api/preview 的 samples` | 网格子样点先合成后求平均，输出保留边缘透明度 | 超过预算拒绝 | `node tools/workflow.mjs sampling` |
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
