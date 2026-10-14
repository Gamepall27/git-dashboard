import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { applyRepositoryLoad } from '../shared/loading';
import type {
  Repository,
  RepositoryLoadEvent,
  RepositoryLoadOptions,
  RepoSnapshot,
} from '../shared/types';
import { api, unwrap } from './lib';

export function useRepositoryLoading(
  repositories: Repository[],
  onError: (message: string) => void,
) {
  const [snapshots, setSnapshots] = useState<RepoSnapshot[]>([]);
  const [progress, setProgress] = useState<Extract<
    RepositoryLoadEvent,
    { type: 'progress' }
  > | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const repositoriesRef = useRef(repositories);
  repositoriesRef.current = repositories;
  const snapshotsRef = useRef<RepoSnapshot[]>([]);
  const loadingIds = useRef(new Set<string>());
  const requestRef = useRef('');
  const busy = useRef(false);
  const priority = useRef<string | undefined>(undefined);
  const lastRefresh = useRef(0);
  const syncRepositories = useCallback((next: Repository[]) => {
    repositoriesRef.current = next;
    const ids = new Set(next.map((repo) => repo.id));
    snapshotsRef.current = snapshotsRef.current.filter((snapshot) =>
      ids.has(snapshot.repository.id),
    );
    setSnapshots(snapshotsRef.current);
    loadingIds.current = new Set([...loadingIds.current].filter((id) => ids.has(id)));
  }, []);
  const refresh = useCallback(
    async (ids?: string[]) => {
      if (!window.gitDashboard || (busy.current && !ids)) return;
      const registeredIds = new Set(repositoriesRef.current.map((repo) => repo.id));
      const wanted = ids
        ? [...new Set([...ids, ...loadingIds.current])].filter((id) => registeredIds.has(id))
        : [...registeredIds];
      const requestId = crypto.randomUUID();
      requestRef.current = requestId;
      loadingIds.current = new Set(wanted);
      busy.current = true;
      setRefreshing(true);
      setProgress({
        type: 'progress',
        requestId,
        phase: 'summaries',
        completed: 0,
        total: wanted.length,
      });
      const known: RepositoryLoadOptions['known'] = {};
      for (const snapshot of snapshotsRef.current)
        if (snapshot.historyVersion && !snapshot.error)
          known[snapshot.repository.id] = {
            version: snapshot.historyVersion,
            count: snapshot.commits.length,
            complete: snapshot.statisticsComplete === true && !snapshot.statisticsError,
          };
      try {
        unwrap(
          await api().startRepositoryLoad(requestId, {
            ids: wanted,
            known,
            priorityId: priority.current,
          }),
        );
      } catch (error) {
        if (requestRef.current === requestId) {
          busy.current = false;
          loadingIds.current.clear();
          setRefreshing(false);
          setProgress(null);
          onError((error as Error).message);
        }
      }
    },
    [onError],
  );
  useEffect(() => {
    if (!window.gitDashboard) return;
    const unsubscribe = api().onRepositoryLoad((event) => {
      if (event.requestId !== requestRef.current) return;
      if (event.type === 'summary' || event.type === 'commits') {
        const registeredIds = new Set(repositoriesRef.current.map((repo) => repo.id));
        const next = applyRepositoryLoad(snapshotsRef.current, event, registeredIds);
        snapshotsRef.current = next;
        if (event.type === 'summary') setSnapshots(next);
        else startTransition(() => setSnapshots(next));
        const id = event.type === 'summary' ? event.snapshot.repository.id : event.repositoryId;
        if (event.type === 'summary' ? event.snapshot.statisticsComplete : event.complete)
          loadingIds.current.delete(id);
      } else if (event.type === 'progress') setProgress(event);
      else {
        busy.current = false;
        loadingIds.current.clear();
        setRefreshing(false);
        setProgress(null);
        if (event.type === 'error') onError(event.error);
        else {
          const now = new Date();
          setUpdatedAt(now.toISOString());
          lastRefresh.current = now.getTime();
        }
      }
    });
    return () => {
      unsubscribe();
      if (busy.current)
        void api()
          .cancelRepositoryLoad(requestRef.current)
          .catch(() => {});
      busy.current = false;
      requestRef.current = '';
    };
  }, [onError]);
  const prioritize = useCallback(
    (id: string) => {
      priority.current = id;
      if (busy.current)
        void api()
          .prioritizeRepositoryLoad(id)
          .then(unwrap)
          .catch((error) => onError(error.message));
    },
    [onError],
  );
  return {
    snapshots,
    progress,
    refreshing,
    updatedAt,
    lastRefresh,
    busy,
    refresh,
    syncRepositories,
    prioritize,
  };
}
