# Live2D 浮窗 - Electron 使用说明

## 已完成的改造

- **Electron 主进程**：`electron/main.cjs` — 透明、无边框、可拖拽窗口
- **预加载脚本**：`electron/preload.cjs` — 提供关闭/最小化给渲染进程
- **Vite**：`vite.config.ts` 中 `base: './'`，打包后支持 `file://` 加载
- **入口页**：`index.html` 顶部 32px 拖拽条 + 最小化/关闭按钮（仅在 Electron 下显示）
- **模型路径**：`main.ts` 使用 `import.meta.env.BASE_URL`，浏览器与打包后均可用

## 安装依赖

```bash
npm install
```

若 Electron 下载失败（国内可设镜像）：

```bash
# Windows PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

## 使用方式

### 开发（Vite 热更 + Electron 窗口）

先在一个终端启动 Vite，再在另一个终端启动 Electron：

```bash
# 终端 1
npm run dev

# 终端 2（等 Vite 就绪后）
npm run electron:start
```

或一键启动（自动先等 Vite 再开 Electron）：

```bash
npm run electron:dev
```

### 打包后运行

```bash
npm run build
npm run electron:start
```

窗口会从 `dist/index.html` 加载，模型从 `dist/galgame/...` 读取（`public` 会复制到 `dist`）。

## 窗口行为

- **拖拽**：按住顶部灰色条（32px 高）拖动可移动窗口
- **关闭**：点击右上角 ×
- **最小化**：点击 −
- 模型区域仍支持鼠标跟随与点击动作（与浏览器一致）
