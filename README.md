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

在「源文档 → 从另一份墨版源稿合入徽记」中粘贴或选择第二份 JSON，勾选要带走的图层，并分别填写两份稿中的对位矩形。合入会保留矢量图层、遮罩链和逐层颜色/不透明度；非均匀对位产生的斜切由通用仿射变换渲染，边缘采样仍使用当前目标稿设置。超图层或渲染预算时不会改动当前 JSON 工作稿。也可向 `POST /api/merge` 提交 `{target,source,ids,sourceRect,targetRect}`。

更新校样只计算不落盘；冻结会写入版本库，下载原始 `.png` 资产。可在「冻结版本」中复取已保存版本。

## 检查

`npm run check` 检查所有 JavaScript 模块语法，`npm run demo` 通过本机 HTTP 服务演练核心产物。完整测试套件暂缓；[项目规格](PROJECT_SPEC.md)列出全部生产工作流检查和输入边界。
