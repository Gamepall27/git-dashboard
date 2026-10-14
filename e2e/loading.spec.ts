import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { RepositoryLoadEvent } from '../shared/types';
import { createHistory } from '../tests/support/history';
const nodeRequire = createRequire(__filename);

test('loads many repositories in pages, reuses unchanged data and preserves an expanded history', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'git-dashboard-streaming-'));
  let app: ElectronApplication | undefined;
  try {
    const repositories = Array.from({ length: 8 }, (_, i) => path.join(directory, `repo-${i}`));
    for (let i = 0; i < repositories.length; i++)
      await createHistory(repositories[i], i < 2 ? 315 : 5);
    const extra = path.join(directory, 'extra');
    await createHistory(extra, 5);
    const env = { ...process.env, GIT_DASHBOARD_USER_DATA: path.join(directory, 'user-data') };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
    app = await electron.launch({ executablePath: nodeRequire('electron'), args: ['.'], env });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByText('Dein Workspace beginnt mit einem Repository')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Alle Repositories aktualisieren', exact: true }),
    ).toBeEnabled();
    await page.evaluate(() => {
      (window as any).__loadEvents = [];
      window.gitDashboard!.onRepositoryLoad((event) => (window as any).__loadEvents.push(event));
    });
    const events = () => page.evaluate(() => (window as any).__loadEvents as RepositoryLoadEvent[]);
    await page.getByRole('button', { name: 'Lokales Repository öffnen' }).click();
    await page.getByRole('textbox', { name: 'Repository-Pfade' }).fill(repositories.join('\n'));
    await page.getByRole('button', { name: 'Repositories öffnen', exact: true }).click();
    await expect(page.locator('.repo-table tbody tr')).toHaveCount(8);
    await expect
      .poll(async () => (await events()).some((event) => event.type === 'complete'))
      .toBe(true);
    await expect(page.getByRole('status', { name: 'Repository-Ladefortschritt' })).toHaveCount(0);
    const initial = await events();
    const summaries = initial.filter((event) => event.type === 'summary');
    const pages = initial.filter((event) => event.type === 'commits');
    expect(summaries).toHaveLength(8);
    expect(pages.every((event) => event.type === 'commits' && event.commits.length <= 250)).toBe(
      true,
    );
    expect(
      pages.filter((event) => event.type === 'commits' && event.commits.length === 250),
    ).toHaveLength(2);
    expect(initial.findIndex((event) => event.type === 'summary')).toBeLessThan(
      initial.findIndex((event) => event.type === 'commits'),
    );
    expect(
      pages.reduce((sum, event) => sum + (event.type === 'commits' ? event.commits.length : 0), 0),
    ).toBe(660);

    await page.getByRole('button', { name: 'repo-0', exact: true }).click();
    await expect(page.locator('.history-row')).toHaveCount(100);
    await page.getByRole('button', { name: 'Weitere 100 Commits laden' }).click();
    await expect(page.locator('.history-row')).toHaveCount(200);
    await page.evaluate(() => {
      (window as any).__loadEvents = [];
    });
    await page
      .getByRole('button', { name: 'Alle Repositories aktualisieren', exact: true })
      .click();
    await expect
      .poll(async () => (await events()).some((event) => event.type === 'complete'))
      .toBe(true);
    const cached = await events();
    expect(cached.filter((event) => event.type === 'commits')).toHaveLength(0);
    expect(
      cached
        .filter((event) => event.type === 'summary')
        .every((event) => event.type === 'summary' && event.preserveStatistics),
    ).toBe(true);
    await expect(page.locator('.history-row')).toHaveCount(200);
    await page.getByRole('tab', { name: 'Übersicht', exact: true }).click();
    await page.evaluate(() => {
      (window as any).__loadEvents = [];
    });
    await page.getByRole('button', { name: 'Repository öffnen', exact: true }).last().click();
    await page.getByRole('textbox', { name: 'Repository-Pfade' }).fill(extra);
    await page.getByRole('button', { name: 'Repositories öffnen', exact: true }).click();
    await expect(page.locator('.repo-table tbody tr')).toHaveCount(9);
    await expect
      .poll(async () => (await events()).some((event) => event.type === 'complete'))
      .toBe(true);
    expect((await events()).filter((event) => event.type === 'summary')).toHaveLength(1);
    await page.screenshot({ path: 'test-results/ui/many-repositories.png' });
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
