import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
export async function createHistory(directory: string, count: number) {
  await mkdir(directory, { recursive: true });
  execFileSync('git', ['-C', directory, 'init', '-b', 'main'], {
    windowsHide: true,
    stdio: 'pipe',
  });
  const timestamp = Math.floor(Date.now() / 1000) - 3600;
  const stream = Array.from({ length: count }, (_, i) => {
    const message = `Commit ${i}\n`;
    const content = `line ${i}\n`;
    return `commit refs/heads/main\ncommitter Test <test@example.test> ${timestamp + i} +0000\ndata ${Buffer.byteLength(message)}\n${message}\nM 100644 inline data.txt\ndata ${Buffer.byteLength(content)}\n${content}\n\n`;
  }).join('');
  execFileSync('git', ['-C', directory, 'fast-import', '--quiet'], {
    input: stream,
    windowsHide: true,
    stdio: 'pipe',
  });
}
