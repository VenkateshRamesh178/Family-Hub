// Runs a Python module inside services/api/.venv, so npm scripts work the same on Windows and macOS/Linux.
//   node scripts/py.mjs --setup          create the venv and install the API with dev dependencies
//   node scripts/py.mjs <module> [args]  e.g. `uvicorn app.main:app --reload`
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'services', 'api');
const venvPython =
  process.platform === 'win32' ? join(apiDir, '.venv', 'Scripts', 'python.exe') : join(apiDir, '.venv', 'bin', 'python');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: apiDir, stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const args = process.argv.slice(2);

if (args[0] === '--setup') {
  if (!existsSync(venvPython)) run(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', '.venv']);
  run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  run(venvPython, ['-m', 'pip', 'install', '-e', '.[dev]']);
} else {
  if (!existsSync(venvPython)) {
    console.error('The API virtualenv is missing. Run `npm run api:setup` first.');
    process.exit(1);
  }
  run(venvPython, ['-m', ...args]);
}
