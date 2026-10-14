import { describe, expect, it } from 'vitest';
import { authorStats, dailyStats, hotspotStats, repositoryStats, scopedCommits, weekdayStats } from '../shared/statistics';
import { defaultModules, type Commit, type RepoSnapshot } from '../shared/types';
const commit = (date: string, overrides: Partial<Commit> = {}): Commit => ({ hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'Alice', email: 'ALICE@example.test', date, subject: 'Test', parents: [], refs: '', additions: 5, deletions: 2, files: [{ path: 'a.ts', additions: 5, deletions: 2, binary: false }], ...overrides });
const repo = (id: string, commits: Commit[]): RepoSnapshot => ({ repository: { id, name: id, path: `/test/${id}` }, commits, branch: 'main', branches: [], workingFiles: [], ahead: 0, behind: 0, totalCommits: commits.length, truncated: false, updatedAt: '' });
describe('analytics', () => {
  it('filters calendar days, repositories, future commits and merges', () => {
    const now = new Date(2026, 9, 14, 12);
    const recent = commit(new Date(2026, 9, 14, 0).toISOString());
    const snapshots = [repo('a', [recent, commit(new Date(2026, 9, 7, 23).toISOString()), commit(new Date(2026, 9, 15).toISOString()), { ...recent, parents: ['a', 'b'] }]), repo('b', [recent])];
    const selected = scopedCommits(snapshots, { ...defaultModules()[0], repoIds: ['a'], period: 7 }, now);
    expect(selected).toHaveLength(1);
    expect(dailyStats(selected, 7, now).map(d => d.count)).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });
  it('groups authors by email and keeps identical paths in separate repositories', () => {
    const rows = scopedCommits([repo('a', [commit('2026-01-01')]), repo('b', [commit('2026-01-02', { email: 'alice@example.test' })])], { ...defaultModules()[0], period: 0 }, new Date('2026-10-14'));
    expect(authorStats(rows)).toEqual([{ name: 'Alice', email: 'ALICE@example.test', additions: 10, deletions: 4, commits: 2 }]);
    expect(repositoryStats(rows)).toHaveLength(2); expect(hotspotStats(rows)).toHaveLength(2);
    expect(weekdayStats(rows).reduce((sum, d) => sum + d.count, 0)).toBe(2);
  });
});
