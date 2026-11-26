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

## 墨版与套印校样

每层可在「墨版分色」里指定 `plate: "a" | "b" | null`（归哪支墨）与 `overprint: true | false`（`true` 叠印，`false` 挖空）。未指定墨版的层不下墨；屏幕 `color` 与 `blend` 不参与分色。隐藏层（如裁边）只做几何遮罩，不下墨。

`POST /api/preview` 的响应在旧的彩色校样 `base64` 之外，同时给出两张墨版：`plateFiles[0/1].base64`（也可用 `plateABase64` / `plateBBase64` 或 `plates[0/1]` 的对象形式，另有 `plateA`、`a` 等裸 base64 别名）。独立接口 `POST /api/plates` 只出墨版。版文件是与画布同尺寸、不带透明度的非隔行 8 位灰度 PNG（颜色类型 0），灰度 `0` 无墨、`255` 满墨。

分色规则（逐子样点）：有效不透明度 `α = color AA × opacity`；本墨量按 `墨 ← 1 − (1−墨)(1−α)` 增长；叠印不动另一支墨，挖空把另一支墨乘以 `(1−α)`。像素灰度是该像素各子样点墨量的平均值乘 255，四舍五入、半值向上取整。自检：`node tools/workflow.mjs plate`（等价别名 `plates`、`ink`、`overprint`）。

不打开源稿也能在「版文件 · 白纸套印校样」里直接选两张手头的灰度版 PNG：选其中一版按整像素横/竖挪位，另一版与纸面尺寸不变，版外无墨、移出纸面的墨迹不显示。每支墨可用取色器指定 8 位 sRGB 满印模拟色。单墨在白与满印色之间按墨量线性变化（编码值空间），两墨重叠时各归一化通道为两支单墨通道之积，结果四舍五入、半值向上。两版尺寸不一致或不是非隔行 8 位灰度 PNG 时不出校样。

同样的校样也可通过 HTTP 调用（JSON base64 或 `multipart/form-data` 上传文件均可）：

```sh
curl -s -X POST http://127.0.0.1:8742/api/plate-proof \
  -H 'Content-Type: application/json' \
  -d '{"a":"<灰度PNG base64>","b":"<灰度PNG base64>",
       "colorA":"#009fe3","colorB":"#e5007d",
       "shiftA":{"dx":1,"dy":0},"shiftB":{"dx":0,"dy":0}}'
# -> { "width", "height", "base64": "<不透明 RGB PNG>" }
```

## 检查

`npm run check` 检查所有 JavaScript 模块语法，`npm run demo` 通过本机 HTTP 服务演练核心产物。完整测试套件暂缓；[项目规格](PROJECT_SPEC.md)列出全部生产工作流检查和输入边界。
