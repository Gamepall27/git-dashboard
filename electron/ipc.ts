import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Result } from '../shared/types';
import { allSnapshots, commitDetail, history, inspectRepository } from './git';
import { WorkspaceStore } from './store';

export function registerIPC(store: WorkspaceStore) {
  function trusted(event: IpcMainInvokeEvent) {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('Unzulässiger Aufruf.');
    const url = event.senderFrame.url;
    const dev = process.env.VITE_DEV_SERVER_URL;
    const allowedFile = path.resolve(__dirname, '../../dist/index.html');
    if (url.startsWith('file:') && fileURLToPath(url) === allowedFile) return;
    if (dev && url.startsWith(`${dev}/`)) return;
    throw new Error('Unzulässiger Ursprung.');
  }
  function handle<T>(channel: string, callback: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T) {
    ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
      try { trusted(event); return { ok: true, data: await callback(event, ...args) }; }
      catch (error) { return { ok: false, error: (error as Error).message }; }
    });
  }
  handle('workspace:load', () => store.read());
  handle('workspace:add', async (event, paths?: unknown) => {
    let selected: string[];
    if (paths === undefined) {
      const parent = BrowserWindow.fromWebContents(event.sender);
      const options = { title: 'Git-Repositories öffnen', properties: ['openDirectory', 'multiSelections'] as ('openDirectory' | 'multiSelections')[] };
      const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      if (result.canceled) return store.read();
      selected = result.filePaths;
    } else {
      if (!Array.isArray(paths) || paths.length < 1 || paths.length > 200 || !paths.every(p => typeof p === 'string' && p.length > 0 && p.length < 4096)) throw new Error('Ungültige Repository-Pfade.');
      selected = paths as string[];
    }
    const inspected = [];
    for (const item of selected) inspected.push(await inspectRepository(item));
    return store.add(inspected);
  });
  handle('workspace:remove', (_, id: string) => store.remove(id));
  handle('settings:save', async (_, settings: unknown) => (await store.saveSettings(settings)).settings);
  handle('repos:snapshots', () => allSnapshots(store.read().repositories));
  handle('repo:history', (_, id: string, branch: string, offset: number) => history(store.find(id), branch, offset));
  handle('repo:commit', (_, id: string, hash: string) => commitDetail(store.find(id), hash));
  handle('repo:reveal', async (_, id: string) => { shell.showItemInFolder(store.find(id).path); });
  handle('clipboard:copy', (_, text: unknown) => {
    if (typeof text !== 'string' || text.length > 100_000) throw new Error('Ungültiger Text.');
    clipboard.writeText(text);
  });
}
