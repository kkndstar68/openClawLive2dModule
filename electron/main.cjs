const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const isDev = process.env.ELECTRON_DEV === '1';
const distPath = path.join(__dirname, '../dist/index.html');
const MCP_PORT = 3001;
const STOCK_PUSH_PORT = 18888;

let mainWindow = null;
let stockPushWss = null;

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

// 股票推送 WebSocket Server
function createStockPushServer() {
  stockPushWss = new WebSocket.Server({ port: STOCK_PUSH_PORT, host: '127.0.0.1' });
  
  console.log(`[StockPush] WS Server on ws://127.0.0.1:${STOCK_PUSH_PORT}`);
  
  stockPushWss.on('connection', (ws) => {
    console.log('[StockPush] 客户端已连接');
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('[StockPush] 收到消息:', message);
        
        if (message.type === 'ack') {
          console.log('[StockPush] 收到确认消息');
          return;
        }
        
        if (message.type === 'stock_alert' && mainWindow) {
          console.log('[StockPush] 转发股票推送到渲染进程:', message);
          mainWindow.webContents.send('stock-push', message);
        }
      } catch (error) {
        console.error('[StockPush] 解析消息失败:', error);
      }
    });
    
    ws.on('close', () => {
      console.log('[StockPush] 客户端断开连接');
    });
    
    ws.on('error', (error) => {
      console.error('[StockPush] WebSocket 错误:', error);
    });
  });
  
  stockPushWss.on('error', (error) => {
    console.error('[StockPush] Server 错误:', error);
  });
  
  // 每30秒 ping 所有客户端
  setInterval(() => {
    if (stockPushWss) {
      stockPushWss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.ping();
        }
      });
    }
  }, 30000);
}

createStockPushServer();

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

// 优雅关闭所有服务器
function cleanupAndQuit() {
  console.log('[Exit] 开始清理资源...');
  
  // 关闭股票推送 WebSocket 服务器
  if (stockPushWss) {
    stockPushWss.close((err) => {
      if (err) {
        console.error('[Exit] 关闭股票推送 WS 服务器失败:', err);
      } else {
        console.log('[Exit] 股票推送 WS 服务器已关闭');
      }
    });
    stockPushWss = null;
  }
  
  // 关闭 MCP HTTP 服务器
  server.close((err) => {
    if (err) {
      console.error('[Exit] 关闭 MCP 服务器失败:', err);
    } else {
      console.log('[Exit] MCP 服务器已关闭');
    }
  });
  
  // 强制退出进程
  setTimeout(() => {
    console.log('[Exit] 强制退出进程');
    process.exit(0);
  }, 500);
}

app.on('window-all-closed', () => {
  cleanupAndQuit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// 监听窗口关闭事件，确保进程完全退出
ipcMain.on('window-close', () => {
  const w = BrowserWindow.getFocusedWindow();
  if (w) w.close();
  cleanupAndQuit();
});

// 监听应用退出事件
app.on('before-quit', () => {
  console.log('[Exit] before-quit 事件触发');
});

app.on('will-quit', () => {
  console.log('[Exit] will-quit 事件触发');
  cleanupAndQuit();
});

// 监听未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('[Exit] 未捕获异常:', error);
  cleanupAndQuit();
});

// 监听 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Exit] Promise 拒绝:', reason);
  cleanupAndQuit();
});
