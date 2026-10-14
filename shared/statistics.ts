import type { Commit, ModuleConfig, RepoSnapshot } from './types';

export interface ScopedCommit { commit: Commit; repoId: string; repoName: string }
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function scopedCommits(snapshots: RepoSnapshot[], module: ModuleConfig, now = new Date()): ScopedCommit[] {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (module.period) start.setDate(start.getDate() - module.period + 1);
  return snapshots.filter(s => !s.error && (!module.repoIds.length || module.repoIds.includes(s.repository.id)))
    .flatMap(s => s.commits.filter(c => c.parents.length < 2 && (!module.period || new Date(c.date) >= start) && new Date(c.date) <= now)
      .map(commit => ({ commit, repoId: s.repository.id, repoName: s.repository.name })));
}
export function authorStats(commits: ScopedCommit[]) {
  const authors = new Map<string, { name: string; email: string; commits: number; additions: number; deletions: number }>();
  for (const { commit } of commits) {
    const key = commit.email.toLowerCase() || commit.author;
    const row = authors.get(key) ?? { name: commit.author, email: commit.email, commits: 0, additions: 0, deletions: 0 };
    row.commits++; row.additions += commit.additions; row.deletions += commit.deletions; authors.set(key, row);
  }
  return [...authors.values()].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));
}
export function repositoryStats(commits: ScopedCommit[]) {
  const repos = new Map<string, { id: string; name: string; commits: number; additions: number; deletions: number }>();
  for (const { commit, repoId, repoName } of commits) {
    const row = repos.get(repoId) ?? { id: repoId, name: repoName, commits: 0, additions: 0, deletions: 0 };
    row.commits++; row.additions += commit.additions; row.deletions += commit.deletions; repos.set(repoId, row);
  }
  return [...repos.values()].sort((a, b) => b.commits - a.commits);
}
export function hotspotStats(commits: ScopedCommit[]) {
  const files = new Map<string, { path: string; repoName: string; commits: number; additions: number; deletions: number; binary: boolean }>();
  for (const { commit, repoId, repoName } of commits) for (const file of commit.files) {
    const key = `${repoId}\0${file.path}`;
    const row = files.get(key) ?? { path: file.path, repoName, commits: 0, additions: 0, deletions: 0, binary: false };
    row.commits++; row.additions += file.additions; row.deletions += file.deletions; row.binary ||= file.binary; files.set(key, row);
  }
  return [...files.values()].sort((a, b) => b.commits - a.commits || (b.additions + b.deletions) - (a.additions + a.deletions));
}
export function dailyStats(commits: ScopedCommit[], days: number, now = new Date()) {
  const counts = new Map<string, number>();
  for (const { commit } of commits) { const key = dayKey(new Date(commit.date)); counts.set(key, (counts.get(key) ?? 0) + 1); }
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(now); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - days + i + 1);
    const key = dayKey(date); return { key, date, count: counts.get(key) ?? 0 };
  });
}
export function weekdayStats(commits: ScopedCommit[]) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const { commit } of commits) counts[(new Date(commit.date).getDay() + 6) % 7]++;
  return ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((name, i) => ({ name, count: counts[i] }));
}
