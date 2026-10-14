import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { inspectRepository, repositorySummary, statisticsPage } from '../electron/git';
import { createHistory } from './support/history';

it('reads pinned 250-commit pages even when HEAD changes between pages', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'git-dashboard-pages-'));
  try {
    await createHistory(directory, 315);
    const repository = await inspectRepository(directory);
    const summary = await repositorySummary(repository);
    expect(summary.snapshot.error).toBeUndefined();
    expect(summary.snapshot.totalCommits).toBe(315);
    expect(summary.snapshot.recentCommits).toHaveLength(12);
    expect(summary.snapshot.commits).toHaveLength(0);
    const first = await statisticsPage(repository, summary.revisions, 0);
    execFileSync(
      'git',
      [
        '-C',
        directory,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '--allow-empty',
        '-m',
        'New HEAD',
      ],
      { windowsHide: true, stdio: 'pipe' },
    );
    const second = await statisticsPage(repository, summary.revisions, first.commits.length);
    expect(first.commits).toHaveLength(250);
    expect(first.hasMore).toBe(true);
    expect(second.commits).toHaveLength(65);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.commits, ...second.commits].map((c) => c.hash)).size).toBe(315);
    expect([...first.commits, ...second.commits].some((c) => c.subject === 'New HEAD')).toBe(false);
    const newer = await repositorySummary(repository, summary.snapshot);
    expect(newer.snapshot.historyVersion).not.toBe(summary.snapshot.historyVersion);
    expect(newer.snapshot.totalCommits).toBe(316);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
