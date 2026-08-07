---
name: remotion-video-review-station
description: 搭建和运行“小滕的审片工具台”，通过源文件路径无缓存载入单条或多条已渲染 Remotion 视频，按时间点和画面选框记录修改建议，汇总为可直接执行的 Remotion 修改与重新渲染提示词。用户提到小滕的审片工具台、视频审片、视频批注、选框修改、批量审片、重新渲染、审片台、预览台，或要求以后生成的视频先统一提修改意见时使用。
---

# 小滕的审片工具台

## 核心原则

- 只把已渲染视频作为审片输入，不把示例动效或文字卡片作为入口。
- 只记录源视频绝对路径和会话清单，不复制、上传或缓存视频文件。
- 不使用浏览器文件选择器、`URL.createObjectURL` 或 `copyFileSync` 复制媒体。
- 把每条意见绑定到视频 ID、时间点和百分比选框坐标。
- 多条视频分别批注，最后汇总为一次修改请求。
- 用户提交意见后，直接修改对应 Remotion 源项目并重新渲染，不只整理文档。

## 建立工具

先检查当前项目是否已有兼容审片台。已有时优先复用；没有时运行：

```bash
node <skill目录>/scripts/scaffold-review-station.mjs <目标目录>
```

进入目标目录后安装依赖并构建：

```bash
npm install
npm run build
```

不要把 `node_modules`、`dist`、视频、截图、浏览器日志或会话缓存提交到项目仓库。

## 接入视频

先确认每个源文件存在，再从审片台目录运行：

```bash
npm run load -- /absolute/path/video.mp4 "视频标题"
```

多条视频使用：

```bash
npm run load -- /absolute/path/01.mp4 /absolute/path/02.mp4 --title "本期视频"
```

加载脚本只能更新 `public/review-sessions/current.json`。清单中的 `videoUrl` 使用 Vite `/@fs` 源文件访问，`sourcePath` 必须保留绝对路径，供后续定位 Remotion 项目。

运行并打开固定地址：

```bash
npm run station
```

默认地址为 `http://127.0.0.1:4328/`。端口占用时先确认是否已有审片台服务；不要无故启动多个实例。

## 审片交互

保持以下行为：

1. 鼠标按下点是选框左上角，只向右下角拉出选框。
2. 完成选框后在预览区中央弹出意见输入框，Enter 保存，Shift+Enter 换行。
3. 标记只在对应时间点附近显示，继续播放时不覆盖其他画面。
4. 空格切换播放和暂停；输入框、按钮和弹窗内按空格不触发播放。
5. 支持清除本条标记、清除全部标记和始终可见的清空视频列表。
6. 多条视频的意见按视频隔离展示，并在提交时合并。
7. 复制提示词后只让文本框变绿，保持一秒后关闭弹窗。

## 执行修改

收到审片台生成的提示词后：

1. 根据每条意见的源文件、时间点和选框坐标定位对应 Remotion composition 与画面元素。
2. 直接修改代码、文案、布局或素材。
3. 重新渲染到原项目 `renders` 或既定输出目录。
4. 把新版视频重新通过源路径载入审片台，供下一轮确认。
5. 源文件被删除后，不保留副本，也不继续在列表中显示。

## 验证

每次修改审片台后至少执行：

```bash
npm run build
```

接入实际视频后检查：

```bash
cat public/review-sessions/current.json
find public/review-sessions -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.m4v' \) -print
```

确认清单含正确 `sourcePath`，第二条命令无输出。再在浏览器验证视频可播放、选框起点准确、意见可汇总、空格播放暂停和清空列表。

模板源码位于 `assets/review-station/`。只在建立新审片台或修复兼容实现时读取和复制它。
