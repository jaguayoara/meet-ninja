/**
 * Tipos del preload bridge, separados del .cjs que se ejecuta en runtime.
 * El renderer importa MeetNinjaApi desde aca para tipar window.meetninja.
 */
export type MeetNinjaApi = {
  getVersion: () => Promise<string>;
  getPlatform: () => Promise<NodeJS.Platform>;
  getPythonUrl: () => Promise<string>;

  openAudioDialog: () => Promise<string | null>;
  readAudioFile: (path: string) => Promise<{ name: string; size: number; mime: string; dataBase64: string }>;
  saveFileDialog: (defaultName: string) => Promise<string | null>;
  showInFolder: (p: string) => Promise<unknown>;

  getDesktopSources: () => Promise<{ id: string; name: string }[]>;

  onMenuOpenAudio: (cb: () => void) => () => void;
  onUpdateAvailable: (cb: (info: unknown) => void) => () => void;
  onUpdateDownloaded: (cb: (info: unknown) => void) => () => void;
};
