import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commitDetail, history, inspectRepository, parseLog, parseNumstat, parseStatus, snapshot } from '../electron/git';
import { authorStats, scopedCommits } from '../shared/statistics';
import { defaultModules } from '../shared/types';

describe('Git data parsing', () => {
  it('preserves unusual paths, handles renames, and excludes binary lines', () => {
    expect(parseNumstat('2\t1\tspace and ü.txt\0-\t-\timage.png\0' + '1\t0\t\0old\0new\tfile\nname\0')).toEqual([
      { path: 'space and ü.txt', additions: 2, deletions: 1, binary: false },
      { path: 'image.png', additions: 0, deletions: 0, binary: true },
      { path: 'new\tfile\nname', additions: 1, deletions: 0, binary: false },
    ]);
  });
  it('parses staged renames and untracked files', () => {
    expect(parseStatus('R  new.txt\0old.txt\0?? untracked.txt\0')).toEqual([
      { index: 'R', working: ' ', path: 'new.txt', originalPath: 'old.txt' },
      { index: '?', working: '?', path: 'untracked.txt' },
    ]);
    expect(parseLog('')).toEqual([]);
  });
});

describe('real repositories', () => {
  let directory: string;
  const run = (...args: string[]) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true });
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'git-dashboard-tests-'));
    run('init', '-b', 'main'); run('config', 'user.name', 'Alice'); run('config', 'user.email', 'alice@example.test'); run('config', 'core.autocrlf', 'false');
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
  it('supports an unborn repository', async () => {
    const repository = await inspectRepository(directory);
    const data = await snapshot(repository);
    expect(data.error).toBeUndefined(); expect(data.totalCommits).toBe(0); expect(data.branch).toBe('main');
    expect(await history(repository, 'HEAD', 0)).toEqual({ commits: [], hasMore: false });
  });
  it('reads commits, renames, binary files, branches, dirty status and patches', async () => {
    await writeFile(path.join(directory, 'hello ü.txt'), 'one\ntwo\n'); run('add', '.'); run('commit', '-m', 'Initial');
    run('config', 'user.name', 'Bob'); run('config', 'user.email', 'bob@example.test');
    await writeFile(path.join(directory, 'hello ü.txt'), 'one\nthree\nfour\n'); run('add', '.'); run('commit', '-m', 'Update');
    await rename(path.join(directory, 'hello ü.txt'), path.join(directory, 'renamed ü.txt')); run('add', '.'); run('commit', '-m', 'Rename');
    await writeFile(path.join(directory, 'binary.dat'), Buffer.from([0, 1, 2, 0, 3])); run('add', '.'); run('commit', '-m', 'Binary');
    run('checkout', '-b', 'feature'); await writeFile(path.join(directory, 'feature.txt'), 'feature\n'); run('add', '.'); run('commit', '-m', 'Feature');
    run('checkout', 'main'); run('merge', '--no-ff', 'feature', '-m', 'Merge feature');
    await writeFile(path.join(directory, 'local.txt'), 'untracked\n');
    const repository = await inspectRepository(directory); const data = await snapshot(repository);
    expect(data.error).toBeUndefined(); expect(data.totalCommits).toBe(6); expect(data.commits).toHaveLength(6);
    expect(data.branches.map(b => b.name)).toContain('feature'); expect(data.workingFiles[0].path).toBe('local.txt');
    const update = data.commits.find(c => c.subject === 'Update')!;
    expect(update.additions).toBe(2); expect(update.deletions).toBe(1);
    expect(data.commits.find(c => c.subject === 'Binary')!.files[0].binary).toBe(true);
    expect(data.commits.find(c => c.subject === 'Rename')!.files[0].path).toBe('renamed ü.txt');
    const stats = authorStats(scopedCommits([data], { ...defaultModules()[0], period: 0 }));
    expect(stats.reduce((sum, row) => sum + row.commits, 0)).toBe(5);
    expect(stats.find(a => a.name === 'Alice')!.additions).toBe(2);
    const detail = await commitDetail(repository, update.hash); expect(detail.patch).toContain('+three'); expect(detail.message).toBe('Update');
    expect((await history(repository, 'HEAD', 0)).commits).toHaveLength(6);
    await expect(history(repository, '--all', 0)).rejects.toThrow();
    await expect(commitDetail(repository, '--help')).rejects.toThrow();
  });
});
