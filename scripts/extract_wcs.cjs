// Extrae el winCodeSign-2.6.0.7z excluyendo la carpeta `darwin` (que
// contiene symlinks que no podemos crear sin privilegios de admin).
// El resto del winCodeSign (linux, windows-10, windows-6, rcedit, etc)
// es lo que electron-builder necesita para empaquetar el instalador NSIS.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const real7z = path.join(repo, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe.bak');
const cacheRoot = process.env.ELECTRON_BUILDER_CACHE
  || path.join(repo, '.electron-builder-cache');
const wcsDir = path.join(cacheRoot, 'winCodeSign');
const tempExtract = path.join(wcsDir, '__extracted__');

if (!fs.existsSync(wcsDir)) {
  console.log('No hay cache de winCodeSign. Salteando.');
  process.exit(0);
}

// Encontrar el .7z mas reciente (descargado por electron-builder)
const zips = fs.readdirSync(wcsDir).filter(f => f.endsWith('.7z') && f !== 'winCodeSign-2.6.0.7z');
if (zips.length === 0) {
  console.log('No hay .7z de winCodeSign para extraer. Salteando.');
  process.exit(0);
}
const zipPath = path.join(wcsDir, zips[0]);

// Limpiar extraccion previa
if (fs.existsSync(tempExtract)) {
  fs.rmSync(tempExtract, { recursive: true, force: true });
}
fs.mkdirSync(tempExtract, { recursive: true });

console.log(`Extrayendo ${zips[0]} (excluyendo darwin/)...`);
try {
  execFileSync(real7z, [
    'x', '-y', '-bd',
    zipPath,
    `-o${tempExtract}`,
    '-xr!darwin',
  ], { stdio: 'pipe' });
} catch (e) {
  console.error('Error extrayendo:', e.message);
  process.exit(1);
}

if (!fs.existsSync(path.join(tempExtract, 'windows-10'))) {
  console.error('Estructura inesperada. Algo salio mal.');
  process.exit(1);
}

// Copiar a cada carpeta hash que electron-builder creo (si tiene contenido)
// y crear marker file para que sepa que ya esta extraido.
let populated = 0;
for (const entry of fs.readdirSync(wcsDir)) {
  const full = path.join(wcsDir, entry);
  if (entry === '__extracted__' || !fs.statSync(full).isDirectory()) continue;
  if (fs.existsSync(path.join(full, 'windows-10'))) continue;
  console.log(`  Poblando cache: ${entry}`);
  copyDirSync(tempExtract, full);
  fs.writeFileSync(path.join(full, '.cache-extracted'), new Date().toISOString());
  populated++;
}

console.log(`Listo. ${populated} carpetas de cache pobladas.`);

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
