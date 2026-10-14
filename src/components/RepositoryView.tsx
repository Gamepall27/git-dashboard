import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, GitBranch, GitCommitHorizontal, Search } from 'lucide-react';
import {
  defaultModules,
  type Commit,
  type HistoryPage,
  type ModuleConfig,
  type Repository,
  type RepoSnapshot,
} from '../../shared/types';
import { api, fullDate, number, relativeDate, unwrap } from '../lib';
import { Modules } from './Modules';
import { EmptyState, ErrorMessage, LoadingRows } from './UI';
import { GitWorkspace, type GitControls } from './GitWorkspace';

export function RepositoryView({
  repository,
  snapshot,
  snapshots,
  repositories,
  branch,
  onBranch,
  onCommit,
  configs,
  onModulesChange,
  onError,
  revision,
  gitControls,
}: {
  repository: Repository;
  snapshot?: RepoSnapshot;
  snapshots: RepoSnapshot[];
  repositories: Repository[];
  branch: string;
  onBranch: (branch: string) => void;
  onCommit: (commit: Commit) => void;
  configs?: ModuleConfig[];
  onModulesChange: (configs: ModuleConfig[]) => Promise<boolean>;
  onError: (message: string) => void;
  revision: string;
  gitControls: GitControls;
}) {
  const [history, setHistory] = useState<HistoryPage>({ commits: [], hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [author, setAuthor] = useState('');
  const [showWorking, setShowWorking] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const defaults = useMemo(() => defaultModules(repository.id), [repository.id]);
  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setHistory({ commits: [], hasMore: false });
    api()
      .history(repository.id, branch, 0)
      .then(unwrap)
      .then((data) => {
        if (generation.current === request) setHistory(data);
      })
      .catch((e) => {
        if (generation.current === request) setError(e.message);
      })
      .finally(() => {
        if (generation.current === request) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [repository.id, branch, revision, retry]);
  const more = async () => {
    const request = generation.current;
    setLoading(true);
    setError('');
    try {
      const data = unwrap(await api().history(repository.id, branch, history.commits.length));
      if (generation.current === request)
        setHistory((h) => ({ commits: [...h.commits, ...data.commits], hasMore: data.hasMore }));
    } catch (e) {
      if (generation.current === request) setError((e as Error).message);
    } finally {
      if (generation.current === request) setLoading(false);
    }
  };
  const visible = history.commits.filter(
    (c) =>
      (!query ||
        `${c.subject} ${c.author} ${c.email} ${c.hash}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!author || c.email === author),
  );
  const authors = new Map(history.commits.map((c) => [c.email, c.author]));
  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">REPOSITORY</div>
          <h1>
            <FolderIcon />
            {repository.name}
          </h1>
          <p className="repo-path" title={repository.path}>
            {repository.path}
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            api()
              .revealRepository(repository.id)
              .then(unwrap)
              .catch((e) => onError(e.message));
          }}
        >
          <ExternalLink size={15} />
          Im Dateimanager
        </button>
      </header>
      {snapshot?.error && <ErrorMessage message={snapshot.error} />}
      <div className="repo-context-strip">
        <span className="branch-label">
          <GitBranch size={14} />
          {snapshot?.branch || '—'}
        </span>
        <span>
          {snapshot
            ? `${number(snapshot.totalCommits)} Commits über alle Branches`
            : 'Übersicht wird geladen …'}
        </span>
        <button
          className={`working-toggle ${showWorking ? 'active' : ''}`}
          onClick={() => setShowWorking((s) => !s)}
          aria-expanded={showWorking}
          disabled={!snapshot}
        >
          {!snapshot ? (
            'Status wird geladen …'
          ) : snapshot.workingFiles.length ? (
            <>
              <span className="status-dot" />
              {snapshot.workingFiles.length} lokale Änderungen
            </>
          ) : (
            <>
              <Check size={14} />
              Arbeitsverzeichnis sauber
            </>
          )}
        </button>
      </div>
      <GitWorkspace
        repository={repository}
        revision={`${revision}:${snapshot?.updatedAt ?? ''}`}
        showWorking={showWorking}
        controls={gitControls}
      />
      <section className="history-section">
        <div className="section-heading">
          <h2>Commit-Historie</h2>
          <span className="muted">{history.commits.length} geladen</span>
        </div>
        <div className="history-toolbar">
          <label className="branch-selector">
            <GitBranch size={14} />
            <select
              aria-label="Branch auswählen"
              value={branch}
              onChange={(e) => onBranch(e.target.value)}
            >
              <option value="HEAD">Aktueller Branch (HEAD)</option>
              {snapshot?.branches.map((b) => (
                <option key={b.ref} value={b.ref}>
                  {b.name}
                  {b.remote ? ' · remote' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="search-field history-search">
            <Search size={15} />
            <input
              aria-label="Commits durchsuchen"
              placeholder="Nachricht, Autor oder Hash …"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            className="author-filter"
            aria-label="Autor filtern"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          >
            <option value="">Alle Autoren</option>
            {[...authors].map(([email, name]) => (
              <option value={email} key={email}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {error && <ErrorMessage message={error} retry={() => setRetry((r) => r + 1)} />}
        {loading && !history.commits.length ? (
          <LoadingRows />
        ) : visible.length ? (
          <div className="history-list">
            {visible.map((commit) => (
              <button className="history-row" key={commit.hash} onClick={() => onCommit(commit)}>
                <div className={`commit-graph ${commit.parents.length > 1 ? 'merge' : ''}`}>
                  <span />
                </div>
                <div className="history-main">
                  <span>{commit.subject}</span>
                  <small>
                    {commit.author}
                    {commit.refs && (
                      <span className="commit-refs" title={commit.refs}>
                        {commit.refs.replace(/HEAD -> /g, '')}
                      </span>
                    )}
                  </small>
                </div>
                <span className="line-count">
                  <span className="positive">+{number(commit.additions)}</span>
                  <span className="negative">−{number(commit.deletions)}</span>
                </span>
                <span className="mono muted">{commit.shortHash}</span>
                <span className="muted history-date" title={fullDate(commit.date)}>
                  {relativeDate(commit.date)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          !error && (
            <EmptyState
              icon={<GitCommitHorizontal size={25} />}
              title={query || author ? 'Keine passenden Commits' : 'Noch keine Commits'}
            >
              {query || author
                ? 'Filter ändern oder weitere Commits laden. Die Suche gilt für die geladene Historie.'
                : 'Die Historie erscheint nach dem ersten Commit.'}
            </EmptyState>
          )
        )}
        {history.hasMore && (
          <div className="history-more">
            <button className="button secondary" disabled={loading} onClick={() => void more()}>
              {loading ? 'Laden …' : 'Weitere 100 Commits laden'}
            </button>
            <span className="muted">Suchfilter gelten für geladene Commits.</span>
          </div>
        )}
      </section>
      <Modules
        configs={configs ?? defaults}
        snapshots={snapshots}
        repositories={repositories}
        onChange={onModulesChange}
        repoId={repository.id}
      />
    </>
  );
}
function FolderIcon() {
  return <GitBranch size={25} className="heading-icon" />;
}
