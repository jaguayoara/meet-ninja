/**
 * Meet Ninja - Electron preload (CommonJS).
 *
 * Por que .cjs y no .js? El package.json raiz tiene "type": "module",
 * lo que hace que todos los .js (incluido el preload) se traten como
 * ESM. Pero Electron, al ejecutar preload scripts, los corre como
 * scripts (no como modulos), y el `import` ESM falla silenciosamente,
 * resultando en que window.meetninja queda undefined en el renderer.
 *
 * Usar .cjs fuerza el tratamiento CommonJS y resuelve el problema.
 */
const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  getPythonUrl: () => ipcRenderer.invoke('app:get-python-url'),

  openAudioDialog: () => ipcRenderer.invoke('dialog:open-audio'),
  readAudioFile: (path) => ipcRenderer.invoke('fs:read-audio', path),
  saveFileDialog: (defaultName) => ipcRenderer.invoke('dialog:save-file', defaultName),
  showInFolder: (p) => ipcRenderer.invoke('shell:show-in-folder', p),

  getDesktopSources: () => ipcRenderer.invoke('desktop-capturer:get-sources'),

  onMenuOpenAudio: (cb) => {
    const fn = () => cb();
    ipcRenderer.on('menu:open-audio', fn);
    return () => {
      ipcRenderer.removeListener('menu:open-audio', fn);
    };
  },

  onUpdateAvailable: (cb) => {
    const fn = (_e, info) => cb(info);
    ipcRenderer.on('update:available', fn);
    return () => {
      ipcRenderer.removeListener('update:available', fn);
    };
  },
  onUpdateDownloaded: (cb) => {
    const fn = (_e, info) => cb(info);
    ipcRenderer.on('update:downloaded', fn);
    return () => {
      ipcRenderer.removeListener('update:downloaded', fn);
    };
  },
};

contextBridge.exposeInMainWorld('meetninja', api);
