import { useEffect, useRef } from 'react';
import { AlertTriangle, Check, Square, Terminal } from 'lucide-react';
import type { GitActionPlan } from '../../shared/git-actions';
import type { GitJob } from '../useGitOperations';
import { Modal } from './UI';

export function GitConfirmation({
  plan,
  onConfirm,
}: {
  plan: GitActionPlan;
  onConfirm: (accepted: boolean) => void;
}) {
  return (
    <Modal title={plan.label} onClose={() => onConfirm(false)}>
      <div className="modal-body git-confirmation">
        <p className="git-warning">
          <AlertTriangle size={18} />
          {plan.warning}
        </p>
        <label className="form-field">
          Repository <span className="mono git-repository-path">{plan.repositoryPath}</span>
        </label>
        <pre className="git-command">{plan.command}</pre>
        {!!plan.paths?.length && (
          <div className="git-confirm-files">
            <span className="muted">Betroffene Dateien ({plan.paths.length})</span>
            <ul>
              {plan.paths.map((p) => (
                <li className="mono" key={p}>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <footer className="modal-footer">
        <button className="button secondary" onClick={() => onConfirm(false)}>
          Abbrechen
        </button>
        <button className="button danger-button" onClick={() => onConfirm(true)}>
          Bestätigen und ausführen
        </button>
      </footer>
    </Modal>
  );
}
export function GitOutput({
  job,
  onClose,
  onCancel,
}: {
  job: GitJob;
  onClose: () => void;
  onCancel: () => void;
}) {
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [job.output]);
  const busy = job.phase !== 'done';
  return (
    <Modal title="Git-Ausgabe" wide onClose={onClose}>
      <div className="modal-body git-output-body">
        <div className="git-output-status" role="status">
          {busy ? (
            <Terminal size={16} />
          ) : job.result?.success ? (
            <Check size={16} className="positive" />
          ) : (
            <AlertTriangle size={16} className="negative" />
          )}
          <strong>{job.label}</strong>
          <span className="muted">
            {busy
              ? 'Läuft …'
              : job.result?.canceled
                ? 'Abgebrochen'
                : job.result?.success
                  ? 'Erfolgreich'
                  : job.error || `Fehlgeschlagen · Exit ${job.result?.exitCode ?? '—'}`}
          </span>
        </div>
        <pre className="git-output" ref={pre} aria-label="Git-Befehlsausgabe">
          {job.output || 'Git wird vorbereitet …'}
          {job.error ? `\n${job.error}` : ''}
        </pre>
        {job.result?.truncated && <p className="form-help">Ausgabe auf 512 KB begrenzt.</p>}
        {!busy && !job.result?.success && job.result && (
          <p className="form-help">
            Ein fehlgeschlagener oder abgebrochener Befehl kann Änderungen hinterlassen. Prüfe den
            Arbeitsbereich; laufende Merge-/Rebase-Operationen lassen sich dort fortsetzen oder
            abbrechen.
          </p>
        )}
      </div>
      <footer className="modal-footer">
        {job.phase === 'running' && (
          <button className="button danger-button" onClick={onCancel}>
            <Square size={13} />
            Befehl abbrechen
          </button>
        )}
        <button className="button secondary" onClick={onClose}>
          Schließen
        </button>
      </footer>
    </Modal>
  );
}
