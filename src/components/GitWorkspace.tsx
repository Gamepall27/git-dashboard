import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  FileCode2,
  GitBranch,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import {
  isConflict,
  isStaged,
  isUnstaged,
  type GitAction,
  type GitActionContext,
} from '../../shared/git-actions';
import type { Repository, WorkingFile } from '../../shared/types';
import type { GitJob } from '../useGitOperations';
import { api, unwrap } from '../lib';
import { GitActionDialog } from './GitActionDialog';
import { GitOutput } from './GitDialogs';
import { ErrorMessage } from './UI';

export interface GitControls {
  job?: GitJob;
  run: (action: GitAction) => Promise<boolean>;
  cancel: () => void;
}
export function GitWorkspace({
  repository,
  revision,
  showWorking,
  controls,
}: {
  repository: Repository;
  revision: string;
  showWorking: boolean;
  controls: GitControls;
}) {
  const [context, setContext] = useState<GitActionContext>();
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'push' | 'pull' | 'switch' | null>(null);
  const [output, setOutput] = useState(false);
  const [retry, setRetry] = useState(0);
  const busy = !!controls.job && controls.job.phase !== 'done';
  useEffect(() => {
    let cancelled = false;
    api()
      .gitContext(repository.id)
      .then(unwrap)
      .then((data) => {
        if (!cancelled) {
          setContext(data);
          setError('');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [repository.id, revision, controls.job?.phase, retry, showWorking]);
  useEffect(() => {
    if (
      controls.job?.phase === 'running' ||
      (controls.job?.error && controls.job.error !== 'Nicht ausgeführt.')
    )
      setOutput(true);
  }, [controls.job?.phase, controls.job?.error]);
  return (
    <>
      <div className="git-action-toolbar" aria-label="Git-Aktionen">
        <button
          className="button secondary compact"
          disabled={busy || !context}
          onClick={() => void controls.run({ type: 'fetch' })}
        >
          <RefreshCw size={14} />
          Fetch
        </button>
        <button
          className="button secondary compact"
          disabled={busy || !context}
          onClick={() => setDialog('pull')}
        >
          <ArrowDownToLine size={14} />
          Pull
        </button>
        <button
          className="button primary compact"
          disabled={busy || !context}
          onClick={() => setDialog('push')}
        >
          <ArrowUpFromLine size={14} />
          Push
        </button>
        <span className="git-toolbar-separator" />
        <button
          className="button secondary compact"
          disabled={busy || !context}
          onClick={() => setDialog('switch')}
        >
          <GitBranch size={14} />
          Weitere Git-Aktionen
        </button>
        <button
          className="button secondary compact"
          onClick={() =>
            api()
              .openTerminal(repository.id)
              .then(unwrap)
              .catch((e) => setError(e.message))
          }
        >
          <Terminal size={14} />
          Terminal öffnen
        </button>
        {controls.job && (
          <button
            className={`git-job-link ${controls.job.result?.success ? 'positive' : controls.job.phase === 'done' ? 'negative' : ''}`}
            onClick={() => setOutput(true)}
          >
            {busy && <RefreshCw size={13} className="spin" />}
            {busy
              ? controls.job.label + ' …'
              : controls.job.result?.success
                ? 'Git-Ausgabe · Erfolgreich'
                : 'Git-Ausgabe prüfen'}
          </button>
        )}
      </div>
      {error && <ErrorMessage message={error} retry={() => setRetry((n) => n + 1)} />}
      {context?.operation && (
        <div className="git-operation-banner">
          <strong>{context.operation} läuft</strong>
          <span>Konflikte bearbeiten, Dateien stagen und fortsetzen.</span>
          <button
            className="button secondary compact"
            disabled={busy || context.files.some(isConflict)}
            onClick={() => void controls.run({ type: 'continue' })}
          >
            Fortsetzen
          </button>
          <button
            className="button danger-button compact"
            disabled={busy}
            onClick={() => void controls.run({ type: 'abort' })}
          >
            Operation abbrechen
          </button>
        </div>
      )}
      {(showWorking || context?.operation) && context && (
        <WorkingTree context={context} controls={controls} />
      )}
      {dialog && context && (
        <GitActionDialog
          initial={dialog}
          context={context}
          onRun={controls.run}
          onClose={() => setDialog(null)}
        />
      )}
      {output && controls.job && (
        <GitOutput job={controls.job} onClose={() => setOutput(false)} onCancel={controls.cancel} />
      )}
    </>
  );
}

function WorkingTree({ context, controls }: { context: GitActionContext; controls: GitControls }) {
  const [stagedSelection, setStagedSelection] = useState<string[]>([]);
  const [unstagedSelection, setUnstagedSelection] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const busy = !!controls.job && controls.job.phase !== 'done';
  const staged = context.files.filter(isStaged);
  const unstaged = context.files.filter(isUnstaged);
  useEffect(() => {
    setStagedSelection((previous) =>
      previous.filter((p) => context.files.some((f) => f.path === p && isStaged(f))),
    );
    setUnstagedSelection((previous) =>
      previous.filter((p) => context.files.some((f) => f.path === p && isUnstaged(f))),
    );
  }, [context.files]);
  const group = (
    files: WorkingFile[],
    selection: string[],
    setSelection: (paths: string[]) => void,
    indexed: boolean,
  ) => (
    <div className="git-file-group">
      <header>
        <label className="git-checkbox">
          <input
            type="checkbox"
            aria-label={
              indexed
                ? 'Alle gestagten Dateien auswählen'
                : 'Alle nicht gestagten Dateien auswählen'
            }
            disabled={busy || !files.length}
            checked={!!files.length && files.every((f) => selection.includes(f.path))}
            onChange={(e) => setSelection(e.target.checked ? files.map((f) => f.path) : [])}
          />
          {indexed ? 'Gestagt' : 'Nicht gestagt'}
          <span className="count-badge">{files.length}</span>
        </label>
        <button
          className="text-button"
          disabled={busy || !files.length}
          onClick={() => void controls.run({ type: indexed ? 'unstageAll' : 'stageAll' })}
        >
          {indexed ? 'Alles unstagen' : 'Alles stagen'}
        </button>
      </header>
      <div className="git-file-list">
        {files.length ? (
          files.map((file) => (
            <label
              className="working-file git-file-row"
              key={file.path}
              title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}
            >
              <input
                type="checkbox"
                aria-label={`${indexed ? 'Gestagt' : 'Nicht gestagt'}: ${file.path}`}
                checked={selection.includes(file.path)}
                disabled={busy}
                onChange={(e) =>
                  setSelection(
                    e.target.checked
                      ? [...selection, file.path]
                      : selection.filter((p) => p !== file.path),
                  )
                }
              />
              <span
                className={`file-status ${isConflict(file) ? 'conflict' : file.index === '?' ? 'untracked' : ''}`}
              >
                {indexed ? file.index : isConflict(file) ? 'U' : file.working}
              </span>
              <FileCode2 size={14} />
              <span className="mono git-file-path">
                {file.originalPath ? `${file.originalPath} → ` : ''}
                {file.path}
              </span>
              {isConflict(file) && <small className="negative">Konflikt</small>}
            </label>
          ))
        ) : (
          <div className="git-file-empty">
            <Check size={14} />
            {indexed ? 'Keine gestagten Dateien' : 'Keine lokalen Änderungen'}
          </div>
        )}
      </div>
      <footer>
        <button
          className="button secondary compact"
          disabled={busy || !selection.length}
          onClick={() =>
            void controls.run({ type: indexed ? 'unstage' : 'stage', paths: selection })
          }
        >
          {indexed ? 'Auswahl unstagen' : 'Auswahl stagen'}
        </button>
        {!indexed && (
          <button
            className="button danger-button compact"
            disabled={
              busy ||
              !selection.length ||
              selection.some((p) => context.files.find((f) => f.path === p)?.index === '?')
            }
            onClick={() => void controls.run({ type: 'discard', paths: selection })}
          >
            Auswahl verwerfen
          </button>
        )}
      </footer>
      {!indexed &&
        selection.some((p) => context.files.some((f) => f.path === p && isConflict(f))) && (
          <div className="git-conflict-actions">
            {(['ours', 'theirs'] as const).map((type) => (
              <button
                className="button secondary compact"
                key={type}
                disabled={busy}
                onClick={() =>
                  void controls.run({
                    type,
                    paths: selection.filter((p) =>
                      context.files.some((f) => f.path === p && isConflict(f)),
                    ),
                  })
                }
              >
                {type === 'ours' ? 'Unsere Version' : 'Ihre Version'}
              </button>
            ))}
            <small className="form-help">
              Danach stagen. Beim Rebase sind „ours“ und „theirs“ aus Git-Sicht vertauscht.
            </small>
          </div>
        )}
    </div>
  );
  return (
    <section className="working-tree-panel git-workbench">
      <div className="section-heading">
        <h2>Arbeitsbereich</h2>
        <span className="muted">
          {context.branch || 'Detached HEAD'} ·{' '}
          {context.identity.name || 'Git-Identität noch nicht eingerichtet'}
        </span>
      </div>
      <div className="git-staging-grid">
        {group(unstaged, unstagedSelection, setUnstagedSelection, false)}
        {group(staged, stagedSelection, setStagedSelection, true)}
      </div>
      <form
        className="git-commit-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await controls.run({ type: 'commit', message, amend })) {
            setMessage('');
            setAmend(false);
          }
        }}
      >
        <label className="form-field">
          Commit-Nachricht
          <textarea
            aria-label="Commit-Nachricht"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Was wurde geändert?"
            required
            disabled={busy}
          />
        </label>
        <div className="git-commit-footer">
          <label className="git-checkbox">
            <input
              type="checkbox"
              checked={amend}
              onChange={(e) => setAmend(e.target.checked)}
              disabled={busy || !context.head}
            />
            Letzten Commit ersetzen (Amend)
          </label>
          <span className="form-help">Nur gestagte Änderungen werden committet.</span>
          <button
            className="button primary"
            disabled={
              busy ||
              !message.trim() ||
              (!staged.length && !amend) ||
              context.files.some(isConflict)
            }
          >
            Commit erstellen
          </button>
        </div>
      </form>
    </section>
  );
}
