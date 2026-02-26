const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = process.env.ELECTRON_DEV === '1';
const distPath = path.join(__dirname, '../dist/index.html');

ipcMain.on('window-close', () => {
  const w = BrowserWindow.getFocusedWindow();
  if (w) w.close();
});

ipcMain.on('window-minimize', () => {
  const w = BrowserWindow.getFocusedWindow();
  if (w) w.minimize();
});

function createWindow() {
  const win = new BrowserWindow({
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
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else if (fs.existsSync(distPath)) {
    win.loadFile(distPath);
  } else {
    win.loadURL('http://localhost:5173');
  }

  win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
