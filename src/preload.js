const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, cb) {
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, (_event, payload) => cb(payload));
}

contextBridge.exposeInMainWorld('petAPI', {
  isElectron: true,
  ready: () => ipcRenderer.send('pet:ready'),
  getState: () => ipcRenderer.invoke('pet:state-get'),
  onState: cb => listen('pet:state', cb),
  onAction: cb => listen('pet:action', cb),
  onDenied: cb => listen('pet:denied', cb),
  requestHop: () => ipcRenderer.send('pet:request-hop'),
  setInteractive: value => ipcRenderer.send('pet:set-interactive', value),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('pet:drag-move', { dx, dy }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  contextMenu: () => ipcRenderer.send('pet:context-menu'),
  openSettings: () => ipcRenderer.send('pet:open-settings'),
  setState: patch => ipcRenderer.send('settings:set', patch),
  closeSettings: () => ipcRenderer.send('settings:close'),
  quit: () => ipcRenderer.send('app:quit'),
  resetPosition: () => ipcRenderer.send('app:reset-position')
});
