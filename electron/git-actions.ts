import { randomUUID } from 'node:crypto';
import { access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import type { Repository } from '../shared/types';
import {
  formatGitCommand,
  parseGitCommand,
  type GitAction,
  type GitActionContext,
  type GitActionPlan,
  type GitOperationKind,
  type GitOperationResult,
  type RepositoryCreation,
} from '../shared/git-actions';
import { git, parseStatus, repositoryEnvironment } from './git';

export function redact(text: string) {
  return text
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1***@')
    .replace(/\x1b\[[0-9;]*m/g, '');
}
const optionalGit = (cwd: string, args: string[]) =>
  git(cwd, args).then(
    (s) => s.trim(),
    () => '',
  );
export async function gitContext(repository: Repository): Promise<GitActionContext> {
  const cwd = repository.path;
  const [
    branch,
    head,
    upstream,
    refs,
    remotesRaw,
    tags,
    stashRaw,
    status,
    name,
    email,
    markerPaths,
  ] = await Promise.all([
    optionalGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']),
    optionalGit(cwd, ['rev-parse', '--verify', 'HEAD']),
    optionalGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    git(cwd, [
      'for-each-ref',
      '--format=%(refname)%00%(refname:short)%00%(HEAD)',
      'refs/heads',
      'refs/remotes',
    ]),
    optionalGit(cwd, ['config', '--get-regexp', '^remote\\..*\\.url$']),
    git(cwd, ['tag', '--list']),
    git(cwd, ['stash', 'list', '--format=%gd%x00%H%x00%gs']),
    git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    optionalGit(cwd, ['config', 'user.name']),
    optionalGit(cwd, ['config', 'user.email']),
    Promise.all(
      ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].map(
        (marker) =>
          git(cwd, ['rev-parse', '--git-path', marker]).then((s) => path.resolve(cwd, s.trim())),
      ),
    ),
  ]);
  const exists = await Promise.all(
    markerPaths.map((p) =>
      access(p).then(
        () => true,
        () => false,
      ),
    ),
  );
  const operation: GitOperationKind | undefined =
    exists[0] || exists[1]
      ? 'rebase'
      : exists[2]
        ? 'merge'
        : exists[3]
          ? 'cherry-pick'
          : exists[4]
            ? 'revert'
            : undefined;
  const remotes = new Map<string, string>();
  for (const line of remotesRaw.split('\n')) {
    const match = line.match(/^remote\.(.+)\.url\s+(.+)$/);
    if (match && !remotes.has(match[1])) remotes.set(match[1], redact(match[2]));
  }
  return {
    branch,
    head,
    upstream,
    operation,
    identity: { name, email },
    files: parseStatus(status),
    remotes: [...remotes].map(([name, url]) => ({ name, url })),
    branches: refs
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref, name, current] = line.split('\0');
        return { ref, name, current: current === '*', remote: ref.startsWith('refs/remotes/') };
      }),
    tags: tags.trim().split('\n').filter(Boolean),
    stashes: stashRaw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref, hash, subject] = line.split('\0');
        return { ref, hash, subject };
      }),
  };
}
export interface PreparedAction {
  public: GitActionPlan;
  commands: string[][];
  input?: string;
  checkpoint?: { branch: string; head: string };
  stash?: { ref: string; hash: string };
}
function text(value: unknown, label: string, limit = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || value.includes('\0'))
    throw new Error(`${label} ist ungültig.`);
  return value;
}
async function validName(cwd: string, value: unknown): Promise<string> {
  const name = text(value, 'Name', 255);
  if (name.startsWith('-') || name === 'HEAD') throw new Error('Ungültiger Branch- oder Tag-Name.');
  await git(cwd, ['check-ref-format', `refs/heads/${name}`]);
  return name;
}
async function resolveCommit(cwd: string, input: unknown) {
  const ref = text(input, 'Revision', 255);
  if (ref.startsWith('-')) throw new Error('Ungültige Revision.');
  return (await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
}
export async function prepareAction(
  repository: Repository,
  input: unknown,
): Promise<PreparedAction> {
  const action = input as GitAction;
  if (!action || typeof action !== 'object' || typeof action.type !== 'string')
    throw new Error('Ungültige Git-Aktion.');
  const context = await gitContext(repository);
  const cwd = repository.path;
  let args: string[] = [];
  let commands: string[][] | undefined;
  let stdin: string | undefined;
  let label = '';
  let warning: string | undefined;
  let paths: string[] | undefined;
  let stash: PreparedAction['stash'];
  const remote = (name: unknown) => {
    const value = text(name, 'Remote');
    if (!context.remotes.some((r) => r.name === value) || value.startsWith('-'))
      throw new Error('Remote wurde nicht gefunden.');
    return value;
  };
  switch (action.type) {
    case 'stage':
    case 'unstage':
    case 'discard':
    case 'ours':
    case 'theirs': {
      if (!Array.isArray(action.paths) || !action.paths.length || action.paths.length > 10_000)
        throw new Error('Bitte Dateien auswählen.');
      const selected = action.paths.map((p) => {
        text(p, 'Dateipfad');
        const file = context.files.find((f) => f.path === p);
        if (!file || path.isAbsolute(p) || p.split(/[\\/]/).includes('..'))
          throw new Error('Die Dateiauswahl ist nicht mehr aktuell.');
        return file;
      });
      if (action.type === 'discard' && selected.some((f) => f.index === '?'))
        throw new Error(
          'Neue Dateien werden nicht gelöscht. Zum Verwerfen bitte nur versionierte Dateien auswählen.',
        );
      paths = [
        ...new Set(
          selected.flatMap((f) => {
            // Resetting a rename needs both paths; a staged rename's old path is
            // no longer in the index and cannot be restored or added.
            if (
              f.originalPath &&
              (action.type === 'unstage' ||
                (action.type === 'stage' && !['R', 'C'].includes(f.index)))
            )
              return [f.path, f.originalPath];
            return [f.path];
          }),
        ),
      ];
      const pathspec = ['--pathspec-from-file=-', '--pathspec-file-nul'];
      stdin = `${paths.join('\0')}\0`;
      if (action.type === 'stage') {
        args = ['--literal-pathspecs', 'add', '--all', ...pathspec];
        label = 'Auswahl stagen';
      } else if (action.type === 'unstage') {
        args = context.head
          ? ['--literal-pathspecs', 'reset', '-q', 'HEAD', ...pathspec]
          : ['--literal-pathspecs', 'rm', '--cached', '-r', '-f', '--ignore-unmatch', ...pathspec];
        label = 'Auswahl unstagen';
      } else {
        args = [
          '--literal-pathspecs',
          'restore',
          '--worktree',
          ...(action.type === 'ours' ? ['--ours'] : action.type === 'theirs' ? ['--theirs'] : []),
          ...pathspec,
        ];
        label =
          action.type === 'discard'
            ? 'Änderungen verwerfen'
            : action.type === 'ours'
              ? 'Unsere Version übernehmen'
              : 'Ihre Version übernehmen';
        warning =
          'Der Inhalt dieser Dateien im Arbeitsverzeichnis wird ersetzt. Nicht gestagte Änderungen gehen verloren.';
      }
      break;
    }
    case 'stageAll':
      args = ['add', '--all'];
      label = 'Alles stagen';
      break;
    case 'unstageAll':
      args = context.head
        ? ['reset', '-q', 'HEAD', '--', '.']
        : ['rm', '--cached', '-r', '-f', '--ignore-unmatch', '--', '.'];
      label = 'Alles unstagen';
      break;
    case 'commit':
      stdin = text(action.message, 'Commit-Nachricht', 100_000);
      args = ['commit', '-F', '-'];
      label = 'Commit erstellen';
      if (action.amend) {
        if (!context.head) throw new Error('Es gibt noch keinen Commit zum Ändern.');
        args.push('--amend');
        warning =
          'Der letzte Commit wird ersetzt. Bereits gepushte Historie muss anschließend gegebenenfalls mit Force-with-lease aktualisiert werden.';
      }
      break;
    case 'fetch':
      args = ['fetch', '--all', '--prune', '--progress'];
      label = 'Fetch';
      break;
    case 'pull': {
      if (!['ff-only', 'rebase', 'merge'].includes(action.mode))
        throw new Error('Ungültiger Pull-Modus.');
      args = ['pull', action.mode === 'merge' ? '--no-rebase' : `--${action.mode}`];
      if (action.remote || action.branch)
        args.push(remote(action.remote), await validName(cwd, action.branch));
      label = 'Pull';
      if (action.mode === 'rebase')
        warning =
          'Lokale Commits werden auf den Remote-Stand umgesetzt. Bei Konflikten muss der Rebase fortgesetzt oder abgebrochen werden.';
      break;
    }
    case 'push': {
      if (!context.branch)
        throw new Error('Push benötigt einen lokalen Branch. Bitte zuerst einen Branch anlegen.');
      args = ['push', '--progress'];
      label = 'Push';
      if (action.remote) {
        const name = remote(action.remote);
        const target = await validName(cwd, action.branch || context.branch);
        args.push('--set-upstream');
        if (action.force) {
          const expected = await optionalGit(cwd, [
            'rev-parse',
            '--verify',
            `refs/remotes/${name}/${target}`,
          ]);
          args.push(`--force-with-lease=refs/heads/${target}:${expected}`);
          warning =
            'Die Historie dieses Remote-Branches wird ersetzt, wenn sein Stand noch der lokal bekannten Referenz entspricht.';
        }
        args.push(name, `${context.branch}:refs/heads/${target}`);
      } else {
        if (action.force)
          throw new Error('Für Force-with-lease bitte einen Remote und Zielbranch auswählen.');
        if (!context.upstream)
          throw new Error(
            'Kein Upstream vorhanden. Bitte einen Remote für den ersten Push auswählen.',
          );
      }
      break;
    }
    case 'switch': {
      const branch = context.branches.find((b) => b.ref === action.ref);
      if (!branch || branch.ref.endsWith('/HEAD'))
        throw new Error('Bitte einen vorhandenen Branch auswählen.');
      args = branch.remote
        ? ['switch', '--track', '--', branch.ref]
        : ['switch', '--', branch.name];
      label = 'Branch wechseln';
      break;
    }
    case 'branchCreate':
      args = [
        'switch',
        '-c',
        await validName(cwd, action.name),
        ...(action.start ? [await resolveCommit(cwd, action.start)] : []),
      ];
      label = 'Branch anlegen und wechseln';
      break;
    case 'branchRename':
      args = ['branch', '-m', await validName(cwd, action.name)];
      label = 'Aktuellen Branch umbenennen';
      break;
    case 'branchDelete': {
      const branch = context.branches.find((b) => b.ref === action.ref && !b.remote && !b.current);
      if (!branch) throw new Error('Bitte einen anderen lokalen Branch auswählen.');
      args = ['branch', '-d', '--', branch.name];
      label = 'Branch löschen';
      warning = `Der lokale Branch „${branch.name}“ wird gelöscht. Git verweigert dies bei nicht zusammengeführten Commits.`;
      break;
    }
    case 'merge':
    case 'rebase':
    case 'cherryPick':
    case 'revert': {
      const target = await resolveCommit(cwd, action.ref);
      const cmd = action.type === 'cherryPick' ? 'cherry-pick' : action.type;
      args = [cmd, ...(action.type === 'merge' ? ['--no-edit'] : []), target];
      label = cmd;
      if (action.type === 'rebase')
        warning =
          'Commits des aktuellen Branches werden umgesetzt. Dadurch ändern sich ihre Commit-Hashes.';
      break;
    }
    case 'continue':
    case 'abort':
      if (!context.operation) throw new Error('Es läuft keine fortsetzbare Git-Operation.');
      args = [context.operation, `--${action.type}`];
      label = action.type === 'continue' ? 'Operation fortsetzen' : 'Operation abbrechen';
      if (action.type === 'abort')
        warning =
          'Die laufende Operation wird abgebrochen. Seit ihrem Beginn vorgenommene Änderungen können dabei ersetzt werden.';
      break;
    case 'stashSave':
      args = [
        'stash',
        'push',
        ...(action.includeUntracked ? ['--include-untracked'] : []),
        ...(action.message ? ['-m', text(action.message, 'Stash-Nachricht')] : []),
      ];
      label = 'Änderungen stashen';
      break;
    case 'stashApply':
    case 'stashPop':
    case 'stashDrop': {
      const selected = context.stashes.find((s) => s.ref === action.ref);
      if (!selected) throw new Error('Stash wurde nicht gefunden.');
      const cmd =
        action.type === 'stashApply' ? 'apply' : action.type === 'stashPop' ? 'pop' : 'drop';
      args = ['stash', cmd, cmd === 'apply' ? selected.hash : selected.ref];
      label = `Stash ${cmd}`;
      if (cmd !== 'apply') stash = { ref: selected.ref, hash: selected.hash };
      if (cmd === 'drop')
        warning =
          'Dieser gespeicherte Stash wird gelöscht. Die darin gespeicherten Änderungen werden nicht wiederhergestellt.';
      break;
    }
    case 'reset':
      if (!['soft', 'mixed', 'hard'].includes(action.mode))
        throw new Error('Ungültiger Reset-Modus.');
      args = ['reset', `--${action.mode}`, await resolveCommit(cwd, action.ref)];
      label = `Reset (${action.mode})`;
      warning =
        action.mode === 'hard'
          ? 'Branch, Index und Arbeitsverzeichnis werden zurückgesetzt. Nicht committete Änderungen werden verworfen; blockierende neue Dateien können ebenfalls entfernt werden.'
          : action.mode === 'mixed'
            ? 'Der aktuelle Branch wird zurückgesetzt und der Index geleert. Dateien im Arbeitsverzeichnis bleiben erhalten.'
            : 'Der aktuelle Branch wird zurückgesetzt. Index und Arbeitsverzeichnis bleiben erhalten.';
      break;
    case 'tagCreate': {
      const name = await validName(cwd, action.name);
      args = [
        'tag',
        ...(action.message ? ['-a', '-m', text(action.message, 'Tag-Nachricht')] : []),
        name,
        ...(action.ref ? [await resolveCommit(cwd, action.ref)] : []),
      ];
      label = 'Tag erstellen';
      break;
    }
    case 'tagDelete':
      if (!context.tags.includes(action.ref)) throw new Error('Tag wurde nicht gefunden.');
      args = ['tag', '-d', '--', action.ref];
      label = 'Tag löschen';
      warning = 'Dieser lokale Tag wird entfernt. Remote-Tags bleiben erhalten.';
      break;
    case 'remoteAdd':
      args = ['remote', 'add', await validName(cwd, action.name), text(action.url, 'Remote-URL')];
      if (args[3].startsWith('-')) throw new Error('Ungültige Remote-URL.');
      label = 'Remote hinzufügen';
      break;
    case 'remoteRemove':
      args = ['remote', 'remove', remote(action.name)];
      label = 'Remote entfernen';
      warning = 'Die Remote-Konfiguration und ihre lokalen Tracking-Referenzen werden entfernt.';
      break;
    case 'identity': {
      const name = text(action.name, 'Name', 255),
        email = text(action.email, 'E-Mail', 255);
      if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('Ungültige E-Mail-Adresse.');
      commands = [
        ['config', '--local', 'user.name', name],
        ['config', '--local', 'user.email', email],
      ];
      args = commands[0];
      label = 'Git-Identität für dieses Repository speichern';
      break;
    }
    case 'custom':
      args = parseGitCommand(action.command);
      label = 'Git-Befehl ausführen';
      warning =
        'Eigene Git-Befehle können Dateien, Referenzen, Konfiguration oder Remote-Repositories verändern. Auch konfigurierte Git-Aliase und Hooks können ausgeführt werden. Bitte den vollständigen Befehl und Repository-Pfad prüfen.';
      if (
        ['reset', 'clean', 'restore', 'checkout', 'switch', 'rebase'].includes(args[0]) ||
        args.some((arg) =>
          ['--force', '-f', '-D', '--delete', '-d', '--hard', '--amend', '--prune=now'].includes(
            arg,
          ),
        ) ||
        (args[0] === 'stash' && ['drop', 'clear'].includes(args[1])) ||
        (args[0] === 'remote' && ['remove', 'rm', 'set-url'].includes(args[1]))
      )
        warning =
          'Dieser Git-Befehl kann vorhandene Dateien, Referenzen oder Historie verändern bzw. löschen. Bitte Befehl und Repository prüfen.';
      break;
    default:
      throw new Error('Diese Git-Aktion ist nicht unterstützt.');
  }
  const command = (commands ?? [args]).map(formatGitCommand).join('\n');
  return {
    public: {
      token: randomUUID(),
      label,
      command: redact(command),
      repositoryPath: cwd,
      requiresConfirmation: !!warning,
      warning,
      paths,
    },
    commands: commands ?? [args],
    input: stdin,
    checkpoint: { branch: context.branch, head: context.head },
    stash,
  };
}

export async function validatePlan(repository: Repository, plan: PreparedAction) {
  const [branch, head] = await Promise.all([
    optionalGit(repository.path, ['symbolic-ref', '--short', '-q', 'HEAD']),
    optionalGit(repository.path, ['rev-parse', '--verify', 'HEAD']),
  ]);
  if (plan.checkpoint && (plan.checkpoint.branch !== branch || plan.checkpoint.head !== head))
    throw new Error(
      'Der Branch oder HEAD hat sich seit der Vorbereitung geändert. Bitte die Aktion erneut öffnen.',
    );
  if (
    plan.stash &&
    (await optionalGit(repository.path, ['rev-parse', '--verify', plan.stash.ref])) !==
      plan.stash.hash
  )
    throw new Error('Die Stash-Liste hat sich geändert. Bitte erneut auswählen.');
}
export function executeCommand(
  cwd: string,
  args: string[],
  input: string | undefined,
  onOutput: (text: string) => void,
  signal: AbortSignal,
): Promise<GitOperationResult> {
  signal.throwIfAborted();
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...repositoryEnvironment(),
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_EDITOR: ':',
      GIT_SEQUENCE_EDITOR: ':',
      GIT_MERGE_AUTOEDIT: 'no',
      LC_ALL: 'C.UTF-8',
    };
    delete env.GIT_OPTIONAL_LOCKS;
    const child = spawn(
      'git',
      ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-C', cwd, ...args],
      { env, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe' },
    );
    let output = '';
    let truncated = false;
    let canceled = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const append = (text: string) => {
      const clean = redact(text);
      const available = 512_000 - output.length;
      if (available > 0) {
        const part = clean.slice(0, available);
        output += part;
        onOutput(part);
      }
      if (clean.length > available) truncated = true;
    };
    const cancel = () => {
      canceled = true;
      if (!child.pid) return;
      if (process.platform === 'win32')
        execFile(
          'taskkill',
          ['/pid', String(child.pid), '/T', '/F'],
          { windowsHide: true },
          () => {},
        );
      else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {}
        killTimer = setTimeout(() => {
          if (!settled && child.pid) {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch {}
          }
        }, 2000);
      }
    };
    const timer = setTimeout(() => {
      append('\nZeitlimit von drei Minuten erreicht.\n');
      cancel();
    }, 180_000);
    const finish = (exitCode: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal.removeEventListener('abort', cancel);
      if (error) append(`\n${error.message}\n`);
      resolve({
        success: exitCode === 0 && !canceled && !error,
        command: redact(formatGitCommand(args)),
        output,
        exitCode,
        canceled,
        truncated,
      });
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}
export async function repositoryLockKey(repository: Repository) {
  const directory = (await git(repository.path, ['rev-parse', '--git-common-dir'])).trim();
  const key = await realpath(path.resolve(repository.path, directory));
  return process.platform === 'win32' ? key.toLowerCase() : key;
}
export async function creationCommand(
  input: unknown,
): Promise<{ cwd: string; args: string[]; destination: string }> {
  const creation = input as RepositoryCreation;
  if (!creation || !['clone', 'init'].includes(creation.type))
    throw new Error('Ungültige Repository-Erstellung.');
  const requested = text(creation.path, 'Zielpfad');
  const destination = path.resolve(requested);
  if (!path.isAbsolute(requested) || path.parse(destination).root === destination)
    throw new Error('Bitte einen absoluten Projektordner auswählen.');
  const parent = path.dirname(destination);
  if (!(await stat(parent)).isDirectory())
    throw new Error('Der übergeordnete Ordner existiert nicht.');
  if (creation.type === 'clone') {
    const url = text(creation.url, 'Clone-URL');
    if (url.startsWith('-')) throw new Error('Ungültige Clone-URL.');
    return { cwd: parent, args: ['clone', '--progress', '--', url, destination], destination };
  }
  if (
    await access(path.join(destination, '.git')).then(
      () => true,
      () => false,
    )
  )
    throw new Error('Dieser Ordner enthält bereits ein Git-Repository.');
  const branch = await validName(parent, creation.branch);
  return {
    cwd: parent,
    args: ['init', `--initial-branch=${branch}`, '--', destination],
    destination,
  };
}
