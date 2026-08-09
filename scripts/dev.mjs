/**
 * Dev orchestrator.
 *
 * Levanta en paralelo:
 *  - Backend Python (FastAPI) en :8765
 *  - Vite dev server en :5173
 *  - Electron (con main + preload compilados)
 *
 * Cuando el frontend hace un HMR, Vite recarga. El backend Python
 * no se reinicia (sus cambios hay que reiniciarlos manualmente).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const isWin = process.platform === 'win32';
const VENV_PY = join(ROOT, 'python_backend', '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

function run(name, cmd, args, opts = {}) {
  // En Windows, los .cmd/.bat requieren shell:true (sino EINVAL)
  // porque no son ejecutables nativos: los procesa cmd.exe.
  const useShell = isWin && /\.(cmd|bat)$/i.test(cmd);
  const finalCmd = useShell ? `"${cmd}"` : cmd;
  const p = spawn(finalCmd, args, {
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShell,
    windowsHide: true,
  });
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}-err] ${d}`));
  p.on('exit', (code) => console.log(`[${name}] exited (${code})`));
  return p;
}

function waitForUrl(url, timeoutMs = 30000) {
  const t0 = Date.now();
  return new Promise((resolveP, rejectP) => {
    function check() {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolveP();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1500, () => req.destroy());
    }
    function retry() {
      if (Date.now() - t0 > timeoutMs) return rejectP(new Error(`timeout: ${url}`));
      setTimeout(check, 500);
    }
    check();
  });
}

async function main() {
  // 1. Backend Python
  const pyCmd = existsSync(VENV_PY) ? VENV_PY : (isWin ? 'python' : 'python3');
  const pyArgs = [join(ROOT, 'python_backend', 'main.py')];
  console.log(`[dev] Iniciando backend Python: ${pyCmd} ${pyArgs.join(' ')}`);
  const pyProc = run('python', pyCmd, pyArgs, { env: { MEETNINJA_PORT: '8765' } });

  try {
    // 60s en vez de 20s: el /health puede tardar si tiene que esperar a
    // que arranque el LLM local (llama-server) la primera vez.
    await waitForUrl('http://127.0.0.1:8765/health', 60000);
    console.log('[dev] Backend Python OK');
  } catch (e) {
    console.error('[dev] Backend Python no arranco:', e.message);
    pyProc.kill();
    process.exit(1);
  }

  // 2. Vite (binario local, no npx del PATH para evitar ENOENT)
  console.log('[dev] Iniciando Vite...');
  const viteBin = join(ROOT, 'node_modules', '.bin', isWin ? 'vite.cmd' : 'vite');
  const viteProc = run('vite', viteBin, []);

  // esperar a vite
  try {
    await waitForUrl('http://127.0.0.1:5173', 30000);
    console.log('[dev] Vite OK');
  } catch (e) {
    console.error('[dev] Vite no arranco:', e.message);
    viteProc.kill();
    pyProc.kill();
    process.exit(1);
  }

  // 3. Electron (con tsc del main process)
  console.log('[dev] Compilando main process...');
  const tscBin = join(ROOT, 'node_modules', '.bin', isWin ? 'tsc.cmd' : 'tsc');
  const tscProc = run('tsc-main', tscBin, ['-p', 'electron/tsconfig.json']);
  await new Promise((r) => {
    tscProc.on('exit', r);
  });
  tscProc.kill?.();

  console.log('[dev] Iniciando Electron...');
  const electronBin = join(ROOT, 'node_modules', '.bin', isWin ? 'electron.cmd' : 'electron');
  const electronProc = run('electron', electronBin, ['.'], {
    env: { MEETNINJA_PORT: '8765' },
  });

  // cleanup
  function shutdown() {
    console.log('[dev] Cerrando...');
    try { electronProc.kill(); } catch {}
    try { viteProc.kill(); } catch {}
    try { pyProc.kill(); } catch {}
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
