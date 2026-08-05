/**
 * Meet Ninja - Electron main process.
 *
 * Responsabilidades:
 *  - Crear la ventana principal (BrowserWindow).
 *  - Spawnear el backend Python embebido al iniciar y apagarlo al salir.
 *  - Exponer IPC seguro via preload (contextIsolation + sin nodeIntegration).
 *  - Auto-update desde GitHub Releases (electron-updater).
 *  - Menu nativo y atajos basicos.
 */
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, type MenuItemConstructorOptions } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --------------------------------------------------------------------
// Config
// --------------------------------------------------------------------
const isDev = !app.isPackaged;
const PY_PORT = process.env.MEETNINJA_PORT || '8765';
const PY_URL = `http://127.0.0.1:${PY_PORT}`;

// --------------------------------------------------------------------
// Estado
// --------------------------------------------------------------------
let mainWindow: BrowserWindow | null = null;
let pyProcess: import('node:child_process').ChildProcess | null = null;

// --------------------------------------------------------------------
// Python backend
// --------------------------------------------------------------------
function getPythonPath(): string {
  // En produccion el backend esta en process.resourcesPath/python_backend
  // En dev esta en ../python_backend
  if (app.isPackaged) {
    const resources = process.resourcesPath;
    const isWin = process.platform === 'win32';
    const venvPython = join(
      resources,
      'python_backend',
      '.venv',
      isWin ? 'Scripts' : 'bin',
      isWin ? 'python.exe' : 'python',
    );
    if (existsSync(venvPython)) return venvPython;
    return join(resources, 'python_backend', 'main.py');
  }
  // dev: ../python_backend/.venv/Scripts/python.exe o ../python_backend/main.py
  const devBackend = resolve(__dirname, '..', 'python_backend');
  const isWin = process.platform === 'win32';
  const venvPython = join(
    devBackend,
    '.venv',
    isWin ? 'Scripts' : 'bin',
    isWin ? 'python.exe' : 'python',
  );
  if (existsSync(venvPython)) return venvPython;
  return join(devBackend, 'main.py');
}

function getPythonArgs(): string[] {
  if (app.isPackaged) {
    return [join(process.resourcesPath, 'python_backend', 'main.py')];
  }
  return [resolve(__dirname, '..', 'python_backend', 'main.py')];
}

