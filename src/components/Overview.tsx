import { useMemo } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  Plus,
} from 'lucide-react';
import { authorStats, scopedCommits } from '../../shared/statistics';
import {
  defaultModules,
  type Commit,
  type ModuleConfig,
  type Repository,
  type RepoSnapshot,
} from '../../shared/types';
import { fullDate, number, relativeDate } from '../lib';
import { EmptyState, LoadingRows } from './UI';
import { Modules } from './Modules';
import { useStatisticsSnapshots } from '../useStatistics';

export function Overview({
  snapshots,
  repositories,
  loading,
  onAdd,
  onOpen,
  onCommit,
  configs,
  onModulesChange,
}: {
  snapshots: RepoSnapshot[];
  repositories: Repository[];
  loading: boolean;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onCommit: (id: string, commit: Commit) => void;
  configs: ModuleConfig[];
  onModulesChange: (configs: ModuleConfig[]) => Promise<boolean>;
}) {
  const statisticInputs = useStatisticsSnapshots(snapshots);
  const minute = Math.floor(Date.now() / 60_000);
  const stats = useMemo(
    () => scopedCommits(statisticInputs, defaultModules()[0]),
    [statisticInputs, minute],
  );
  const authors = useMemo(() => authorStats(stats), [stats]);
  const hasStatistics = snapshots.some(
    (snapshot) => snapshot.statisticsComplete || snapshot.commits.length > 0,
  );
  const recent = useMemo(
    () =>
      snapshots
        .filter((s) => !s.error)
        .flatMap((s) =>
          (s.recentCommits ?? s.commits.slice(0, 12)).map((preview) => ({
            commit: s.commits.find((commit) => commit.hash === preview.hash) ?? preview,
            repo: s.repository,
          })),
        )
        .sort((a, b) => new Date(b.commit.date).getTime() - new Date(a.commit.date).getTime())
        .slice(0, 8),
    [snapshots],
  );
  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE</div>
          <h1>Übersicht</h1>
          <p>Alle Repositories. Ein gemeinsamer Blick.</p>
        </div>
        <button className="button primary" onClick={onAdd}>
          <Plus size={16} />
          Repository öffnen
        </button>
      </header>
      {!repositories.length ? (
        <div className="getting-started">
          <EmptyState
            icon={<FolderGit2 size={36} />}
            title="Dein Workspace beginnt mit einem Repository"
            action={
              <button className="button primary" onClick={onAdd}>
                <Plus size={16} />
                Lokales Repository öffnen
              </button>
            }
          >
            Öffne einen oder mehrere Git-Ordner. Deine letzten Commits,
            <br />
            lokalen Änderungen und Statistiken erscheinen hier.
          </EmptyState>
          <div className="getting-started-note">
            <GitBranch size={16} />
            <span>
              Git Dashboard liest lokale Daten. Deine Repositories bleiben auf deinem Computer.
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="summary-strip">
            <div>
              <span>Geöffnete Repositories</span>
              <strong>
                {repositories.length}
                <small>
                  {snapshots.filter((s) => s.workingFiles.length).length} mit Änderungen
                </small>
              </strong>
            </div>
            <div>
              <span>Commits · letzte 30 Tage</span>
              <strong>
                {hasStatistics ? number(stats.length) : '—'}
                <small>ohne Merge-Commits</small>
              </strong>
            </div>
            <div>
              <span>Aktive Personen</span>
              <strong>
                {hasStatistics ? authors.length : '—'}
                <small>nach E-Mail-Adresse</small>
              </strong>
            </div>
            <div>
              <span>Geänderte Zeilen · 30 Tage</span>
              <strong className="summary-lines">
                <span className="positive">
                  {hasStatistics ? `+${number(authors.reduce((s, a) => s + a.additions, 0))}` : '—'}
                </span>
                <span className="negative">
                  {hasStatistics ? `−${number(authors.reduce((s, a) => s + a.deletions, 0))}` : '—'}
                </span>
              </strong>
            </div>
          </div>
          {repositories.some(
            (repo) => !snapshots.find((s) => s.repository.id === repo.id)?.statisticsComplete,
          ) && (
            <div className="statistics-loading-note">
              Statistiken sind ein Zwischenstand, solange Historien nachgeladen werden.
            </div>
          )}
          <section className="repos-section">
            <div className="section-heading">
              <h2>
                Deine Repositories <span className="count">{repositories.length}</span>
              </h2>
              <span className="muted">Neueste Aktivität über alle Branches</span>
            </div>
            {
              <div className="repo-table-wrap">
                <table className="repo-table">
                  <thead>
                    <tr>
                      <th>Repository</th>
                      <th>Branch / lokal</th>
                      <th>Letzter Commit</th>
                      <th>Aktivität</th>
                      <th aria-label="Öffnen" />
                    </tr>
                  </thead>
                  <tbody>
                    {repositories.map((repo) => {
                      const s = snapshots.find((r) => r.repository.id === repo.id);
                      const latest = s?.recentCommits?.[0] ?? s?.commits[0];
                      return (
                        <tr key={repo.id}>
                          <td>
                            <button className="table-repo-link" onClick={() => onOpen(repo.id)}>
                              <FolderGit2 size={19} />
                              <span>
                                {repo.name}
                                <small title={repo.path}>{repo.path}</small>
                              </span>
                            </button>
                          </td>
                          <td>
                            <div className="branch-label">
                              <GitBranch size={13} />
                              {s?.branch || '—'}
                            </div>
                            <small className={s?.workingFiles.length ? 'warning' : 'muted'}>
                              {s?.error
                                ? 'Nicht verfügbar'
                                : s
                                  ? s.workingFiles.length
                                    ? `${s.workingFiles.length} lokale Änderungen`
                                    : 'Arbeitsverzeichnis sauber'
                                  : 'Wird geladen …'}
                            </small>
                            {!!s && (s.ahead > 0 || s.behind > 0) && (
                              <small className="divergence">
                                <ArrowUp size={10} />
                                {s.ahead}
                                <ArrowDown size={10} />
                                {s.behind}
                              </small>
                            )}
                          </td>
                          <td>
                            {s?.error ? (
                              <span className="negative repo-error" title={s.error}>
                                {s.error}
                              </span>
                            ) : latest ? (
                              <button
                                className="latest-commit-link"
                                onClick={() => onCommit(repo.id, latest)}
                              >
                                <span>{latest.subject}</span>
                                <small>
                                  <span className="mono">{latest.shortHash}</span> · {latest.author}
                                </small>
                              </button>
                            ) : (
                              <span className="muted">
                                {s ? 'Noch keine Commits' : 'Wartet auf Daten …'}
                              </span>
                            )}
                          </td>
                          <td className="muted" title={latest ? fullDate(latest.date) : undefined}>
                            {latest ? relativeDate(latest.date) : '—'}
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              title={`${repo.name} öffnen`}
                              aria-label={`${repo.name} öffnen`}
                              onClick={() => onOpen(repo.id)}
                            >
                              <ArrowUpRight size={17} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            }
          </section>
          <Modules
            configs={configs}
            snapshots={snapshots}
            repositories={repositories}
            onChange={onModulesChange}
          />
          <section className="recent-section">
            <div className="section-heading">
              <h2>Letzte Commits</h2>
              <span className="muted">Über den gesamten Workspace</span>
            </div>
            {recent.length ? (
              <div className="recent-list">
                {recent.map(({ commit, repo }) => (
                  <button
                    className="recent-row"
                    key={`${repo.id}-${commit.hash}`}
                    onClick={() => onCommit(repo.id, commit)}
                  >
                    <GitCommitHorizontal size={17} />
                    <span className="recent-main">
                      <span>{commit.subject}</span>
                      <small>
                        {repo.name}
                        <span>·</span>
                        {commit.author}
                      </small>
                    </span>
                    {commit.statsLoaded === false ? (
                      <span className="muted mono">Zeilen werden geladen …</span>
                    ) : (
                      <span className="line-count">
                        <span className="positive">+{number(commit.additions)}</span>
                        <span className="negative">−{number(commit.deletions)}</span>
                      </span>
                    )}
                    <span className="mono muted">{commit.shortHash}</span>
                    <span className="muted recent-date" title={fullDate(commit.date)}>
                      {relativeDate(commit.date)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title={loading ? 'Commits werden geladen …' : 'Noch keine Commits'}>
                Die ersten Commits deiner Repositories erscheinen hier.
              </EmptyState>
            )}
          </section>
        </>
      )}
    </>
  );
}
