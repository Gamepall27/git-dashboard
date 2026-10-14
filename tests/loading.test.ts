import { describe, expect, it, vi } from 'vitest';
import { RepositoryLoader } from '../electron/repository-loader';
import type { RepositorySummary } from '../electron/git';
import type { Commit, Repository, RepositoryLoadEvent, RepoSnapshot } from '../shared/types';
import { applyRepositoryLoad } from '../shared/loading';

const repo = (id: string): Repository => ({ id, name: id, path: `/test/${id}` });
const commit = (hash: string): Commit => ({
  hash,
  shortHash: hash,
  author: 'Test',
  email: 'test@example.test',
  date: new Date().toISOString(),
  subject: hash,
  parents: [],
  refs: '',
  files: [],
  additions: 0,
  deletions: 0,
});
const summary = (repository: Repository, version = 'a'.repeat(64)): RepositorySummary => ({
  revisions: ['tip'],
  snapshot: {
    repository,
    historyVersion: version,
    statisticsComplete: false,
    recentCommits: [],
    branch: 'main',
    branches: [],
    commits: [],
    workingFiles: [],
    ahead: 0,
    behind: 0,
    totalCommits: 3,
    truncated: false,
    updatedAt: '',
  },
});
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('incremental repository loading', () => {
  it('streams an available summary before slow repositories finish and alternates pages', async () => {
    const a = repo('a'),
      b = repo('b');
    const slow = gate();
    const first = gate();
    const events: RepositoryLoadEvent[] = [];
    const readSummary = vi.fn(async (repository: Repository) => {
      if (repository.id === 'b') await slow.promise;
      return summary(repository);
    });
    const readPage = vi.fn(async (_repo: Repository, _revisions: string[], offset: number) => ({
      commits: offset ? [commit('third')] : [commit('first'), commit('second')],
      hasMore: offset === 0,
    }));
    const loader = new RepositoryLoader(readSummary, readPage);
    const loading = loader.load(
      [a, b],
      'one',
      { known: {} },
      (event) => {
        events.push(event);
        if (event.type === 'summary' && event.snapshot.repository.id === 'a') first.resolve();
      },
      new AbortController().signal,
    );
    await first.promise;
    expect(events.filter((e) => e.type === 'summary')).toHaveLength(1);
    expect(readPage).not.toHaveBeenCalled();
    slow.resolve();
    await loading;
    expect(readPage.mock.calls.map(([r, , offset]) => `${r.id}:${offset}`)).toEqual([
      'a:0',
      'b:0',
      'a:2',
      'b:2',
    ]);
    expect(events.at(-1)?.type).toBe('complete');
  });
  it('reuses complete data, resumes partial pages, and resets changed revisions', async () => {
    const repository = repo('a');
    let version = 'a'.repeat(64);
    const readSummary = vi.fn(async (r: Repository) => summary(r, version));
    const readPage = vi.fn(async (_r: Repository, _refs: string[], offset: number) => ({
      commits: [commit(String(offset))],
      hasMore: false,
    }));
    const loader = new RepositoryLoader(readSummary, readPage);
    const events: RepositoryLoadEvent[] = [];
    await loader.load(
      [repository],
      'one',
      { known: { a: { version, count: 3, complete: true } } },
      (e) => events.push(e),
      new AbortController().signal,
    );
    expect(readPage).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === 'summary')).toMatchObject({
      preserveStatistics: true,
      snapshot: { statisticsComplete: true },
    });
    await loader.load(
      [repository],
      'two',
      { known: { a: { version, count: 2, complete: false } } },
      () => {},
      new AbortController().signal,
    );
    expect(readPage.mock.calls[0][2]).toBe(2);
    version = 'b'.repeat(64);
    await loader.load(
      [repository],
      'three',
      { known: { a: { version: 'a'.repeat(64), count: 3, complete: true } } },
      (e) => events.push(e),
      new AbortController().signal,
    );
    expect(readPage.mock.calls[1][2]).toBe(0);
    expect(events.filter((e) => e.type === 'summary').at(-1)).toMatchObject({
      preserveStatistics: false,
    });
  });
  it('bounds summary concurrency, isolates failures and prioritizes the active repository', async () => {
    let active = 0,
      max = 0;
    const seen: string[] = [];
    const readSummary = async (r: Repository) => {
      max = Math.max(max, ++active);
      await Promise.resolve();
      active--;
      return summary(r);
    };
    const loader = new RepositoryLoader(readSummary, async (r) => {
      seen.push(r.id);
      if (r.id === 'a') {
        loader.prioritize('c');
        throw new Error('Unavailable history');
      }
      return { commits: [commit(r.id)], hasMore: false };
    });
    const events: RepositoryLoadEvent[] = [];
    await loader.load(
      ['a', 'b', 'c'].map(repo),
      'one',
      { known: {} },
      (e) => events.push(e),
      new AbortController().signal,
    );
    expect(max).toBeLessThanOrEqual(2);
    expect(seen).toEqual(['a', 'c', 'b']);
    expect(events.find((e) => e.type === 'commits' && e.repositoryId === 'a')).toMatchObject({
      complete: true,
      error: 'Unavailable history',
    });
    expect(events.at(-1)?.type).toBe('complete');
  });
  it('stops canceled work without emitting obsolete pages', async () => {
    const started = gate();
    const controller = new AbortController();
    const events: RepositoryLoadEvent[] = [];
    const loader = new RepositoryLoader(
      async (r) => summary(r),
      async (_r, _refs, _offset, signal) => {
        started.resolve();
        await new Promise((_, reject) =>
          signal!.addEventListener('abort', () => reject(new Error('Canceled')), { once: true }),
        );
        return { commits: [commit('obsolete')], hasMore: false };
      },
    );
    const loading = loader.load(
      [repo('a')],
      'one',
      { known: {} },
      (e) => events.push(e),
      controller.signal,
    );
    const rejection = expect(loading).rejects.toThrow();
    await started.promise;
    controller.abort();
    await rejection;
    expect(events.some((e) => e.type === 'commits' || e.type === 'complete')).toBe(false);
  });
});

it('keeps cached arrays and ignores repositories removed during loading', () => {
  const current: RepoSnapshot = {
    ...summary(repo('a')).snapshot,
    commits: [commit('first')],
    statisticsComplete: true,
  };
  const event: RepositoryLoadEvent = {
    type: 'summary',
    requestId: 'one',
    snapshot: { ...summary(repo('a')).snapshot, statisticsComplete: true },
    preserveStatistics: true,
  };
  const next = applyRepositoryLoad([current], event, new Set(['a']));
  expect(next[0].commits).toBe(current.commits);
  expect(applyRepositoryLoad([], event, new Set())).toEqual([]);
  const changed = { ...event, snapshot: summary(repo('a'), 'b'.repeat(64)).snapshot };
  expect(applyRepositoryLoad([current], changed, new Set(['a']))[0].commits).toEqual([]);
});
