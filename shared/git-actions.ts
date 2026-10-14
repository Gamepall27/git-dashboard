import type { Branch, WorkingFile } from './types';

export type GitOperationKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert';
export interface GitActionContext {
  branch: string;
  head: string;
  upstream: string;
  branches: Branch[];
  remotes: { name: string; url: string }[];
  tags: string[];
  stashes: { ref: string; hash: string; subject: string }[];
  files: WorkingFile[];
  operation?: GitOperationKind;
  identity: { name: string; email: string };
}
export type GitAction =
  | { type: 'stage' | 'unstage' | 'discard' | 'ours' | 'theirs'; paths: string[] }
  | { type: 'stageAll' | 'unstageAll' | 'fetch' | 'continue' | 'abort' }
  | { type: 'commit'; message: string; amend?: boolean }
  | { type: 'push'; remote?: string; branch?: string; force?: boolean }
  | { type: 'pull'; mode: 'ff-only' | 'rebase' | 'merge'; remote?: string; branch?: string }
  | {
      type: 'switch' | 'merge' | 'rebase' | 'branchDelete' | 'tagDelete' | 'cherryPick' | 'revert';
      ref: string;
    }
  | { type: 'branchCreate'; name: string; start?: string }
  | { type: 'branchRename'; name: string }
  | { type: 'stashSave'; message?: string; includeUntracked?: boolean }
  | { type: 'stashApply' | 'stashPop' | 'stashDrop'; ref: string }
  | { type: 'reset'; ref: string; mode: 'soft' | 'mixed' | 'hard' }
  | { type: 'tagCreate'; name: string; ref?: string; message?: string }
  | { type: 'remoteAdd'; name: string; url: string }
  | { type: 'remoteRemove'; name: string }
  | { type: 'identity'; name: string; email: string }
  | { type: 'custom'; command: string };
export interface GitActionPlan {
  token: string;
  label: string;
  command: string;
  repositoryPath: string;
  requiresConfirmation: boolean;
  warning?: string;
  paths?: string[];
}
export interface GitOperationResult {
  success: boolean;
  command: string;
  output: string;
  exitCode: number | null;
  canceled: boolean;
  truncated: boolean;
}
export interface GitOperationOutput {
  requestId: string;
  repositoryId: string;
  text: string;
}
export type RepositoryCreation =
  { type: 'clone'; url: string; path: string } | { type: 'init'; path: string; branch: string };

export function parseGitCommand(input: string): string[] {
  if (typeof input !== 'string' || input.length > 32_000 || input.includes('\0'))
    throw new Error('Ungültiger Git-Befehl.');
  const args: string[] = [];
  let value = '';
  let quote = '';
  let started = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quote) {
      if (char === quote) quote = '';
      else if (char === '\\' && quote === '"' && ['"', '\\'].includes(input[i + 1]))
        value += input[++i];
      else value += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === '\\' && /[\s'"\\]/.test(input[i + 1] ?? '')) {
      value += input[++i];
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(value);
        value = '';
        started = false;
      }
    } else if (';&|<>'.includes(char))
      throw new Error(
        'Shell-Operatoren sind hier nicht unterstützt. Bitte nur einen Git-Befehl eingeben.',
      );
    else {
      value += char;
      started = true;
    }
  }
  if (quote) throw new Error('Ein Anführungszeichen wurde nicht geschlossen.');
  if (started) args.push(value);
  if (args[0] === 'git') args.shift();
  if (!args.length || !/^[a-z][a-z0-9-]*$/.test(args[0]) || args.length > 200)
    throw new Error(
      'Bitte einen Git-Unterbefehl eingeben, z. B. „git status“. Globale Optionen vor dem Unterbefehl sind nicht unterstützt.',
    );
  const interactive = ['add', 'reset', 'restore', 'checkout', 'stash'].includes(args[0])
    ? ['--interactive', '-i', '--patch', '-p']
    : args[0] === 'rebase'
      ? ['--interactive', '-i', '--edit-todo']
      : ['--edit', '-e'];
  if (
    args.some((arg) => interactive.includes(arg)) ||
    ['mergetool', 'difftool', 'credential'].includes(args[0])
  )
    throw new Error(
      'Dieser Befehl benötigt ein interaktives Terminal. Bitte „Terminal öffnen“ verwenden.',
    );
  return args;
}
export function formatGitCommand(args: string[]) {
  return `git ${args.map((arg) => (/^[a-zA-Z0-9_./:@{}=+-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(' ')}`;
}
export function isConflict(file: WorkingFile) {
  return (
    file.index === 'U' || file.working === 'U' || ['AA', 'DD'].includes(file.index + file.working)
  );
}
export function isStaged(file: WorkingFile) {
  return file.index !== ' ' && file.index !== '?' && !isConflict(file);
}
export function isUnstaged(file: WorkingFile) {
  return file.working !== ' ' || file.index === '?' || isConflict(file);
}
