const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    fetchManifest: () => ipcRenderer.invoke('fetch-manifest'),
    verifyFiles: (files, gamePath) => ipcRenderer.invoke('verify-files', files, gamePath),
    launchGame: (gamePath) => ipcRenderer.invoke('launch-game', gamePath),
    onVerifyProgress: (callback) => ipcRenderer.on('verify-progress', (event, data) => callback(data))
});
