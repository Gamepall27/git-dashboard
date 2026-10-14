import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const nodeRequire = createRequire(__filename);

test('folder context menu discovers siblings, selects all or individual repositories and persists additions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'git-dashboard-discovery-ui-'));
  const parent = path.join(directory, 'projects');
  const userData = path.join(directory, 'user-data');
  let app: ElectronApplication | undefined;
  const errors: string[] = [];
  const init = async (repo: string) => {
    await mkdir(repo, { recursive: true });
    execFileSync('git', ['-C', repo, 'init', '-b', 'main'], { windowsHide: true, stdio: 'pipe' });
  };
  const launch = async () => {
    const env = { ...process.env, GIT_DASHBOARD_USER_DATA: userData };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
    app = await electron.launch({ executablePath: nodeRequire('electron'), args: ['.'], env });
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible();
    return page;
  };
  try {
    const alpha = path.join(parent, 'alpha');
    await init(alpha);
    await init(path.join(parent, 'beta'));
    await init(path.join(parent, 'gamma'));
    await init(path.join(parent, 'ordinary', 'nested-repository'));
    let page = await launch();
    await page.getByRole('button', { name: 'Lokales Repository öffnen' }).click();
    await page.getByRole('textbox', { name: 'Repository-Pfade' }).fill(alpha);
    await page.getByRole('button', { name: 'Repositories öffnen', exact: true }).click();
    await expect(page.locator('.repo-table tbody tr')).toHaveCount(1);
    const folder = page.locator('.tree-parent').filter({ hasText: 'projects' });
    await folder.click({ button: 'right' });
    await expect(
      page.getByRole('menuitem', { name: 'Auf weitere Repositories prüfen' }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await folder.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Auf weitere Repositories prüfen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Gefundene Repositories' });
    await expect(dialog.locator('.discovery-row')).toHaveCount(3);
    await expect(dialog.getByRole('checkbox', { name: 'alpha', exact: true })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'alpha', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Ausgewählte hinzufügen' })).toBeDisabled();
    await expect(dialog.getByText('nested-repository', { exact: true })).toHaveCount(0);
    await dialog.getByRole('checkbox', { name: 'Alle auswählen', exact: true }).check();
    await expect(dialog.getByRole('checkbox', { name: 'beta', exact: true })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'gamma', exact: true })).toBeChecked();
    await dialog.getByRole('checkbox', { name: 'gamma', exact: true }).uncheck();
    await expect(
      dialog.getByRole('checkbox', { name: 'Alle auswählen', exact: true }),
    ).toHaveJSProperty('indeterminate', true);
    await page.screenshot({ path: 'test-results/ui/repository-discovery.png' });
    await dialog.getByRole('button', { name: 'Ausgewählte hinzufügen' }).click();
    await expect(page.locator('.repo-table tbody tr')).toHaveCount(2);
    let saved = JSON.parse(await readFile(path.join(userData, 'workspace.json'), 'utf8'));
    expect(saved.repositories.map((repo: { name: string }) => repo.name)).toEqual([
      'alpha',
      'beta',
    ]);
    // Keyboard access and selecting all remaining repositories.
    await folder.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Auf weitere Repositories prüfen' }).click();
    await expect(dialog.getByRole('checkbox', { name: 'beta', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Alle auswählen', exact: true }).check();
    await dialog.getByRole('button', { name: 'Ausgewählte hinzufügen' }).click();
    await expect(page.locator('.repo-table tbody tr')).toHaveCount(3);
    await folder.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Auf weitere Repositories prüfen' }).click();
    await expect(
      dialog.getByText('Alle gefundenen Repositories sind bereits im Workspace geöffnet.'),
    ).toBeVisible();
    await expect(
      dialog.getByRole('checkbox', { name: 'Alle auswählen', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await app!.close();
    app = undefined;
    page = await launch();
    await expect(page.locator('.repo-table tbody tr')).toHaveCount(3);
    saved = JSON.parse(await readFile(path.join(userData, 'workspace.json'), 'utf8'));
    expect(saved.repositories).toHaveLength(3);
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
