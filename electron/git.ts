import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
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

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', '-C', cwd, ...args],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: GIT_ENV,
        timeout: 90_000,
        maxBuffer: 64 * 1024 * 1024,
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
  });
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
export async function snapshot(repository: Repository): Promise<RepoSnapshot> {
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
  };
  try {
    await git(repository.path, ['rev-parse', '--git-dir']);
    const [branch, refs, status, count, divergence] = await Promise.all([
      git(repository.path, ['symbolic-ref', '--short', 'HEAD']).catch(() =>
        git(repository.path, ['rev-parse', '--short', 'HEAD']).then(
          (s) => `detached · ${s.trim()}`,
        ),
      ),
      branches(repository.path),
      git(repository.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      git(repository.path, ['rev-list', '--all', '--count']),
      git(repository.path, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']).catch(
        () => '0\t0',
      ),
    ]);
    const totalCommits = Number(count.trim());
    const commits = totalCommits
      ? parseLog(
          await git(repository.path, [
            'log',
            '--all',
            '--date-order',
            `--max-count=${MAX_STATS_COMMITS + 1}`,
            `--format=${LOG_FORMAT}`,
            '--numstat',
            '-z',
            '--find-renames',
            '--no-ext-diff',
            '--no-textconv',
          ]),
        )
      : [];
    const [ahead, behind] = divergence.trim().split(/\s+/).map(Number);
    return {
      ...empty,
      branch: branch.trim(),
      branches: refs,
      workingFiles: parseStatus(status),
      totalCommits,
      commits: commits.slice(0, MAX_STATS_COMMITS),
      truncated: commits.length > MAX_STATS_COMMITS,
      ahead,
      behind,
    };
  } catch (error) {
    return { ...empty, error: (error as Error).message };
  }
}
export async function allSnapshots(repositories: Repository[]): Promise<RepoSnapshot[]> {
  const output: RepoSnapshot[] = new Array(repositories.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, repositories.length) }, async () => {
      while (cursor < repositories.length) {
        const index = cursor++;
        output[index] = await snapshot(repositories[index]);
      }
    }),
  );
  return output;
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
