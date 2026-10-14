import type { RepoSnapshot, RepositoryLoadEvent } from './types';

export function applyRepositoryLoad(
  snapshots: RepoSnapshot[],
  event: RepositoryLoadEvent,
  registeredIds: Set<string>,
): RepoSnapshot[] {
  if (event.type === 'summary') {
    const id = event.snapshot.repository.id;
    if (!registeredIds.has(id)) return snapshots;
    const previous = snapshots.find((snapshot) => snapshot.repository.id === id);
    const preserve =
      event.preserveStatistics && previous?.historyVersion === event.snapshot.historyVersion;
    const next = { ...event.snapshot, commits: preserve ? previous!.commits : [] };
    return previous
      ? snapshots.map((snapshot) => (snapshot.repository.id === id ? next : snapshot))
      : [...snapshots, next];
  }
  if (event.type === 'commits' && registeredIds.has(event.repositoryId)) {
    return snapshots.map((snapshot) =>
      snapshot.repository.id === event.repositoryId
        ? {
            ...snapshot,
            commits: [...snapshot.commits, ...event.commits],
            statisticsComplete: event.complete,
            statisticsError: event.error,
            truncated: event.truncated,
          }
        : snapshot,
    );
  }
  return snapshots;
}
