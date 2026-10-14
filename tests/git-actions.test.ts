import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  creationCommand,
  executeCommand,
  gitContext,
  prepareAction,
  repositoryLockKey,
  validatePlan,
} from '../electron/git-actions';
import { inspectRepository } from '../electron/git';
import { parseGitCommand, type GitAction } from '../shared/git-actions';

describe('Git command input', () => {
  it('supports quoted paths and Windows backslashes without executing shell syntax', () => {
    expect(parseGitCommand('git add "C:\\Projects\\file name.txt"')).toEqual([
      'add',
      'C:\\Projects\\file name.txt',
    ]);
    expect(parseGitCommand('log -p -1')).toEqual(['log', '-p', '-1']);
    expect(() => parseGitCommand('status; echo secret')).toThrow('Shell');
    expect(() => parseGitCommand('add -p')).toThrow('Terminal');
    expect(() => parseGitCommand('rebase -i HEAD~2')).toThrow('Terminal');
    expect(() => parseGitCommand('-C /elsewhere status')).toThrow();
  });
});

describe('Git actions in isolated repositories', () => {
  let root: string;
  let cwd: string;
  const run = (directory: string, ...args: string[]) =>
    execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true });
  const action = async (input: GitAction, directory = cwd) => {
    const repository = await inspectRepository(directory);
    const plan = await prepareAction(repository, input);
    await validatePlan(repository, plan);
    let result;
    for (const args of plan.commands) {
      result = await executeCommand(
        directory,
        args,
        plan.input,
        () => {},
        new AbortController().signal,
      );
      if (!result.success) throw new Error(result.output);
    }
    return result!;
  };
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'git-dashboard-actions-'));
    cwd = path.join(root, 'workspace');
    await mkdir(cwd);
    run(cwd, 'init', '-b', 'main');
    run(cwd, 'config', 'core.autocrlf', 'false');
    await action({ type: 'identity', name: 'Git Tester', email: 'tester@example.test' });
  });
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });
  it('stages literal selected paths, unstages unborn files without deleting them, and commits', async () => {
    await writeFile(path.join(cwd, '[literal].txt'), 'first\n');
    await writeFile(path.join(cwd, 'l.txt'), 'second\n');
    await action({ type: 'stage', paths: ['[literal].txt'] });
    expect(run(cwd, 'diff', '--cached', '--name-only').trim()).toBe('[literal].txt');
    await action({ type: 'unstage', paths: ['[literal].txt'] });
    expect(await readFile(path.join(cwd, '[literal].txt'), 'utf8')).toBe('first\n');
    expect(run(cwd, 'ls-files').trim()).toBe('');
    await action({ type: 'stageAll' });
    await action({ type: 'commit', message: 'Initial commit\n\nDetailed message' });
    expect(run(cwd, 'log', '-1', '--format=%B')).toContain('Detailed message');
  });
  it('handles staged renames, stash, branch, tags and checkout preconditions', async () => {
    await rename(path.join(cwd, 'l.txt'), path.join(cwd, 'renamed ü.txt'));
    await action({ type: 'stageAll' });
    await action({ type: 'unstage', paths: ['renamed ü.txt'] });
    expect(run(cwd, 'diff', '--cached', '--name-only')).toBe('');
    await action({ type: 'stageAll' });
    await action({ type: 'commit', message: 'Rename' });
    await writeFile(path.join(cwd, '[literal].txt'), 'modified\n');
    await action({ type: 'stashSave', message: 'Saved', includeUntracked: true });
    let context = await gitContext(await inspectRepository(cwd));
    expect(context.stashes).toHaveLength(1);
    await action({ type: 'stashPop', ref: context.stashes[0].ref });
    expect(await readFile(path.join(cwd, '[literal].txt'), 'utf8')).toBe('modified\n');
    const discard = await prepareAction(await inspectRepository(cwd), {
      type: 'discard',
      paths: ['[literal].txt'],
    });
    expect(discard.public.requiresConfirmation).toBe(true);
    await action({ type: 'discard', paths: ['[literal].txt'] });
    await action({ type: 'branchCreate', name: 'feature' });
    await action({ type: 'branchRename', name: 'topic' });
    const stalePlan = await prepareAction(await inspectRepository(cwd), { type: 'stageAll' });
    await action({ type: 'switch', ref: 'refs/heads/main' });
    await expect(validatePlan(await inspectRepository(cwd), stalePlan)).rejects.toThrow('HEAD');
    await action({ type: 'branchDelete', ref: 'refs/heads/topic' });
    await action({ type: 'tagCreate', name: 'v-test', message: 'Annotated' });
    context = await gitContext(await inspectRepository(cwd));
    expect(context.tags).toContain('v-test');
    await action({ type: 'tagDelete', ref: 'v-test' });
    await expect(
      prepareAction(await inspectRepository(cwd), { type: 'stage', paths: ['../outside'] }),
    ).rejects.toThrow();
  });
  it('pushes, clones, fetches and pulls against a local bare remote', async () => {
    const bare = path.join(root, 'remote.git');
    await mkdir(bare);
    run(bare, 'init', '--bare', '-b', 'main');
    await action({ type: 'remoteAdd', name: 'origin', url: bare });
    await action({ type: 'push', remote: 'origin', branch: 'main' });
    const clone = path.join(root, 'clone');
    const command = await creationCommand({ type: 'clone', path: clone, url: bare });
    const result = await executeCommand(
      command.cwd,
      command.args,
      undefined,
      () => {},
      new AbortController().signal,
    );
    expect(result.success, result.output).toBe(true);
    run(clone, 'config', 'user.name', 'Other Tester');
    run(clone, 'config', 'user.email', 'other@example.test');
    await writeFile(path.join(clone, 'remote.txt'), 'remote\n');
    await action({ type: 'stageAll' }, clone);
    await action({ type: 'commit', message: 'Remote update' }, clone);
    await action({ type: 'push' }, clone);
    await action({ type: 'fetch' });
    await action({ type: 'pull', mode: 'ff-only' });
    expect(await readFile(path.join(cwd, 'remote.txt'), 'utf8')).toBe('remote\n');
    const repo = await inspectRepository(cwd);
    const worktree = path.join(root, 'linked');
    run(cwd, 'worktree', 'add', '-b', 'linked', worktree);
    expect(await repositoryLockKey(await inspectRepository(worktree))).toBe(
      await repositoryLockKey(repo),
    );
    const force = await prepareAction(repo, {
      type: 'push',
      remote: 'origin',
      branch: 'main',
      force: true,
    });
    expect(force.public.requiresConfirmation).toBe(true);
    await writeFile(path.join(clone, 'remote.txt'), 'newer\n');
    run(clone, 'add', '.');
    run(clone, 'commit', '-m', 'Concurrent remote update');
    run(clone, 'push');
    const rejected = await executeCommand(
      cwd,
      force.commands[0],
      undefined,
      () => {},
      new AbortController().signal,
    );
    expect(rejected.success).toBe(false);
    expect(rejected.output).toMatch(/stale info|rejected/);
  });
  it('detects merge conflicts and aborts back to the previous state', async () => {
    await action({ type: 'branchCreate', name: 'conflicting' });
    await writeFile(path.join(cwd, '[literal].txt'), 'other branch\n');
    await action({ type: 'stageAll' });
    await action({ type: 'commit', message: 'Other side' });
    await action({ type: 'switch', ref: 'refs/heads/main' });
    await writeFile(path.join(cwd, '[literal].txt'), 'main branch\n');
    await action({ type: 'stageAll' });
    await action({ type: 'commit', message: 'Main side' });
    const plan = await prepareAction(await inspectRepository(cwd), {
      type: 'merge',
      ref: 'conflicting',
    });
    const result = await executeCommand(
      cwd,
      plan.commands[0],
      undefined,
      () => {},
      new AbortController().signal,
    );
    expect(result.success).toBe(false);
    expect((await gitContext(await inspectRepository(cwd))).operation).toBe('merge');
    await action({ type: 'abort' });
    expect((await gitContext(await inspectRepository(cwd))).operation).toBeUndefined();
    expect(await readFile(path.join(cwd, '[literal].txt'), 'utf8')).toBe('main branch\n');
  });
  it('initializes an empty target and refuses existing repositories', async () => {
    const destination = path.join(root, 'new-repo');
    const command = await creationCommand({ type: 'init', path: destination, branch: 'main' });
    const result = await executeCommand(
      command.cwd,
      command.args,
      undefined,
      () => {},
      new AbortController().signal,
    );
    expect(result.success, result.output).toBe(true);
    expect((await gitContext(await inspectRepository(destination))).branch).toBe('main');
    await expect(creationCommand({ type: 'init', path: cwd, branch: 'main' })).rejects.toThrow(
      'bereits',
    );
  });
});
