import { useEffect, useRef, useState } from 'react';
import { FolderGit2, FolderSearch, RefreshCw } from 'lucide-react';
import type { RepositoryScan, Workspace } from '../../shared/types';
import { api, unwrap } from '../lib';
import { EmptyState, ErrorMessage, LoadingRows, Modal } from './UI';

export function DiscoverRepositories({
  repositoryId,
  openedCount,
  onClose,
  onAdded,
}: {
  repositoryId: string;
  openedCount: number;
  onClose: () => void;
  onAdded: (workspace: Workspace) => void;
}) {
  const [scan, setScan] = useState<RepositoryScan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setScan(null);
    setSelected(new Set());
    api()
      .scanParentRepositories(repositoryId)
      .then(unwrap)
      .then((data) => {
        if (!cancelled) setScan(data);
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repositoryId, retry]);
  const available = scan?.repositories.filter((repo) => !repo.alreadyOpen) ?? [];
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate = selected.size > 0 && selected.size < available.length;
  }, [selected.size, available.length]);
  const remaining = Math.max(0, 200 - openedCount);
  const add = async () => {
    if (!selected.size || adding || selected.size > remaining) return;
    setAdding(true);
    setError('');
    try {
      const paths = available.filter((repo) => selected.has(repo.id)).map((repo) => repo.path);
      onAdded(unwrap(await api().addRepositories(paths)));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setAdding(false);
    }
  };
  return (
    <Modal
      title="Gefundene Repositories"
      onClose={() => {
        if (!adding) onClose();
      }}
    >
      <div className="modal-body discovery-body">
        {loading ? (
          <>
            <div className="discovery-loading" role="status">
              <RefreshCw size={16} className="spin" />
              Direkte Unterordner werden geprüft …
            </div>
            <LoadingRows />
          </>
        ) : (
          <>
            {scan && (
              <>
                <p className="muted">Git-Repositories in den direkten Unterordnern von:</p>
                <p className="discovery-parent mono" title={scan.parentPath}>
                  {scan.parentPath}
                </p>
                {scan.repositories.length ? (
                  <>
                    <div className="discovery-summary">
                      <span>
                        {scan.repositories.length} gefunden · {available.length} neu
                      </span>
                      <span>{selected.size} ausgewählt</span>
                    </div>
                    <label className="discovery-select-all">
                      <input
                        ref={selectAll}
                        type="checkbox"
                        aria-label="Alle auswählen"
                        disabled={adding || !available.length}
                        checked={!!available.length && selected.size === available.length}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? new Set(available.map((repo) => repo.id))
                              : new Set(),
                          )
                        }
                      />
                      Alle auswählen
                    </label>
                    <div
                      className="discovery-list"
                      role="group"
                      aria-label="Gefundene Repositories"
                    >
                      {scan.repositories.map((repo) => (
                        <label
                          className={`discovery-row ${repo.alreadyOpen ? 'already-open' : ''}`}
                          key={repo.id}
                        >
                          <input
                            type="checkbox"
                            aria-label={repo.name}
                            checked={repo.alreadyOpen || selected.has(repo.id)}
                            disabled={adding || repo.alreadyOpen}
                            onChange={(event) => {
                              const next = new Set(selected);
                              event.target.checked ? next.add(repo.id) : next.delete(repo.id);
                              setSelected(next);
                            }}
                          />
                          <FolderGit2 size={18} />
                          <span className="discovery-repo-info">
                            <strong>{repo.name}</strong>
                            <small title={repo.path}>{repo.path}</small>
                          </span>
                          {repo.alreadyOpen && (
                            <span className="discovery-open-label">Bereits geöffnet</span>
                          )}
                        </label>
                      ))}
                    </div>
                    {!available.length && (
                      <p className="form-help">
                        Alle gefundenen Repositories sind bereits im Workspace geöffnet.
                      </p>
                    )}
                  </>
                ) : (
                  <EmptyState icon={<FolderSearch size={26} />} title="Keine Repositories gefunden">
                    In den direkten Unterordnern wurden keine Git-Repositories erkannt.
                  </EmptyState>
                )}
                {!!scan.warnings.length && (
                  <details className="discovery-warnings">
                    <summary>{scan.warnings.length} Ordner konnten nicht geprüft werden</summary>
                    {scan.warnings.map((warning) => (
                      <p key={warning.path}>
                        <span className="mono">{warning.path}</span>
                        <br />
                        {warning.error}
                      </p>
                    ))}
                  </details>
                )}
              </>
            )}
            {selected.size > remaining && (
              <ErrorMessage
                message={`Im Workspace ist noch Platz für ${remaining} Repositories. Bitte die Auswahl verkleinern.`}
              />
            )}
          </>
        )}
        {error && (
          <ErrorMessage
            message={error}
            retry={!scan && !loading ? () => setRetry((value) => value + 1) : undefined}
          />
        )}
      </div>
      <footer className="modal-footer">
        <button className="button secondary" disabled={adding} onClick={onClose}>
          Abbrechen
        </button>
        <button
          className="button primary"
          disabled={loading || adding || !selected.size || selected.size > remaining}
          onClick={() => void add()}
        >
          {adding ? 'Hinzufügen …' : 'Ausgewählte hinzufügen'}
        </button>
      </footer>
    </Modal>
  );
}
