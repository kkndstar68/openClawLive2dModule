const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const isDev = process.env.ELECTRON_DEV === '1';
const distPath = path.join(__dirname, '../dist/index.html');
const MCP_PORT = 3001;

let mainWindow = null;

// MCP server 处理工具调用
function handleMcpRequest(body) {
  const { method, params } = body;
  
  if (method === 'tools/call' && params.name === 'send_to_pet') {
    // 通过 IPC 发送到渲染进程
    if (mainWindow) {
      mainWindow.webContents.send('openclaw-message', params.arguments.text);
    }
    return { content: [{ type: 'text', text: 'OK' }] };
  }
  
  return { error: 'Unknown method' };
}

// HTTP MCP 端点
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/mcp') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const result = handleMcpRequest(JSON.parse(body));
        res.end(JSON.stringify(result));
      } catch (error) {
        console.error('MCP 请求处理错误:', error);
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
  }
});

server.listen(MCP_PORT);
console.log(`MCP server running on port ${MCP_PORT}`);

ipcMain.on('window-close', () => {
  const w = BrowserWindow.getFocusedWindow();
  if (w) w.close();
});

ipcMain.on('window-minimize', () => {
  const w = BrowserWindow.getFocusedWindow();
  if (w) w.minimize();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 680,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // 允许跨域请求
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else if (fs.existsSync(distPath)) {
    mainWindow.loadFile(distPath);
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // 无论什么平台，都直接退出应用
  app.quit();
  // 关闭 MCP 服务器
  server.close();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// 监听窗口关闭事件，确保进程完全退出
ipcMain.on('window-close', () => {
  const w = BrowserWindow.getFocusedWindow();
  if (w) w.close();
  // 直接退出应用
  app.quit();
  // 关闭 MCP 服务器
  server.close();
});
