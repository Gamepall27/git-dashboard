import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Square } from 'lucide-react';
import type { Workspace } from '../../shared/types';
import { api, unwrap } from '../lib';
import { ErrorMessage } from './UI';

export function CreateRepository({
  type,
  onAdded,
  onBusy,
}: {
  type: 'clone' | 'init';
  onAdded: (workspace: Workspace) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [url, setUrl] = useState('');
  const [destination, setDestination] = useState('');
  const [branch, setBranch] = useState('main');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');
  const request = useRef<string | null>(null);
  useEffect(
    () =>
      api().onGitOutput((event) => {
        if (event.requestId === request.current)
          setOutput((previous) => (previous + event.text).slice(0, 512_000));
      }),
    [],
  );
  return (
    <form
      id="create-repository"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        onBusy(true);
        setError('');
        setOutput('');
        const id = crypto.randomUUID();
        request.current = id;
        try {
          const data = unwrap(
            await api().createRepository(
              id,
              type === 'clone'
                ? { type, path: destination, url }
                : { type, path: destination, branch },
            ),
          );
          setOutput(data.result.output);
          if (data.result.success) onAdded(data.workspace);
          else
            setError(
              data.result.canceled
                ? 'Abgebrochen. Ein teilweise erstellter Ordner wird nicht automatisch gelöscht.'
                : 'Git ist fehlgeschlagen. Prüfe die Ausgabe.',
            );
        } catch (e) {
          setError((e as Error).message);
        } finally {
          request.current = null;
          setBusy(false);
          onBusy(false);
        }
      }}
    >
      <p className="muted">
        {type === 'clone'
          ? 'Ein Remote-Repository in einen neuen oder leeren lokalen Ordner klonen.'
          : 'Ein Git-Repository in einem neuen oder vorhandenen Projektordner anlegen. Vorhandene Projektdateien bleiben erhalten.'}
      </p>
      {type === 'clone' ? (
        <label className="form-field">
          Clone-URL
          <input
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/team/projekt.git"
            disabled={busy}
          />
        </label>
      ) : (
        <label className="form-field">
          Initialer Branch
          <input
            required
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            disabled={busy}
          />
        </label>
      )}
      <label className="form-field">
        Zielpfad
        <input
          required
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          disabled={busy}
          placeholder={
            window.gitDashboard?.platform === 'win32'
              ? 'C:\\Projekte\\neues-repository'
              : '/home/name/projekte/neues-repository'
          }
        />
      </label>
      <button
        type="button"
        className="button secondary compact"
        disabled={busy}
        onClick={async () => {
          try {
            const selected = unwrap(await api().chooseDirectory());
            if (selected) setDestination(selected);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <FolderOpen size={14} />
        Zielordner auswählen …
      </button>
      <p className="form-help">
        Ein absoluter Pfad. Der übergeordnete Ordner muss existieren.
        {type === 'clone' &&
          ' Anmeldungen über vorhandene SSH-Schlüssel/Credential-Helper; interaktive Anmeldung im Terminal.'}
      </p>
      {output && (
        <pre className="git-output creation-output" aria-label="Git-Befehlsausgabe">
          {output}
        </pre>
      )}
      {error && <ErrorMessage message={error} />}
      {busy && (
        <button
          type="button"
          className="button danger-button compact"
          onClick={() => {
            if (request.current)
              void api()
                .cancelGitOperation(request.current)
                .then(unwrap)
                .catch((e) => setError(e.message));
          }}
        >
          <Square size={13} />
          Befehl abbrechen
        </button>
      )}
    </form>
  );
}
