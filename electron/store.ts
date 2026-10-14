import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  defaultSettings,
  MODULE_TYPES,
  PERIODS,
  type ModuleConfig,
  type Repository,
  type Settings,
  type Workspace,
} from '../shared/types';

function validateModules(input: unknown): ModuleConfig[] {
  if (!Array.isArray(input) || input.length > 50) throw new Error('Ungültige Modulliste.');
  const ids = new Set<string>();
  return input.map((m) => {
    if (
      !m ||
      typeof m.id !== 'string' ||
      m.id.length > 120 ||
      ids.has(m.id) ||
      !Object.hasOwn(MODULE_TYPES, m.type) ||
      typeof m.title !== 'string' ||
      !m.title.trim() ||
      m.title.length > 100 ||
      !PERIODS.some((p) => p.value === m.period) ||
      !Array.isArray(m.repoIds) ||
      m.repoIds.length > 200 ||
      !m.repoIds.every((id: unknown) => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id))
    )
      throw new Error('Ungültige Modulkonfiguration.');
    ids.add(m.id);
    return {
      id: m.id,
      type: m.type,
      title: m.title.trim(),
      repoIds: [...new Set<string>(m.repoIds)],
      period: m.period,
    };
  });
}
export function validateSettings(input: unknown): Settings {
  const s = input as Settings;
  if (
    !s ||
    !['dark', 'light', 'system'].includes(s.theme) ||
    !s.repoModules ||
    typeof s.repoModules !== 'object' ||
    Array.isArray(s.repoModules) ||
    Object.keys(s.repoModules).length > 200
  )
    throw new Error('Ungültige Einstellungen.');
  const repoModules: Record<string, ModuleConfig[]> = {};
  for (const [id, modules] of Object.entries(s.repoModules)) {
    if (!/^[a-f0-9]{16}$/.test(id)) throw new Error('Ungültige Repository-ID.');
    repoModules[id] = validateModules(modules);
  }
  return { theme: s.theme, modules: validateModules(s.modules), repoModules };
}
export class WorkspaceStore {
  private workspace: Workspace = { repositories: [], settings: defaultSettings() };
  private queue: Promise<void> = Promise.resolve();
  private readonly file: string;
  constructor(directory: string) {
    this.file = path.join(directory, 'workspace.json');
  }
  async load(): Promise<Workspace> {
    try {
      const input = JSON.parse(await readFile(this.file, 'utf8')) as Workspace;
      if (
        !Array.isArray(input.repositories) ||
        input.repositories.length > 200 ||
        !input.repositories.every(
          (r) =>
            r &&
            /^[a-f0-9]{16}$/.test(r.id) &&
            typeof r.name === 'string' &&
            typeof r.path === 'string' &&
            path.isAbsolute(r.path),
        )
      )
        throw new Error('Ungültige Repository-Liste.');
      this.workspace = {
        repositories: input.repositories,
        settings: validateSettings(input.settings),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          `Workspace konnte nicht geladen werden (${this.file}): ${(error as Error).message}`,
        );
    }
    return this.read();
  }
  read(): Workspace {
    return structuredClone(this.workspace);
  }
  find(id: string): Repository {
    const repo = this.workspace.repositories.find((r) => r.id === id);
    if (!repo) throw new Error('Repository ist nicht geöffnet.');
    return { ...repo };
  }
  private update(change: (workspace: Workspace) => void): Promise<Workspace> {
    const task = this.queue.then(async () => {
      const next = this.read();
      change(next);
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(next, null, 2), 'utf8');
      await rename(`${this.file}.tmp`, this.file);
      this.workspace = next;
    });
    this.queue = task.catch(() => {});
    return task.then(() => this.read());
  }
  add(repositories: Repository[]): Promise<Workspace> {
    return this.update((w) => {
      for (const repo of repositories)
        if (!w.repositories.some((r) => r.id === repo.id)) w.repositories.push(repo);
      if (w.repositories.length > 200)
        throw new Error('Es können maximal 200 Repositories geöffnet werden.');
    });
  }
  remove(id: string): Promise<Workspace> {
    this.find(id);
    return this.update((w) => {
      w.repositories = w.repositories.filter((r) => r.id !== id);
      delete w.settings.repoModules[id];
      const prune = (modules: ModuleConfig[]) =>
        modules
          .filter((m) => !(m.repoIds.length === 1 && m.repoIds[0] === id))
          .map((m) => ({ ...m, repoIds: m.repoIds.filter((r) => r !== id) }));
      w.settings.modules = prune(w.settings.modules);
      for (const key of Object.keys(w.settings.repoModules))
        w.settings.repoModules[key] = prune(w.settings.repoModules[key]);
    });
  }
  saveSettings(settings: unknown): Promise<Workspace> {
    const valid = validateSettings(settings);
    return this.update((w) => {
      w.settings = valid;
    });
  }
}
