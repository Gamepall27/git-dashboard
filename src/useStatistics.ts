import { useMemo, useRef } from 'react';
import type { ModuleConfig, RepoSnapshot } from '../shared/types';
import {
  authorStats,
  dailyStats,
  hotspotStats,
  repositoryStats,
  sameStatisticsInputs,
  scopedCommits,
  weekdayStats,
} from '../shared/statistics';

export function useStatisticsSnapshots(snapshots: RepoSnapshot[]) {
  const previous = useRef(snapshots);
  if (!sameStatisticsInputs(previous.current, snapshots)) previous.current = snapshots;
  return previous.current;
}
export function useStatistics(snapshots: RepoSnapshot[], config: ModuleConfig) {
  const inputs = useStatisticsSnapshots(snapshots);
  // Re-evaluate time filters on the next render after a minute boundary as well.
  const minute = Math.floor(Date.now() / 60_000);
  const commits = useMemo(
    () => (config.type === 'workingTree' ? [] : scopedCommits(inputs, config)),
    [inputs, config, minute],
  );
  const authors = useMemo(
    () => (config.type === 'authors' ? authorStats(commits) : []),
    [commits, config.type],
  );
  const repos = useMemo(
    () => (config.type === 'repositories' ? repositoryStats(commits) : []),
    [commits, config.type],
  );
  const files = useMemo(
    () => (config.type === 'hotspots' ? hotspotStats(commits) : []),
    [commits, config.type],
  );
  const rows = useMemo(
    () => (config.type === 'weekdays' ? weekdayStats(commits) : []),
    [commits, config.type],
  );
  const calendar = useMemo(
    () => (config.type === 'heatmap' ? dailyStats(commits, 91) : []),
    [commits, config.type, minute],
  );
  const earliest = useMemo(
    () =>
      config.type === 'timeline'
        ? commits.reduce(
            (earliest, c) => Math.min(earliest, new Date(c.commit.date).getTime()),
            Date.now(),
          )
        : Date.now(),
    [commits, config.type],
  );
  const allDays = Math.ceil((Date.now() - earliest) / 86_400_000) + 1;
  const days = Math.max(1, Math.min(config.period || allDays, 366));
  const daily = useMemo(
    () => (config.type === 'timeline' ? dailyStats(commits, days) : []),
    [commits, config.type, days, minute],
  );
  return { commits, authors, repos, files, rows, calendar, allDays, days, daily };
}
