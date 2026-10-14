import { spawn } from 'node:child_process';

export async function openTerminal(cwd: string) {
  const candidates: [string, string[]][] =
    process.platform === 'win32'
      ? [
          ['wt.exe', ['-d', cwd]],
          ['cmd.exe', ['/d', '/c', 'start', '""', 'powershell.exe', '-NoExit']],
        ]
      : process.platform === 'darwin'
        ? [['open', ['-a', 'Terminal', cwd]]]
        : [
            ['x-terminal-emulator', []],
            ['gnome-terminal', [`--working-directory=${cwd}`]],
            ['konsole', ['--workdir', cwd]],
            ['xfce4-terminal', [`--working-directory=${cwd}`]],
            ['xterm', []],
          ];
  for (const [command, args] of candidates) {
    const started = await new Promise<boolean>((resolve) => {
      const child = spawn(command, args, {
        cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    });
    if (started) return;
  }
  throw new Error(
    'Kein Terminal gefunden. Bitte ein Terminal installieren oder den Repository-Ordner manuell öffnen.',
  );
}
