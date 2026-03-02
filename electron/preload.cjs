const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  close: () => ipcRenderer.send('window-close'),
  minimize: () => ipcRenderer.send('window-minimize'),
  onOpenClawMessage: (callback) => ipcRenderer.on('openclaw-message', (event, message) => callback(message))
});
