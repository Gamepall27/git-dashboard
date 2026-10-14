import { setImmediate } from 'node:timers/promises';
import type {
  Repository,
  RepositoryLoadEvent,
  RepositoryLoadOptions,
  RepoSnapshot,
} from '../shared/types';
import { MAX_STATS_COMMITS, repositorySummary, statisticsPage } from './git';

export class RepositoryLoader {
  private metadata = new Map<string, RepoSnapshot>();
  private priorityId?: string;
  constructor(
    private readSummary = repositorySummary,
    private readPage = statisticsPage,
  ) {}
  prioritize(id: string) {
    this.priorityId = id;
  }
  forget(id: string) {
    this.metadata.delete(id);
  }
  async load(
    repositories: Repository[],
    requestId: string,
    options: RepositoryLoadOptions,
    emit: (event: RepositoryLoadEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    this.priorityId = options.priorityId;
    // Retain only small metadata, never duplicate full histories in the main process.
    const pending = [...repositories];
    const jobs: {
      repository: Repository;
      revisions: string[];
      offset: number;
      truncated: boolean;
    }[] = [];
    let summarized = 0;
    let finished = 0;
    const take = <T extends { id: string }>(queue: T[]) => {
      const index = queue.findIndex((item) => item.id === this.priorityId);
      return queue.splice(index < 0 ? 0 : index, 1)[0];
    };
    const send = (event: RepositoryLoadEvent) => {
      if (!signal.aborted) emit(event);
    };
    send({
      type: 'progress',
      requestId,
      phase: 'summaries',
      completed: 0,
      total: repositories.length,
    });
    await Promise.all(
      Array.from({ length: Math.min(2, pending.length) }, async () => {
        while (pending.length && !signal.aborted) {
          const repository = take(pending);
          const data = await this.readSummary(repository, this.metadata.get(repository.id), signal);
          signal.throwIfAborted();
          this.metadata.set(repository.id, data.snapshot);
          const known = options.known[repository.id];
          const preserveStatistics =
            !!known && !data.snapshot.error && known.version === data.snapshot.historyVersion;
          const complete =
            data.snapshot.statisticsComplete || (preserveStatistics && known.complete);
          const offset = preserveStatistics ? known.count : 0;
          send({
            type: 'summary',
            requestId,
            snapshot: { ...data.snapshot, statisticsComplete: !!complete },
            preserveStatistics,
          });
          if (complete) finished++;
          else
            jobs.push({
              repository,
              revisions: data.revisions,
              offset,
              truncated: data.snapshot.truncated,
            });
          send({
            type: 'progress',
            requestId,
            phase: 'summaries',
            completed: ++summarized,
            total: repositories.length,
          });
        }
      }),
    );
    signal.throwIfAborted();
    send({
      type: 'progress',
      requestId,
      phase: 'statistics',
      completed: finished,
      total: repositories.length,
    });
    // Round-robin pages: one large repository cannot monopolize the loader.
    while (jobs.length && !signal.aborted) {
      const priorityIndex = jobs.findIndex((job) => job.repository.id === this.priorityId);
      const job = jobs.splice(priorityIndex < 0 ? 0 : priorityIndex, 1)[0];
      this.priorityId = undefined;
      let complete = false;
      try {
        const page = await this.readPage(job.repository, job.revisions, job.offset, signal);
        signal.throwIfAborted();
        job.offset += page.commits.length;
        complete = !page.hasMore || job.offset >= MAX_STATS_COMMITS;
        send({
          type: 'commits',
          requestId,
          repositoryId: job.repository.id,
          commits: page.commits,
          complete,
          truncated: job.truncated,
        });
      } catch (error) {
        signal.throwIfAborted();
        complete = true;
        send({
          type: 'commits',
          requestId,
          repositoryId: job.repository.id,
          commits: [],
          complete: true,
          truncated: job.truncated,
          error: (error as Error).message,
        });
      }
      if (complete) finished++;
      else jobs.push(job);
      send({
        type: 'progress',
        requestId,
        phase: 'statistics',
        completed: finished,
        total: repositories.length,
        currentId: job.repository.id,
      });
      await setImmediate();
    }
    signal.throwIfAborted();
    send({ type: 'complete', requestId });
  }
}
