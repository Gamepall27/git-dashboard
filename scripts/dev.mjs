import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
const compile = spawn(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.electron.json'],
  { stdio: 'inherit' },
);
await new Promise((resolve) => compile.on('exit', resolve)).then((code) => {
  if (code) process.exit(code);
});
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' });
children.push(vite);
vite.on('exit', (code) => stop(code ?? 1));
let ready = false;
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    const response = await fetch('http://127.0.0.1:5173');
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 300));
}
if (!ready) {
  console.error('Vite konnte nicht gestartet werden.');
  stop(1);
} else {
  const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = spawn(require('electron'), ['.'], { stdio: 'inherit', env });
  children.push(electron);
  electron.on('exit', (code) => stop(code ?? 0));
}
