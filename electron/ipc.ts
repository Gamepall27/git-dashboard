import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { RepositoryLoadEvent, RepositoryLoadOptions, Result } from '../shared/types';
import { MAX_STATS_COMMITS, commitDetail, history, inspectRepository } from './git';
import { WorkspaceStore } from './store';
import { scanRepositories } from './discovery';
import { RepositoryLoader } from './repository-loader';
import { registerGitIPC } from './git-ipc';

export function registerIPC(store: WorkspaceStore) {
  const loads = new Map<
    number,
    { loader: RepositoryLoader; controller?: AbortController; requestId?: string }
  >();
  function trusted(event: IpcMainInvokeEvent) {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Unzulässiger Aufruf.');
    const url = event.senderFrame.url;
    const dev = process.env.VITE_DEV_SERVER_URL;
    const allowedFile = path.resolve(__dirname, '../../dist/index.html');
    if (url.startsWith('file:') && fileURLToPath(url) === allowedFile) return;
    if (!app.isPackaged && dev && url.startsWith(`${dev}/`)) return;
    throw new Error('Unzulässiger Ursprung.');
  }
  function handle<T>(
    channel: string,
    callback: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T,
  ) {
    ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
      try {
        trusted(event);
        return { ok: true, data: await callback(event, ...args) };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    });
  }
  registerGitIPC(store, handle, (id) => {
    for (const load of loads.values()) load.loader.forget(id);
  });
  handle('workspace:load', () => store.read());
  handle('workspace:add', async (event, paths?: unknown) => {
    let selected: string[];
    if (paths === undefined) {
      const parent = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: 'Git-Repositories öffnen',
        properties: ['openDirectory', 'multiSelections'] as ('openDirectory' | 'multiSelections')[],
      };
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled) return store.read();
      selected = result.filePaths;
    } else {
      if (
        !Array.isArray(paths) ||
        paths.length < 1 ||
        paths.length > 200 ||
        !paths.every((p) => typeof p === 'string' && p.length > 0 && p.length < 4096)
      )
        throw new Error('Ungültige Repository-Pfade.');
      selected = paths as string[];
    }
    const inspected = new Array<Awaited<ReturnType<typeof inspectRepository>>>(selected.length);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, selected.length) }, async () => {
        while (cursor < selected.length) {
          const index = cursor++;
          inspected[index] = await inspectRepository(selected[index]);
        }
      }),
    );
    return store.add(inspected);
  });
  handle('workspace:remove', async (_, id: string) => {
    const workspace = await store.remove(id);
    for (const load of loads.values()) load.loader.forget(id);
    return workspace;
  });
  handle('repos:scan-parent', (_, id: string) => {
    const repository = store.find(id);
    return scanRepositories(path.dirname(repository.path), store.read().repositories);
  });
  handle(
    'settings:save',
    async (_, settings: unknown) => (await store.saveSettings(settings)).settings,
  );
  handle('repos:load', (event, requestId: unknown, input: unknown) => {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(requestId))
      throw new Error('Ungültige Ladeanforderung.');
    const options = input as RepositoryLoadOptions;
    const isId = (id: unknown) => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id);
    if (
      !options ||
      typeof options !== 'object' ||
      !options.known ||
      typeof options.known !== 'object' ||
      Array.isArray(options.known) ||
      Object.keys(options.known).length > 200 ||
      (options.ids !== undefined &&
        (!Array.isArray(options.ids) || options.ids.length > 200 || !options.ids.every(isId))) ||
      (options.priorityId !== undefined && !isId(options.priorityId))
    )
      throw new Error('Ungültige Ladeoptionen.');
    for (const [id, known] of Object.entries(options.known))
      if (
        !isId(id) ||
        !known ||
        !/^[a-f0-9]{64}$/.test(known.version) ||
        !Number.isInteger(known.count) ||
        known.count < 0 ||
        known.count > MAX_STATS_COMMITS ||
        typeof known.complete !== 'boolean'
      )
        throw new Error('Ungültiger Historienstand.');
    const repositories = options.ids
      ? [...new Set(options.ids)].map((id) => store.find(id))
      : store.read().repositories;
    let load = loads.get(event.sender.id);
    if (!load) {
      load = { loader: new RepositoryLoader() };
      loads.set(event.sender.id, load);
      const session = load;
      event.sender.once('destroyed', () => {
        session.controller?.abort();
        loads.delete(event.sender.id);
      });
    }
    load.controller?.abort();
    const controller = new AbortController();
    load.controller = controller;
    load.requestId = requestId;
    const session = load;
    const send = (update: RepositoryLoadEvent) => {
      if (!controller.signal.aborted && !event.sender.isDestroyed())
        event.sender.send('repos:load-event', update);
    };
    void load.loader
      .load(repositories, requestId, options, send, controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted)
          send({ type: 'error', requestId, error: (error as Error).message });
      })
      .finally(() => {
        if (session.controller === controller) session.controller = undefined;
      });
  });
  handle('repos:cancel-load', (event, requestId: string) => {
    const session = loads.get(event.sender.id);
    if (session?.requestId === requestId) session.controller?.abort();
  });
  handle('repos:prioritize', (event, id: string) => {
    store.find(id);
    loads.get(event.sender.id)?.loader.prioritize(id);
  });
  handle('repo:history', (_, id: string, branch: string, offset: number) =>
    history(store.find(id), branch, offset),
  );
  handle('repo:commit', (_, id: string, hash: string) => commitDetail(store.find(id), hash));
  handle('repo:reveal', async (_, id: string) => {
    shell.showItemInFolder(store.find(id).path);
  });
  handle('clipboard:copy', (_, text: unknown) => {
    if (typeof text !== 'string' || text.length > 100_000) throw new Error('Ungültiger Text.');
    clipboard.writeText(text);
  });
}
