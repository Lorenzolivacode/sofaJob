const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboardAPI', {
  launchSession: (opts) => ipcRenderer.invoke('launch-session', opts),
  getRelayInfo: () => ipcRenderer.invoke('get-relay-info'),
  listAliases: () => ipcRenderer.invoke('list-aliases'),
  addAlias: (name, shells) => ipcRenderer.invoke('add-alias', { name, shells }),
  shellStatus: () => ipcRenderer.invoke('shell-status'),
});
