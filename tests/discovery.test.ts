import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanRepositories } from '../electron/discovery';
import { inspectRepository } from '../electron/git';

it('finds only direct repository roots, including empty repos and worktrees, without opening them', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'git-dashboard-discovery-'));
  const run = (directory: string, ...args: string[]) =>
    execFileSync('git', ['-C', directory, ...args], { windowsHide: true, stdio: 'pipe' });
  const init = async (directory: string) => {
    await mkdir(directory, { recursive: true });
    run(directory, 'init', '-b', 'main');
  };
  try {
    // A repository at the parent must not make ordinary children look like repos.
    run(parent, 'init', '-b', 'main');
    run(
      parent,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'Initial',
    );
    const existing = path.join(parent, 'already-open');
    const empty = path.join(parent, 'empty-repo');
    const ordinary = path.join(parent, 'ordinary');
    const broken = path.join(parent, 'broken');
    await init(existing);
    await init(empty);
    await mkdir(ordinary);
    await mkdir(broken);
    await init(path.join(ordinary, 'too-deep'));
    await writeFile(path.join(broken, '.git'), 'invalid gitfile\n');
    run(parent, 'worktree', 'add', '-b', 'linked', path.join(parent, 'linked-worktree'));
    const opened = [await inspectRepository(existing)];
    const scan = await scanRepositories(parent, opened);
    expect(scan.repositories.map((repo) => repo.name)).toEqual([
      'already-open',
      'empty-repo',
      'linked-worktree',
    ]);
    expect(scan.repositories.map((repo) => repo.alreadyOpen)).toEqual([true, false, false]);
    expect(scan.warnings).toHaveLength(1);
    expect(scan.warnings[0].path).toBe(broken);
    expect(opened).toHaveLength(1);
    await expect(scanRepositories(path.join(parent, 'missing'), opened)).rejects.toThrow();
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
