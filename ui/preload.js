const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('emd', {
  requestList: () => ipcRenderer.send('emd:request-list'),
  onList: (cb) => ipcRenderer.on('emd:list', (_evt, list) => cb(list)),
  onActive: (cb) => ipcRenderer.on('emd:active', (_evt, id) => cb(id)),
  openDevTools: (id) => ipcRenderer.send('emd:open-devtools', id),
  destroyDevtools: (id) => ipcRenderer.send('emd:destroy-devtools', id),
  activate: (id) => ipcRenderer.send('emd:activate', id),
  focus: (id) => ipcRenderer.send('emd:focus', id),
  refresh: () => ipcRenderer.send('emd:refresh'),
});
