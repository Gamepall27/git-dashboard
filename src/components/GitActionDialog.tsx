import { useState } from 'react';
import type { ReactNode } from 'react';
import type { GitAction, GitActionContext } from '../../shared/git-actions';
import { ErrorMessage, Modal } from './UI';

const actions = [
  ['push', 'Push'],
  ['pull', 'Pull'],
  ['switch', 'Branch wechseln'],
  ['branchCreate', 'Branch anlegen'],
  ['branchRename', 'Branch umbenennen'],
  ['branchDelete', 'Branch löschen'],
  ['merge', 'Merge'],
  ['rebase', 'Rebase'],
  ['cherryPick', 'Cherry-pick'],
  ['revert', 'Commit revertieren'],
  ['stashSave', 'Stash speichern'],
  ['stashApply', 'Stash anwenden'],
  ['stashPop', 'Stash anwenden und entfernen'],
  ['stashDrop', 'Stash löschen'],
  ['tagCreate', 'Tag erstellen'],
  ['tagDelete', 'Tag löschen'],
  ['reset', 'Reset'],
  ['remoteAdd', 'Remote hinzufügen'],
  ['remoteRemove', 'Remote entfernen'],
  ['identity', 'Git-Identität'],
  ['custom', 'Eigener Git-Befehl'],
] as const;
type ActionType = (typeof actions)[number][0];
export function GitActionDialog({
  context,
  initial,
  onRun,
  onClose,
}: {
  context: GitActionContext;
  initial?: ActionType;
  onRun: (action: GitAction) => Promise<boolean>;
  onClose: () => void;
}) {
  const [type, setType] = useState<ActionType>(initial || 'switch');
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState('');
  const [remote, setRemote] = useState(
    context.remotes.find((r) => r.name === 'origin')?.name || context.remotes[0]?.name || '',
  );
  const [branch, setBranch] = useState(context.branch || 'main');
  const [force, setForce] = useState(false);
  const [mode, setMode] = useState('ff-only');
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [email, setEmail] = useState(context.identity.email);
  const [identityName, setIdentityName] = useState(context.identity.name);
  const [command, setCommand] = useState('git status');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = (
    label: string,
    value: string,
    onChange: (s: string) => void,
    placeholder?: string,
    required = true,
  ) => (
    <label className="form-field">
      {label}
      <input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={busy}
      />
    </label>
  );
  const select = (
    label: string,
    value: string,
    onChange: (s: string) => void,
    options: { value: string; label: string }[],
    placeholder = 'Bitte auswählen …',
  ) => (
    <label className="form-field">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        disabled={busy}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const localBranches = context.branches.filter(
    (b) => !b.ref.endsWith('/HEAD') && (type !== 'branchDelete' || (!b.remote && !b.current)),
  );
  let fields: ReactNode;
  switch (type) {
    case 'push':
    case 'pull':
      fields = (
        <>
          {select(
            'Remote',
            remote,
            setRemote,
            context.remotes.map((r) => ({ value: r.name, label: `${r.name} · ${r.url}` })),
          )}
          {field('Zielbranch', branch, setBranch)}
          {type === 'pull' ? (
            select('Pull-Modus', mode, setMode, [
              { value: 'ff-only', label: 'Nur Fast-forward (sicherer Standard)' },
              { value: 'rebase', label: 'Rebase' },
              { value: 'merge', label: 'Merge' },
            ])
          ) : (
            <label className="git-checkbox">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              Force-with-lease (mit Bestätigung)
            </label>
          )}
          <p className="form-help">
            Git verwendet deine vorhandenen SSH-Schlüssel bzw. Credential-Helper. Interaktive
            Anmeldungen bitte im Terminal durchführen.
          </p>
        </>
      );
      break;
    case 'switch':
    case 'branchDelete':
      fields = (
        <>
          {select(
            'Branch',
            ref,
            setRef,
            localBranches.map((b) => ({
              value: b.ref,
              label: b.name + (b.remote ? ' · neuen Tracking-Branch anlegen' : ''),
            })),
          )}
          <p className="form-help">
            Hier wird der Branch tatsächlich gewechselt bzw. gelöscht. Der Branch-Filter der
            Historie ändert dagegen nur die Anzeige.
          </p>
        </>
      );
      break;
    case 'branchCreate':
      fields = (
        <>
          {field('Branch-Name', name, setName, 'feature/meine-aenderung')}
          {field(
            'Startrevision (optional)',
            ref,
            setRef,
            'HEAD, origin/main oder Commit-Hash',
            false,
          )}
        </>
      );
      break;
    case 'branchRename':
      fields = field('Neuer Branch-Name', name, setName);
      break;
    case 'merge':
    case 'rebase':
    case 'cherryPick':
    case 'revert':
      fields = (
        <>
          {field('Revision', ref, setRef, 'Branch, Tag oder Commit-Hash')}
          <p className="form-help">
            Die Aktion betrifft den aktuellen Branch „{context.branch || 'Detached HEAD'}“. Bei
            Konflikten zeigt der Arbeitsbereich die Optionen Fortsetzen und Abbrechen.
          </p>
        </>
      );
      break;
    case 'reset':
      fields = (
        <>
          {field('Revision', ref, setRef, 'HEAD~1')}
          {select('Reset-Modus', mode, setMode, [
            { value: 'soft', label: 'Soft · Dateien und Index behalten' },
            { value: 'mixed', label: 'Mixed · Dateien behalten, Index zurücksetzen' },
            { value: 'hard', label: 'Hard · Änderungen verwerfen' },
          ])}
        </>
      );
      break;
    case 'stashSave':
      fields = (
        <>
          {field('Stash-Nachricht (optional)', message, setMessage, 'Zwischenstand', false)}
          <label className="git-checkbox">
            <input
              type="checkbox"
              checked={includeUntracked}
              onChange={(e) => setIncludeUntracked(e.target.checked)}
            />
            Neue, nicht versionierte Dateien einschließen
          </label>
        </>
      );
      break;
    case 'stashApply':
    case 'stashPop':
    case 'stashDrop':
      fields = select(
        'Stash',
        ref,
        setRef,
        context.stashes.map((s) => ({ value: s.ref, label: `${s.ref} · ${s.subject}` })),
      );
      break;
    case 'tagCreate':
      fields = (
        <>
          {field('Tag-Name', name, setName, 'v1.0.0')}
          {field('Revision (optional)', ref, setRef, 'HEAD', false)}
          {field(
            'Tag-Nachricht (optional)',
            message,
            setMessage,
            'Mit Nachricht wird ein annotierter Tag erstellt',
            false,
          )}
        </>
      );
      break;
    case 'tagDelete':
      fields = select(
        'Tag',
        ref,
        setRef,
        context.tags.map((t) => ({ value: t, label: t })),
      );
      break;
    case 'remoteAdd':
      fields = (
        <>
          {field('Remote-Name', name, setName, 'origin')}
          {field('Remote-URL', url, setUrl, 'git@github.com:team/projekt.git')}
        </>
      );
      break;
    case 'remoteRemove':
      fields = select(
        'Remote',
        remote,
        setRemote,
        context.remotes.map((r) => ({ value: r.name, label: r.name })),
      );
      break;
    case 'identity':
      fields = (
        <>
          {field('Autorname', identityName, setIdentityName)}
          {field('E-Mail', email, setEmail)}
          <p className="form-help">Wird nur für dieses Repository gespeichert, nicht global.</p>
        </>
      );
      break;
    case 'custom':
      fields = (
        <>
          <label className="form-field">
            Git-Befehl
            <textarea
              aria-label="Git-Befehl"
              className="mono"
              rows={4}
              required
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              disabled={busy}
            />
          </label>
          <p className="form-help">
            Ein Git-Unterbefehl, keine Shell-Pipelines. Ausgabe wird live angezeigt. Interaktive
            Befehle wie „git add -p“ bitte über „Terminal öffnen“ ausführen. Eigene Befehle können
            auch andere Pfade oder Remote-Repositories betreffen.
          </p>
        </>
      );
      break;
  }
  function buildAction(): GitAction {
    switch (type) {
      case 'push':
        return { type, remote, branch, force };
      case 'pull':
        return { type, remote, branch, mode: mode as 'ff-only' | 'rebase' | 'merge' };
      case 'branchCreate':
        return { type, name, start: ref || undefined };
      case 'branchRename':
        return { type, name };
      case 'stashSave':
        return { type, message, includeUntracked };
      case 'reset':
        return { type, ref, mode: mode as 'soft' | 'mixed' | 'hard' };
      case 'tagCreate':
        return { type, name, ref: ref || undefined, message };
      case 'remoteAdd':
        return { type, name, url };
      case 'remoteRemove':
        return { type, name: remote };
      case 'identity':
        return { type, name: identityName, email };
      case 'custom':
        return { type, command };
      default:
        return { type, ref };
    }
  }
  return (
    <Modal
      title="Git-Aktion"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const success = await onRun(buildAction());
            if (success) onClose();
            else
              setError(
                'Die Aktion wurde nicht ausgeführt oder ist fehlgeschlagen. Details stehen in der Git-Ausgabe.',
              );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body git-action-form">
          <p className="form-help">
            Aktueller Branch: <strong>{context.branch || 'Detached HEAD'}</strong>
            {context.upstream ? ` · Upstream: ${context.upstream}` : ' · Kein Upstream'}
          </p>
          {select(
            'Aktion',
            type,
            (value) => {
              setType(value as ActionType);
              setRef('');
              setError('');
              setMode(value === 'reset' ? 'mixed' : 'ff-only');
            },
            actions.map(([value, label]) => ({ value, label })),
          )}
          {fields}
          {error && <ErrorMessage message={error} />}
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Schließen
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Ausführen …' : 'Ausführen'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
