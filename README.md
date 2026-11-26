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

## 重复小图与离线铺贴

冻结版本后，可通过版本旁的「铺贴图」或校样标题栏的「导出铺贴小图」下载与原画布同尺寸、同采样设置的周期透明 PNG；接口为 `GET /api/library/:id/tile`。小图始终从冻结的规范矢量文档重算，不会拼接已裁掉画布外内容的普通校样。

打开 [`web/tile-proof.html`](web/tile-proof.html)（或服务运行时访问 `/tile-proof.html`）可在完全不读取原稿、不请求服务的情况下选择已交付的 PNG，按输出宽高、可负/小数的起点和 1–32 设计像素的输出像素边长生成面积平均铺贴校样。也可使用：

```sh
node tools/tile-proof.mjs tile.png --width 160 --height 120 --x -12.5 --y 8.25 --cell 2.5 --out proof.png
```

## 检查

`npm run check` 检查所有 JavaScript 模块语法，`npm run demo` 通过本机 HTTP 服务演练核心产物。完整测试套件暂缓；[项目规格](PROJECT_SPEC.md)列出全部生产工作流检查和输入边界。
