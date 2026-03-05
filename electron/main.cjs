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
  console.log('========== MCP 请求详情 ==========');
  console.log('请求方法:', body.method);
  console.log('请求参数:', JSON.stringify(body.params, null, 2));
  
  const { method, params } = body;
  
  if (method === 'tools/call' && params.name === 'send_to_pet') {
    console.log('✅ 识别到 send_to_pet 工具调用');
    console.log('要发送的消息:', params.arguments.text);
    
    // 通过 IPC 发送到渲染进程
    if (mainWindow) {
      console.log('✅ 发送 IPC 消息到渲染进程');
      mainWindow.webContents.send('openclaw-message', params.arguments.text);
    } else {
      console.error('❌ mainWindow 未定义，无法发送 IPC 消息');
    }
    
    console.log('========================================');
    return { content: [{ type: 'text', text: 'OK' }] };
  }
  
  console.log('⚠️ 未知的请求方法:', method);
  console.log('========================================');
  return { error: 'Unknown method' };
}

// HTTP MCP 端点
const server = http.createServer((req, res) => {
  console.log('========== 收到 HTTP 请求 ==========');
  console.log('请求方法:', req.method);
  console.log('请求 URL:', req.url);
  console.log('请求头:', JSON.stringify(req.headers, null, 2));
  
  if (req.method === 'POST' && req.url === '/mcp') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      console.log('接收数据块，当前长度:', body.length);
    });
    req.on('end', () => {
      console.log('请求体:', body);
      try {
        const parsedBody = JSON.parse(body);
        console.log('解析后的请求体:', JSON.stringify(parsedBody, null, 2));
        
        const result = handleMcpRequest(parsedBody);
        console.log('MCP 响应:', JSON.stringify(result, null, 2));
        res.end(JSON.stringify(result));
      } catch (error) {
        console.error('❌ MCP 请求处理错误:', error);
        console.error('错误堆栈:', error.stack);
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
  } else {
    console.log('⚠️ 请求不匹配，返回 404');
    res.statusCode = 404;
    res.end('Not Found');
  }
  console.log('========================================');
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
