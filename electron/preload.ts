/**
 * Meet Ninja - Electron preload.
 * Expone una API minima y segura al renderer via contextBridge.
 * Sin nodeIntegration, con contextIsolation.
 */
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  getPlatform: (): Promise<NodeJS.Platform> => ipcRenderer.invoke('app:get-platform'),
  getPythonUrl: (): Promise<string> => ipcRenderer.invoke('app:get-python-url'),

  openAudioDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:open-audio'),
  readAudioFile: (path: string): Promise<{ name: string; size: number; mime: string; dataBase64: string }> =>
    ipcRenderer.invoke('fs:read-audio', path),
  saveFileDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:save-file', defaultName),
  showInFolder: (p: string): Promise<unknown> => ipcRenderer.invoke('shell:show-in-folder', p),

  onMenuOpenAudio: (cb: () => void): (() => void) => {
    const fn = () => cb();
    ipcRenderer.on('menu:open-audio', fn);
    return () => {
      ipcRenderer.removeListener('menu:open-audio', fn);
    };
  },

  onUpdateAvailable: (cb: (info: unknown) => void): (() => void) => {
    const fn = (_e: unknown, info: unknown) => cb(info);
    ipcRenderer.on('update:available', fn);
    return () => {
      ipcRenderer.removeListener('update:available', fn);
    };
  },
  onUpdateDownloaded: (cb: (info: unknown) => void): (() => void) => {
    const fn = (_e: unknown, info: unknown) => cb(info);
    ipcRenderer.on('update:downloaded', fn);
    return () => {
      ipcRenderer.removeListener('update:downloaded', fn);
    };
  },
};

contextBridge.exposeInMainWorld('meetninja', api);

export type MeetNinjaApi = typeof api;
