import { useEffect, useState } from 'react';
import { Check, Copy, FileCode2, GitCommitHorizontal } from 'lucide-react';
import type { Commit, CommitDetail as Detail, Repository } from '../../shared/types';
import { api, fullDate, number, unwrap } from '../lib';
import { ErrorMessage, IconButton, LoadingRows, Modal } from './UI';

export function CommitDetail({
  repository,
  commit,
  onClose,
}: {
  repository: Repository;
  commit: Commit;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError('');
    setDetail(null);
    api()
      .commitDetail(repository.id, commit.hash)
      .then(unwrap)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [repository.id, commit.hash, retry]);
  return (
    <Modal title="Commit-Details" onClose={onClose} wide>
      <div className="commit-detail-summary">
        <div className="commit-detail-repo">
          <GitCommitHorizontal size={16} />
          <span>{repository.name}</span>
          <span className="mono">{commit.shortHash}</span>
          <IconButton
            label="Commit-Hash kopieren"
            onClick={() => {
              api()
                .copyText(commit.hash)
                .then(unwrap)
                .then(() => setCopied(true))
                .catch((e) => setError(e.message));
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
        </div>
        <h3>{commit.subject}</h3>
        <div className="commit-meta">
          <span>
            {commit.author} &lt;{commit.email}&gt;
          </span>
          <span>{fullDate(commit.date)}</span>
        </div>
        {detail && detail.message !== commit.subject && (
          <pre className="commit-message">{detail.message}</pre>
        )}
      </div>
      {error ? (
        <div className="modal-body">
          <ErrorMessage message={error} retry={() => setRetry((n) => n + 1)} />
        </div>
      ) : !detail ? (
        <LoadingRows />
      ) : (
        <div className="diff-layout">
          <aside className="diff-files">
            <div className="diff-files-heading">
              {detail.commit.files.length} Dateien
              <span className="positive">+{number(detail.commit.additions)}</span>
              <span className="negative">−{number(detail.commit.deletions)}</span>
            </div>
            {detail.commit.files.map((file) => (
              <div className="diff-file" key={file.path} title={file.path}>
                <FileCode2 size={14} />
                <span>{file.path}</span>
                <small>{file.binary ? 'Binär' : `+${file.additions} / −${file.deletions}`}</small>
              </div>
            ))}
            {!detail.commit.files.length && (
              <p className="muted">
                Keine Dateistatistik. Bei Merge-Commits zeigt Git nur kombinierte Änderungen.
              </p>
            )}
          </aside>
          <div className="diff-content">
            {detail.truncated && (
              <div className="notice">
                Diff auf 500 KB begrenzt. Vollständige Änderung mit Git öffnen.
              </div>
            )}
            <pre className="diff-code">
              {detail.patch
                ? detail.patch.split('\n').map((line, i) => (
                    <span
                      key={i}
                      className={
                        line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')
                          ? 'diff-heading'
                          : line.startsWith('+')
                            ? 'diff-add'
                            : line.startsWith('-')
                              ? 'diff-delete'
                              : line.startsWith('@@')
                                ? 'diff-hunk'
                                : ''
                      }
                    >
                      {line || ' '}
                      <br />
                    </span>
                  ))
                : 'Für diesen Commit ist kein Text-Diff verfügbar.'}
            </pre>
          </div>
        </div>
      )}
    </Modal>
  );
}
