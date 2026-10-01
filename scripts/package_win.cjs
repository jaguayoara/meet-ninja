// Wrapper de package:win para Windows SIN privilegios de administrador.
//
// PROBLEMA QUE RESUELVE
// ---------------------
// app-builder.exe (el binario Go de electron-builder) descarga y extrae
// `winCodeSign-2.6.0.7z` para firmar los .exe. Ese .7z contiene la carpeta
// `darwin/10.12/lib/` con dos symlinks POSIX (libcrypto.dylib, libssl.dylib).
// Crear symlinks en Windows exige SeCreateSymbolicLinkPrivilege, que sin
// Developer Mode / admin no tenemos. 7za aborta con exit code 2 y
// electron-builder aborta TODO el build (por eso no salia el instalador .exe).
//
// ESTRATEGIA (3 pasos, sin tocar nada fuera del repo)
// --------------------------------------------------
// 1. SHIM DE 7-ZIP: app-builder busca literalmente `7za` en el %PATH%, no en
//    node_modules.Ponemos `scripts/eb-shim/7za.cmd` al inicio del PATH. El shim
//    llama al 7za.exe real y le inyecta `-xr!darwin`, de modo que la carpeta
//    de macOS nunca se materializa. Los errores reales de 7-Zip (exit 1) se
//    propagan; solo se tolera el exit 2 (warning).
//
// 2. CACHE LOCAL: apuntamos ELECTRON_BUILDER_CACHE a `.eb-cache/` dentro del
//    repo, así el .7z se descarga una sola vez.
//
// 3. RENAME DE GRACIA: app-builder extrae a una carpeta hash y después la
//    renombra a `winCodeSign-2.6.0`. Ese rename puede fallar con "Acceso
//    denegado" (handles de 7za / antivirus). Si pasa, lo hacemos nosotros.
//
// Lo que NO hace falta: ser admin, Developer Mode, ni re-empaquetar el .7z.

const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

const cacheRoot = path.join(repo, '.eb-cache');
const shimDir = path.join(repo, 'scripts', 'eb-shim');
const real7z = path.join(repo, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const appBuilder = path.join(repo, 'node_modules', 'app-builder-bin', 'win', 'x64', 'app-builder.exe');

function fail(msg) {
  console.error(`[package:win] ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(real7z)) fail('No se encontro 7za.exe. Ejecuta `npm install` primero.');
if (!fs.existsSync(path.join(shimDir, '7za.cmd'))) fail('Falta scripts/eb-shim/7za.cmd.');

fs.mkdirSync(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  ELECTRON_BUILDER_CACHE: cacheRoot,
  // El shim necesita saber donde esta el 7za.exe real.
  MN_REAL_7ZA: real7z,
  // Y necesita estar PRIMERO en el PATH para que app-builder lo encuentre.
  PATH: `${shimDir}${path.delimiter}${process.env.PATH || ''}`,
};

console.log('[package:win] Cache electron-builder:', cacheRoot);
console.log('[package:win] Shim 7-Zip:', path.join(shimDir, '7za.cmd'));

// --- Precarga de winCodeSign (best effort, ver notas arriba) --------------
if (fs.existsSync(appBuilder)) {
  console.log('[package:win] Precargando winCodeSign (excluye darwin/)...');
  try {
    execFileSync(appBuilder, ['download-artifact', '--name', 'winCodeSign'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    // electron-builder va a reintentarlo por su cuenta; solo avisamos.
    console.log('[package:win]   (precarga con avisos, electron-builder reintentara)');
  }
  fixWinCodeSignRename();
} else {
  console.log('[package:win] app-builder.exe no encontrado; sin precarga.');
}

// Si app-builder dejo la carpeta hash sin renombrar, la movemos a mano.
function fixWinCodeSignRename() {
  const wcs = path.join(cacheRoot, 'winCodeSign');
  if (!fs.existsSync(wcs)) return;
  const finalDir = path.join(wcs, 'winCodeSign-2.6.0');
  if (fs.existsSync(finalDir)) {
    // Validar que no tenga la carpeta macOS.
    if (!fs.existsSync(path.join(finalDir, 'darwin'))) {
      console.log('[package:win] winCodeSign listo en cache.');
    }
    return;
  }
  for (const entry of fs.readdirSync(wcs)) {
    const full = path.join(wcs, entry);
    if (!fs.statSync(full).isDirectory()) continue;
    if (entry === 'winCodeSign-2.6.0') continue;
    if (!fs.existsSync(path.join(full, 'windows-10'))) continue;
    try {
      fs.renameSync(full, finalDir);
      console.log(`[package:win] Cache renombrada: ${entry} -> winCodeSign-2.6.0`);
    } catch (e) {
      console.log(`[package:win] No se pudo renombrar ${entry}: ${e.message}`);
    }
  }
}

// --- Build -----------------------------------------------------------------
const targets = process.argv.slice(2);
const ebArgs = targets.length ? targets : ['--win'];
const ebBin = path.join(repo, 'node_modules', '.bin', isWin ? 'electron-builder.cmd' : 'electron-builder');

console.log(`[package:win] electron-builder ${ebArgs.join(' ')}`);
const proc = spawn(ebBin, ebArgs, {
  cwd: repo,
  stdio: 'inherit',
  shell: isWin,
  windowsHide: true,
  env,
});

proc.on('exit', (code) => {
  console.log(`[package:win] electron-builder terminó con código ${code}`);
  process.exit(code ?? 0);
});