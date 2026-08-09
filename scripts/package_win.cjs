// Wrapper de package:win que soluciona el bug de symlinks de 7za en Windows
// sin privilegios de admin.
//
// Estrategia: descargar winCodeSign-2.6.0.7z manualmente, extraerlo
// excluyendo la carpeta `darwin` (que tiene los symlinks problematicos),
// re-empaquetarlo en un .7z limpio, y servirlo en un servidor HTTP local
// (ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL).

const { spawn, spawnSync, execFileSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const repo = path.resolve(__dirname, '..');
const cacheRoot = path.join(repo, '.electron-builder-cache');
const workDir = path.join(cacheRoot, 'mirror-work');
const real7z = path.join(repo, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const mirrorDir = path.join(cacheRoot, 'mirror');
const mirrorPort = 18765;

if (!fs.existsSync(real7z)) {
  console.error('No se encontro 7za.exe. Ejecuta npm install primero.');
  process.exit(1);
}

const WIN_CODE_SIGN_URL = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z';
const WIN_CODE_SIGN_LOCAL = path.join(mirrorDir, 'winCodeSign-2.6.0.7z');

function ensureMirrored7z() {
  if (fs.existsSync(WIN_CODE_SIGN_LOCAL)) {
    console.log('[mirror] .7z ya preparado.');
    return;
  }

  console.log('[mirror] Preparando .7z sin symlinks de Darwin...');
  fs.mkdirSync(mirrorDir, { recursive: true });

  // 1. Descargar el .7z original
  const tempZip = path.join(workDir, 'winCodeSign-orig.7z');
  fs.mkdirSync(workDir, { recursive: true });
  if (!fs.existsSync(tempZip)) {
    console.log('[mirror] Descargando winCodeSign-2.6.0.7z...');
    execFileSync('curl', ['-L', '-o', tempZip, WIN_CODE_SIGN_URL], { stdio: 'inherit' });
  }

  // 2. Extraer excluyendo darwin/
  const extractDir = path.join(workDir, 'extracted');
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(extractDir, { recursive: true });
  console.log('[mirror] Extrayendo (excluyendo darwin/)...');
  execFileSync(real7z, ['x', '-y', '-bd', tempZip, `-o${extractDir}`, '-xr!darwin'], { stdio: 'inherit' });

  // 3. Re-empaquetar en un .7z limpio
  console.log('[mirror] Re-empaquetando .7z limpio...');
  execFileSync(real7z, ['a', '-bd', '-mx=5', WIN_CODE_SIGN_LOCAL, `${extractDir}/*`], { stdio: 'inherit' });

  // 4. Limpiar
  fs.rmSync(workDir, { recursive: true, force: true });
  console.log('[mirror] OK .7z limpio creado.');
}

function startMirrorServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/winCodeSign-2.6.0.7z') {
      const stat = fs.statSync(WIN_CODE_SIGN_LOCAL);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size });
      fs.createReadStream(WIN_CODE_SIGN_LOCAL).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  server.listen(mirrorPort, '127.0.0.1', () => {
    console.log(`[mirror] Sirviendo en http://127.0.0.1:${mirrorPort}/`);
    runElectronBuilder();
  });
  return server;
}

function runElectronBuilder() {
  const isWin = process.platform === 'win32';
  const ebBin = path.join(repo, 'node_modules', '.bin', isWin ? 'electron-builder.cmd' : 'electron-builder');
  const env = {
    ...process.env,
    ELECTRON_BUILDER_CACHE: cacheRoot,
    ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL: `http://127.0.0.1:${mirrorPort}`,
  };
  console.log('[build] Iniciando electron-builder con mirror local...');
  const proc = spawn(ebBin, ['--win'], {
    cwd: repo,
    stdio: 'inherit',
    shell: isWin,
    windowsHide: true,
    env,
  });
  proc.on('exit', (code) => {
    console.log(`[build] electron-builder exited (${code})`);
    process.exit(code ?? 0);
  });
}

ensureMirrored7z();
startMirrorServer();
