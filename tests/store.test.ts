import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore, validateSettings } from '../electron/store';
import { defaultSettings } from '../shared/types';
it('persists serialized changes, deduplicates repositories, and prunes removed scopes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'git-dashboard-store-'));
  try {
    const store = new WorkspaceStore(directory); await store.load();
    const repository = { id: 'a'.repeat(16), name: 'example', path: path.join(directory, 'repo') };
    await Promise.all([store.add([repository]), store.add([repository])]);
    expect(store.read().repositories).toHaveLength(1);
    const settings = defaultSettings(); settings.modules[0].repoIds = [repository.id]; await store.saveSettings(settings);
    const restored = new WorkspaceStore(directory); expect((await restored.load()).settings.modules[0].repoIds).toEqual([repository.id]);
    await restored.remove(repository.id); expect(restored.read().settings.modules.some(m => m.id === settings.modules[0].id)).toBe(false);
    expect(() => validateSettings({ ...settings, theme: 'invalid' })).toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
