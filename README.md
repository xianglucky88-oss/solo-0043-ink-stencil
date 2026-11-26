# 墨版 · 矢量遮罩合成校样

按局部轮廓、遮罩相交和混色逐像素生成画面；在透明背景上检查画面、像素与图层，冻结并下载 PNG。

## 启动

需要 Node.js 20 或更新版本，无需安装第三方依赖。

```sh
npm start
```

浏览器打开 `http://127.0.0.1:8742`。项目只监听本机回环地址；用 `PORT` 可换端口。`MEDIA_HOME` 可指定数据目录，默认 `.local/`，不进 Git。

## 校样

载入样例后用键盘方向键检查邻接像素，再切换采样数或画布底色对照。

可以导入 JSON，或者在「源文档」区域编辑。获取可导入样例：`curl -s http://127.0.0.1:8742/api/demo | node -e 'process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.stringify(JSON.parse(s).document,null,2)));let s=""'`。
更新校样只计算不落盘；冻结会写入版本库，下载原始 `.png` 资产。可在「冻结版本」中复取已保存版本。

## 检查

`npm run check` 检查所有 JavaScript 模块语法，`npm run demo` 通过本机 HTTP 服务演练核心产物。完整测试套件暂缓；[项目规格](PROJECT_SPEC.md)列出全部生产工作流检查和输入边界。

## 旧徽记 PNG 恢复

只接收宽、高各为 **16–64 px 的静态 PNG**。颜色空间声明按以下口径受理：

- 没有任何颜色空间块的旧 PNG，按 sRGB 读取；
- 带 `sRGB` 块、或声明一致的 sRGB 兼容 `gAMA`/`cHRM`、或可识别为 sRGB 的 ICC 配置，受理；
- 明确的非 sRGB 声明（非 sRGB 的 `iCCP`/`cICP`、偏离 sRGB 的 `gAMA`/`cHRM`）以及互相冲突的声明（如 `sRGB` 与非 sRGB `iCCP` 并存、重复颜色空间块）一律拒绝并说明原因，当前工作稿保持不变。

像素必须只有全透明（alpha 0）或全不透明（alpha 255）两态；所有不透明像素合计只能有 1–2 种可由 8 位 RGB 精确表示的颜色（16 位通道要求高低字节相同）。全透明像素中隐藏的 RGB 不参与颜色统计。

恢复结果是纯矢量工作文档，可直接冻结，重开后不再需要原 PNG：

- 每种颜色一个图层（`shape.kind: 'contours'`），层内按 **4-共边连通** 拆成独立可编辑的 `pieces`；仅顶角相接的像素是不同分块；
- 每个分块由外轮廓 `points` 与透明孔 `holes` 组成（同时给出 `rings`），改一个分块的边界点不会牵动其他分块；
- 轮廓落在像素格线上，因此在原尺寸下，每轴 1 倍或 2 倍采样都逐像素复现原 PNG 的可见颜色与透明区域；
- 整层支持换色、旋转、不等比缩放、混合与遮罩；用带孔/多块的恢复层做隐藏遮罩时，孔和分块间隙仍被裁成透明。

页面右上角「导入 PNG 恢复」选择文件即可；拒绝时顶部状态条给出原因且保留当前稿。

HTTP 接口（脚本可用 raw `image/png`、multipart 或 JSON `{ "png": "<base64 或 data-url>" }`）：

```sh
curl -s --data-binary @mark.png -H 'Content-Type: image/png' http://127.0.0.1:8742/api/recover
node tools/workflow.mjs recover   # 验收：双声明一致性、17 分块、孔、1/2 采样逐像素、遮罩、冻结复取
```

`POST /api/preview` 与 `POST /api/library` 也接受同样的 `{ png }` 信封或 raw PNG 字节。
