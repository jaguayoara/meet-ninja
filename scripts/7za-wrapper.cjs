// Wrapper de 7-Zip que ignora symlinks (workaround para el bug de
// electron-builder con symlinks en Windows sin privilegios de admin).
//
// electron-builder llama a 7za.exe con el flag -snld que DEBERIA evitar
// la creacion de symlinks pero en algunas versiones de 7z falla. Este
// wrapper intercepta y agrega -snl (extract symlinks as plain files,
// no error) que SI funciona en todos los Windows.
const { spawn } = require('node:child_process');
const path = require('node:path');

// 7za.exe real viene con electron-builder via 7zip-bin. Lo renombramos a
// .bak para que este wrapper sea el que se invoque.
const real7z = path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe.bak');

const args = process.argv.slice(2);
// Inyectar -snl para que cualquier symlink en el archivo .7z se extraiga
// como archivo regular, sin error de permisos.
if (!args.includes('-snl') && !args.includes('-snld')) {
  args.unshift('-snl');
}

const p = spawn(real7z, args, { stdio: 'inherit', windowsHide: true });
p.on('exit', (code) => process.exit(code ?? 0));
p.on('error', (e) => { console.error('7z wrapper error:', e.message); process.exit(1); });