function startPython(): void {
  if (pyProcess) return;
  const py = getPythonPath();
  const args = getPythonArgs();
  const isMain = py.endsWith('.py');
  const exe = isMain ? (process.platform === 'win32' ? 'python' : 'python3') : py;
  const finalArgs = isMain ? [args[0], ...args.slice(1)] : args;

  console.log(`[main] Iniciando backend Python: ${exe} ${finalArgs.join(' ')}`);
  const proc = spawn(exe, finalArgs, {
    env: { ...process.env, MEETNINJA_PORT: PY_PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pyProcess = proc;

  proc.stdout?.on('data', (d) => {
    process.stdout.write(`[python] ${d}`);
  });
  proc.stderr?.on('data', (d) => {
    process.stderr.write(`[python-err] ${d}`);
  });
  proc.on('exit', (code) => {
    console.log(`[main] Backend Python salio con codigo ${code}`);
    if (pyProcess === proc) pyProcess = null;
  });
  proc.on('error', (e) => {
    console.error('[main] No se pudo iniciar el backend Python:', e);
    if (pyProcess === proc) pyProcess = null;
  });
}

function stopPython(): void {
  if (!pyProcess) return;
  try {
    pyProcess.kill();
  } catch (e) {
    console.warn('[main] Error matando proceso Python:', e);
  }
  pyProcess = null;
}

async function waitForPython(timeoutMs = 30000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${PY_URL}/health`);
      if (r.ok) return true;
    } catch {
      // todavia arrancando
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// --------------------------------------------------------------------
// Ventana
// --------------------------------------------------------------------
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'Meet Ninja',
    backgroundColor: '#0e1117',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  }

  // Abrir links externos en el navegador del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --------------------------------------------------------------------
// IPC handlers
// --------------------------------------------------------------------
function setupIpc(): void {
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:get-platform', () => process.platform);
  ipcMain.handle('app:get-python-url', () => PY_URL);

  ipcMain.handle('dialog:open-audio', async () => {
    if (!mainWindow) return null;
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar audio',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'ogg', 'flac', 'webm', 'aac', 'mp4'] },
      ],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('fs:read-audio', async (_e, path: string) => {
    /**
     * Lee un archivo de audio y devuelve sus bytes + metadatos para que
     * el renderer pueda armar un Blob y enviarlo al backend.
     * Devuelve { name, size, mime, dataBase64 } o lanza.
     */
    try {
      const stat = statSync(path);
      if (!stat.isFile()) throw new Error('No es un archivo');
      if (stat.size > 500 * 1024 * 1024) throw new Error('Archivo demasiado grande (>500MB)');
      const buf = readFileSync(path);
      const ext = extname(path).toLowerCase().replace('.', '');
      const mimeMap: Record<string, string> = {
        wav: 'audio/wav',
        mp3: 'audio/mpeg',
        m4a: 'audio/mp4',
        mp4: 'audio/mp4',
        ogg: 'audio/ogg',
        flac: 'audio/flac',
        webm: 'audio/webm',
        aac: 'audio/aac',
      };
      const name = path.split(/[\\/]/).pop() || `audio.${ext}`;
      return {
        name,
        size: stat.size,
        mime: mimeMap[ext] || 'application/octet-stream',
        dataBase64: buf.toString('base64'),
      };
    } catch (e) {
      throw new Error(`No se pudo leer el archivo: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  ipcMain.handle('dialog:save-file', async (_e, defaultName: string) => {
    if (!mainWindow) return null;
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar',
      defaultPath: defaultName,
    });
    if (r.canceled || !r.filePath) return null;
    return r.filePath;
  });

  ipcMain.handle('shell:show-in-folder', (_e, p: string) => {
    shell.showItemInFolder(p);
  });
}

// --------------------------------------------------------------------
// Menu nativo
// --------------------------------------------------------------------
function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Abrir audio...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-audio'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edicion',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Acerca de Meet Ninja',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'Meet Ninja',
              message: 'Meet Ninja',
              detail: `Version ${app.getVersion()}\n\nTranscripcion y resumen de reuniones con IA, 100% local.\n\nPor Jorge Aguayo.`,
              buttons: ['OK'],
            });
          },
        },
        {
          label: 'Codigo fuente en GitHub',
          click: () => shell.openExternal('https://github.com/jaguayoara/meet-ninja'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --------------------------------------------------------------------
// Auto-update
// --------------------------------------------------------------------
function setupAutoUpdate(): void {
  if (isDev) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', info);
  });
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update:downloaded', info);
  });
  autoUpdater.on('error', (err) => {
    console.error('[auto-updater]', err);
  });
  // silenciar check
  autoUpdater.checkForUpdates().catch(() => undefined);
}

// --------------------------------------------------------------------
// Lifecycle
// --------------------------------------------------------------------
app.whenReady().then(async () => {
  startPython();
  const ok = await waitForPython();
  if (!ok) {
    console.error('[main] El backend Python no arranco a tiempo');
    if (mainWindow == null) {
      // todavia no se creo, mostrar error en una ventana simple
      const { dialog } = await import('electron');
      await dialog.showMessageBox({
        type: 'error',
        title: 'Meet Ninja - Error',
        message: 'No se pudo iniciar el backend Python',
        detail: 'Verifica que Python 3.10+ este instalado y que ejecutaste scripts\\setup-python.ps1 al menos una vez.',
      });
      app.quit();
      return;
    }
  }

  setupIpc();
  buildMenu();
  createWindow();
  setupAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopPython();
});

// Flags de seguridad
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    // permitir solo localhost en dev o file:// en prod
    if (url.startsWith('http://127.0.0.1:5173') || url.startsWith('file://')) return;
    e.preventDefault();
    shell.openExternal(url);
  });
});
