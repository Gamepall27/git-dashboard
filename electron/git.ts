import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  Branch,
  Commit,
  CommitDetail,
  FileChange,
  HistoryPage,
  Repository,
  RepoSnapshot,
  WorkingFile,
} from '../shared/types';

const LOG_FORMAT = '%x1e%H%x00%h%x00%aN%x00%aE%x00%cI%x00%s%x00%P%x00%D%x00';
export const MAX_STATS_COMMITS = 20_000;
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C.UTF-8',
};

export function git(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-c', 'core.quotepath=false', '-C', cwd, ...args],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: GIT_ENV,
        timeout: 90_000,
        maxBuffer: 64 * 1024 * 1024,
        signal,
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return reject(
            new Error('Git wurde nicht gefunden. Bitte Git installieren und die App neu starten.'),
          );
        if ((error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
          return reject(
            new Error(
              'Dieses Repository überschreitet die Datenbegrenzung. Die Historie enthält sehr große Änderungen.',
            ),
          );
        reject(new Error(stderr.trim() || error.message));
      },
    );
    if (input !== undefined) {
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    }
  });
}
function gitRevisions(cwd: string, args: string[], revisions: string[], signal?: AbortSignal) {
  // stdin also supports repositories with more refs than Windows' argument limit.
  return git(cwd, [...args, '--stdin'], signal, `${revisions.join('\n')}\n`);
}
export function parseNumstat(raw: string): FileChange[] {
  const tokens = raw.split('\0');
  const files: FileChange[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const match = tokens[i].match(/^\n?(\d+|-)\t(\d+|-)\t([\s\S]*)$/);
    if (!match) continue;
    let filePath = match[3];
    if (!filePath) {
      i++;
      filePath = tokens[++i] ?? '';
    }
    files.push({
      path: filePath,
      additions: match[1] === '-' ? 0 : Number(match[1]),
      deletions: match[2] === '-' ? 0 : Number(match[2]),
      binary: match[1] === '-',
    });
  }
  return files;
}
export function parseLog(raw: string): Commit[] {
  return raw
    .split('\x1e')
    .slice(1)
    .map((record) => {
      const fields = record.split('\0');
      const [hash, shortHash, author, email, date, subject, parents, refs] = fields;
      const files = parseNumstat(fields.slice(8).join('\0'));
      return {
        hash,
        shortHash,
        author,
        email,
        date,
        subject,
        parents: parents ? parents.split(' ') : [],
        refs,
        files,
        additions: files.reduce((sum, f) => sum + f.additions, 0),
        deletions: files.reduce((sum, f) => sum + f.deletions, 0),
      };
    });
}
export function parseStatus(raw: string): WorkingFile[] {
  const tokens = raw.split('\0');
  const files: WorkingFile[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i]) continue;
    const file: WorkingFile = {
      index: tokens[i][0],
      working: tokens[i][1],
      path: tokens[i].slice(3),
    };
    if (/[RC]/.test(file.index + file.working)) file.originalPath = tokens[++i];
    files.push(file);
  }
  return files;
}
export async function inspectRepository(input: string): Promise<Repository> {
  const root = (await git(path.resolve(input), ['rev-parse', '--show-toplevel'])).trim();
  const canonical = await realpath(root);
  const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  return {
    id: createHash('sha256').update(identity).digest('hex').slice(0, 16),
    path: canonical,
    name: path.basename(canonical),
  };
}
async function branches(cwd: string): Promise<Branch[]> {
  const raw = await git(cwd, [
    'for-each-ref',
    '--format=%(refname)%00%(refname:short)%00%(HEAD)',
    'refs/heads',
    'refs/remotes',
  ]);
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, name, head] = line.split('\0');
      return { name, ref, current: head === '*', remote: ref.startsWith('refs/remotes/') };
    });
}
export interface RepositorySummary {
  snapshot: RepoSnapshot;
  revisions: string[];
}
export async function repositorySummary(
  repository: Repository,
  previous?: RepoSnapshot,
  signal?: AbortSignal,
): Promise<RepositorySummary> {
  const updatedAt = new Date().toISOString();
  const empty: RepoSnapshot = {
    repository,
    branch: '',
    branches: [],
    commits: [],
    workingFiles: [],
    ahead: 0,
    behind: 0,
    totalCommits: 0,
    truncated: false,
    updatedAt,
    statisticsComplete: false,
    recentCommits: [],
  };
  try {
    const [branchName, head, refsRaw, status, divergence, mailmap] = await Promise.all([
      git(repository.path, ['symbolic-ref', '--short', '-q', 'HEAD'], signal).catch(() => ''),
      git(repository.path, ['rev-parse', '--verify', 'HEAD'], signal).catch(() => ''),
      git(
        repository.path,
        [
          'for-each-ref',
          '--format=%(refname)%00%(refname:short)%00%(HEAD)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)',
        ],
        signal,
      ),
      git(repository.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal),
      git(
        repository.path,
        ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
        signal,
      ).catch(() => '0\t0'),
      stat(path.join(repository.path, '.mailmap')).then(
        (s) => `${s.mtimeMs}:${s.size}`,
        () => '',
      ),
    ]);
    signal?.throwIfAborted();
    const refs: Branch[] = [];
    const tips = new Set<string>(head.trim() ? [head.trim()] : []);
    for (const line of refsRaw.trim().split('\n').filter(Boolean)) {
      const [ref, name, current, hash, type, peeledHash, peeledType] = line.split('\0');
      if (ref.startsWith('refs/heads/') || ref.startsWith('refs/remotes/'))
        refs.push({ name, ref, current: current === '*', remote: ref.startsWith('refs/remotes/') });
      if (type === 'commit') tips.add(hash);
      else if (peeledType === 'commit') tips.add(peeledHash);
    }
    const revisions = [...tips];
    const historyVersion = createHash('sha256')
      .update(`${refsRaw}\0${head}\0${mailmap}`)
      .digest('hex');
    const [totalCommits, recent] = await Promise.all([
      previous?.historyVersion === historyVersion
        ? Promise.resolve(previous.totalCommits)
        : revisions.length
          ? gitRevisions(repository.path, ['rev-list', '--count'], revisions, signal).then((s) =>
              Number(s.trim()),
            )
          : Promise.resolve(0),
      revisions.length
        ? gitRevisions(
            repository.path,
            ['log', '--date-order', '--max-count=12', `--format=${LOG_FORMAT}`],
            revisions,
            signal,
          ).then(parseLog)
        : Promise.resolve([]),
    ]);
    const [ahead, behind] = divergence.trim().split(/\s+/).map(Number);
    return {
      revisions,
      snapshot: {
        ...empty,
        historyVersion,
        branch: branchName.trim() || `detached · ${head.trim().slice(0, 7)}`,
        branches: refs,
        workingFiles: parseStatus(status),
        totalCommits,
        recentCommits: recent.map((commit) => ({ ...commit, statsLoaded: false })),
        truncated: totalCommits > MAX_STATS_COMMITS,
        statisticsComplete: totalCommits === 0,
        ahead,
        behind,
      },
    };
  } catch (error) {
    signal?.throwIfAborted();
    return {
      revisions: [],
      snapshot: { ...empty, statisticsComplete: true, error: (error as Error).message },
    };
  }
}
export const STATISTICS_PAGE_SIZE = 250;
export async function statisticsPage(
  repository: Repository,
  revisions: string[],
  offset: number,
  signal?: AbortSignal,
): Promise<HistoryPage> {
  if (!revisions.length) return { commits: [], hasMore: false };
  const limit = Math.min(STATISTICS_PAGE_SIZE, MAX_STATS_COMMITS - offset);
  if (limit <= 0) return { commits: [], hasMore: false };
  const raw = await gitRevisions(
    repository.path,
    [
      'log',
      '--date-order',
      `--max-count=${limit + 1}`,
      `--skip=${offset}`,
      `--format=${LOG_FORMAT}`,
      '--numstat',
      '-z',
      '--find-renames',
      '--no-ext-diff',
      '--no-textconv',
    ],
    revisions,
    signal,
  );
  const commits = parseLog(raw);
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
}
// Full snapshot for diagnostics and integration tests; the UI uses streamed pages.
export async function snapshot(repository: Repository): Promise<RepoSnapshot> {
  const { snapshot: data, revisions } = await repositorySummary(repository);
  if (data.error) return data;
  while (data.commits.length < MAX_STATS_COMMITS) {
    const page = await statisticsPage(repository, revisions, data.commits.length);
    data.commits.push(...page.commits);
    if (!page.hasMore) break;
  }
  return { ...data, statisticsComplete: true };
}
export async function history(
  repository: Repository,
  branch: string,
  offset: number,
): Promise<HistoryPage> {
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000_000)
    throw new Error('Ungültiger Historienoffset.');
  if (branch !== 'HEAD' && !(await branches(repository.path)).some((b) => b.ref === branch))
    throw new Error('Dieser Branch existiert nicht mehr. Bitte aktualisieren.');
  if (branch === 'HEAD') {
    const exists = await git(repository.path, ['rev-parse', '--verify', 'HEAD']).then(
      () => true,
      () => false,
    );
    if (!exists) return { commits: [], hasMore: false };
  }
  const raw = await git(repository.path, [
    'log',
    '--date-order',
    '--max-count=101',
    `--skip=${offset}`,
    `--format=${LOG_FORMAT}`,
    '--numstat',
    '-z',
    '--find-renames',
    '--no-ext-diff',
    '--no-textconv',
    branch,
    '--',
  ]);
  const commits = parseLog(raw);
  return { commits: commits.slice(0, 100), hasMore: commits.length > 100 };
}
async function limitedPatch(
  cwd: string,
  hash: string,
): Promise<{ patch: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'git',
      [
        '-C',
        cwd,
        'show',
        '--format=',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--find-renames',
        hash,
        '--',
      ],
      { windowsHide: true, env: GIT_ENV },
    );
    const chunks: Buffer[] = [];
    let length = 0;
    let truncated = false;
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Die Diff-Anzeige hat zu lange gedauert.'));
    }, 30_000);
    child.stdout.on('data', (data: Buffer) => {
      const remaining = 512_000 - length;
      if (remaining > 0) {
        const chunk = data.subarray(0, remaining);
        chunks.push(chunk);
        length += chunk.length;
      }
      if (data.length > remaining) {
        truncated = true;
        child.kill();
      }
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code && !truncated) reject(new Error(stderr || 'Diff konnte nicht gelesen werden.'));
      else resolve({ patch: Buffer.concat(chunks).toString('utf8'), truncated });
    });
  });
}
export async function commitDetail(repository: Repository, hash: string): Promise<CommitDetail> {
  if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error('Ungültiger Commit-Hash.');
  const [log, message, patch] = await Promise.all([
    git(repository.path, [
      'log',
      '-1',
      `--format=${LOG_FORMAT}`,
      '--numstat',
      '-z',
      '--find-renames',
      '--no-ext-diff',
      '--no-textconv',
      hash,
      '--',
    ]),
    git(repository.path, ['log', '-1', '--format=%B', hash, '--']),
    limitedPatch(repository.path, hash),
  ]);
  const commit = parseLog(log)[0];
  if (!commit) throw new Error('Commit wurde nicht gefunden.');
  return { commit, message: message.trim(), ...patch };
}
