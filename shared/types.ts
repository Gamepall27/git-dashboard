export type ModuleType =
  'authors' | 'repositories' | 'timeline' | 'heatmap' | 'hotspots' | 'weekdays' | 'workingTree';
export type Period = 7 | 30 | 90 | 365 | 0;
export interface ModuleConfig {
  id: string;
  type: ModuleType;
  title: string;
  repoIds: string[];
  period: Period;
}
export interface Repository {
  id: string;
  path: string;
  name: string;
}
export interface DiscoveredRepository extends Repository {
  alreadyOpen: boolean;
}
export interface RepositoryScan {
  parentPath: string;
  repositories: DiscoveredRepository[];
  warnings: { path: string; error: string }[];
}
export interface Settings {
  theme: 'dark' | 'light' | 'system';
  modules: ModuleConfig[];
  repoModules: Record<string, ModuleConfig[]>;
}
export interface Workspace {
  repositories: Repository[];
  settings: Settings;
}
export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}
export interface Commit {
  statsLoaded?: boolean;
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  parents: string[];
  refs: string;
  additions: number;
  deletions: number;
  files: FileChange[];
}
export interface WorkingFile {
  path: string;
  index: string;
  working: string;
  originalPath?: string;
}
export interface Branch {
  name: string;
  ref: string;
  current: boolean;
  remote: boolean;
}
export interface RepoSnapshot {
  historyVersion?: string;
  statisticsComplete?: boolean;
  statisticsError?: string;
  recentCommits?: Commit[];
  repository: Repository;
  branch: string;
  branches: Branch[];
  commits: Commit[];
  workingFiles: WorkingFile[];
  ahead: number;
  behind: number;
  totalCommits: number;
  truncated: boolean;
  error?: string;
  updatedAt: string;
}
export interface HistoryPage {
  commits: Commit[];
  hasMore: boolean;
}
export interface CommitDetail {
  commit: Commit;
  message: string;
  patch: string;
  truncated: boolean;
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export interface RepositoryLoadOptions {
  ids?: string[];
  priorityId?: string;
  known: Record<string, { version: string; count: number; complete: boolean }>;
}
export type RepositoryLoadEvent =
  | { type: 'summary'; requestId: string; snapshot: RepoSnapshot; preserveStatistics: boolean }
  | {
      type: 'commits';
      requestId: string;
      repositoryId: string;
      commits: Commit[];
      complete: boolean;
      truncated: boolean;
      error?: string;
    }
  | {
      type: 'progress';
      requestId: string;
      phase: 'summaries' | 'statistics';
      completed: number;
      total: number;
      currentId?: string;
    }
  | { type: 'complete'; requestId: string }
  | { type: 'error'; requestId: string; error: string };
export interface DashboardAPI {
  platform: string;
  loadWorkspace(): Promise<Result<Workspace>>;
  addRepositories(paths?: string[]): Promise<Result<Workspace>>;
  scanParentRepositories(repositoryId: string): Promise<Result<RepositoryScan>>;
  removeRepository(id: string): Promise<Result<Workspace>>;
  saveSettings(settings: Settings): Promise<Result<Settings>>;
  startRepositoryLoad(requestId: string, options: RepositoryLoadOptions): Promise<Result<void>>;
  cancelRepositoryLoad(requestId: string): Promise<Result<void>>;
  prioritizeRepositoryLoad(repositoryId: string): Promise<Result<void>>;
  onRepositoryLoad(listener: (event: RepositoryLoadEvent) => void): () => void;
  history(id: string, branch: string, offset: number): Promise<Result<HistoryPage>>;
  commitDetail(id: string, hash: string): Promise<Result<CommitDetail>>;
  revealRepository(id: string): Promise<Result<void>>;
  copyText(text: string): Promise<Result<void>>;
  gitContext(id: string): Promise<Result<import('./git-actions').GitActionContext>>;
  prepareGitAction(
    id: string,
    action: import('./git-actions').GitAction,
  ): Promise<Result<import('./git-actions').GitActionPlan>>;
  executeGitAction(
    id: string,
    token: string,
    requestId: string,
    confirmed: boolean,
  ): Promise<Result<import('./git-actions').GitOperationResult>>;
  cancelGitOperation(requestId: string): Promise<Result<void>>;
  onGitOutput(listener: (event: import('./git-actions').GitOperationOutput) => void): () => void;
  openTerminal(id: string): Promise<Result<void>>;
  chooseDirectory(): Promise<Result<string | null>>;
  createRepository(
    requestId: string,
    input: import('./git-actions').RepositoryCreation,
  ): Promise<Result<{ workspace: Workspace; result: import('./git-actions').GitOperationResult }>>;
}

export const MODULE_TYPES: Record<ModuleType, { title: string; description: string }> = {
  authors: {
    title: 'Beiträge nach Autor',
    description: 'Hinzugefügte und entfernte Zeilen pro Person, mit Commit-Anzahl.',
  },
  repositories: {
    title: 'Repository-Aktivität',
    description: 'Welche Repositories im gewählten Zeitraum am häufigsten geändert wurden.',
  },
  timeline: {
    title: 'Aktivität im Zeitverlauf',
    description: 'Commits pro Tag und ihre Verteilung über den Zeitraum.',
  },
  heatmap: {
    title: 'Aktivitätskalender',
    description: 'Die letzten 13 Wochen als Kalender. Ein Feld entspricht einem Tag.',
  },
  hotspots: {
    title: 'Datei-Hotspots',
    description: 'Dateien mit den meisten Änderungen und geänderten Zeilen.',
  },
  weekdays: {
    title: 'Commits nach Wochentag',
    description: 'An welchen Wochentagen die ausgewählten Repositories aktiv sind.',
  },
  workingTree: {
    title: 'Arbeitsverzeichnisse',
    description: 'Lokale Änderungen, Staging, neue Dateien und Konflikte auf einen Blick.',
  },
};
export const PERIODS: { value: Period; label: string }[] = [
  { value: 7, label: '7 Tage' },
  { value: 30, label: '30 Tage' },
  { value: 90, label: '90 Tage' },
  { value: 365, label: '1 Jahr' },
  { value: 0, label: 'Gesamte Historie' },
];
export function defaultModules(repoId?: string): ModuleConfig[] {
  const types: ModuleType[] = repoId
    ? ['authors', 'timeline', 'hotspots', 'weekdays']
    : ['authors', 'repositories', 'timeline', 'heatmap'];
  return types.map((type, i) => ({
    id: `default-${repoId ?? 'home'}-${i}`,
    type,
    title: MODULE_TYPES[type].title,
    repoIds: repoId ? [repoId] : [],
    period: type === 'heatmap' ? 90 : 30,
  }));
}
export function defaultSettings(): Settings {
  return { theme: 'dark', modules: defaultModules(), repoModules: {} };
}
