import { BrowserWindow, dialog } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { GitOperationResult } from '../shared/git-actions';
import {
  creationCommand,
  executeCommand,
  gitContext,
  prepareAction,
  repositoryLockKey,
  validatePlan,
  type PreparedAction,
} from './git-actions';
import { inspectRepository } from './git';
import { WorkspaceStore } from './store';
import { openTerminal } from './terminal';

type Handle = <T>(
  channel: string,
  callback: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T,
) => void;
export function registerGitIPC(
  store: WorkspaceStore,
  handle: Handle,
  invalidate: (id: string) => void,
) {
  const plans = new Map<
    string,
    { owner: number; id: string; created: number; plan: PreparedAction }
  >();
  const running = new Map<string, { owner: number; controller: AbortController }>();
  const locks = new Set<string>();
  const owners = new Set<number>();
  function watch(event: IpcMainInvokeEvent) {
    if (owners.has(event.sender.id)) return;
    const owner = event.sender.id;
    owners.add(owner);
    event.sender.once('destroyed', () => {
      for (const job of running.values()) if (job.owner === owner) job.controller.abort();
      for (const [token, plan] of plans) if (plan.owner === owner) plans.delete(token);
      owners.delete(owner);
    });
  }
  async function run(
    event: IpcMainInvokeEvent,
    requestId: unknown,
    id: string,
    key: string,
    commands: string[][],
    input?: string,
    before?: () => Promise<void>,
  ) {
    if (
      typeof requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(requestId) ||
      running.has(requestId)
    )
      throw new Error('Ungültige oder bereits aktive Git-Anforderung.');
    if (locks.has(key)) throw new Error('In diesem Repository läuft bereits eine Git-Aktion.');
    watch(event);
    const controller = new AbortController();
    locks.add(key);
    running.set(requestId, { owner: event.sender.id, controller });
    let output = '';
    const send = (text: string) => {
      const part = text.slice(0, Math.max(0, 512_000 - output.length));
      output += part;
      if (part && !event.sender.isDestroyed())
        event.sender.send('git:output', { requestId, repositoryId: id, text: part });
    };
    try {
      await before?.();
      let result: GitOperationResult | undefined;
      for (const args of commands) {
        result = await executeCommand(
          id === 'creation' ? key : store.find(id).path,
          args,
          input,
          send,
          controller.signal,
        );
        if (!result.success) break;
      }
      return { ...result!, output };
    } finally {
      running.delete(requestId);
      locks.delete(key);
      if (id !== 'creation') invalidate(id);
    }
  }
  handle('git:context', (_, id: string) => gitContext(store.find(id)));
  handle('git:prepare', async (event, id: string, action: unknown) => {
    watch(event);
    for (const [token, value] of plans)
      if (Date.now() - value.created > 300_000) plans.delete(token);
    if (plans.size >= 100) throw new Error('Zu viele vorbereitete Aktionen. Bitte kurz warten.');
    const plan = await prepareAction(store.find(id), action);
    plans.set(plan.public.token, { owner: event.sender.id, id, created: Date.now(), plan });
    return plan.public;
  });
  handle(
    'git:execute',
    async (event, id: string, token: string, requestId: unknown, confirmed: unknown) => {
      const prepared = plans.get(token);
      if (
        !prepared ||
        prepared.id !== id ||
        prepared.owner !== event.sender.id ||
        Date.now() - prepared.created > 300_000
      )
        throw new Error('Die Git-Aktion ist abgelaufen. Bitte erneut öffnen.');
      if (prepared.plan.public.requiresConfirmation && confirmed !== true)
        throw new Error('Diese Aktion muss zuerst bestätigt werden.');
      plans.delete(token);
      const repository = store.find(id);
      const key = await repositoryLockKey(repository);
      return run(event, requestId, id, key, prepared.plan.commands, prepared.plan.input, () =>
        validatePlan(repository, prepared.plan),
      );
    },
  );
  handle('git:cancel', (event, requestId: string) => {
    const job = running.get(requestId);
    if (job?.owner === event.sender.id) job.controller.abort();
  });
  handle('git:terminal', (_, id: string) => openTerminal(store.find(id).path));
  handle('git:choose-directory', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Zielordner auswählen',
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0];
  });
  handle('git:create', async (event, requestId: string, input: unknown) => {
    const command = await creationCommand(input);
    // Canonicalize the existing parent so aliases cannot bypass the destination lock.
    const parent = await realpath(command.cwd);
    const key = path.join(parent, path.basename(command.destination));
    const lockKey = process.platform === 'win32' ? key.toLowerCase() : key;
    if (locks.has(lockKey)) throw new Error('Dieser Zielordner wird bereits verwendet.');
    locks.add(lockKey);
    try {
      // Creation runs in the existing parent; reserve it too, conservatively.
      const result = await run(event, requestId, 'creation', parent, [command.args]);
      const workspace = result.success
        ? await store.add([await inspectRepository(command.destination)])
        : store.read();
      return { workspace, result };
    } finally {
      locks.delete(lockKey);
    }
  });
}
