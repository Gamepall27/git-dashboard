import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const nodeRequire = createRequire(__filename);

test('staging, commits, push, branch actions, confirmations and repository creation', async () => {
  // Windows runners may expose TEMP through an 8.3 alias; the app canonicalizes paths.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'git-dashboard-actions-e2e-')));
  let app: ElectronApplication | undefined;
  const cwd = path.join(root, 'action-workspace');
  const bare = path.join(root, 'remote.git');
  const run = (directory: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'core.quotepath=false', '-C', directory, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: 'pipe',
    });
  try {
    await mkdir(cwd);
    await mkdir(bare);
    run(cwd, 'init', '-b', 'main');
    run(cwd, 'config', 'user.name', 'UI Tester');
    run(cwd, 'config', 'user.email', 'ui@example.test');
    run(cwd, 'config', 'core.autocrlf', 'false');
    await writeFile(path.join(cwd, 'tracked.txt'), 'initial\n');
    run(cwd, 'add', '.');
    run(cwd, 'commit', '-m', 'Initial');
    await writeFile(path.join(cwd, 'tracked.txt'), 'modified\n');
    await writeFile(path.join(cwd, 'new ü.txt'), 'new\n');
    run(bare, 'init', '--bare', '-b', 'main');
    run(cwd, 'remote', 'add', 'origin', bare);
    const env = { ...process.env, GIT_DASHBOARD_USER_DATA: path.join(root, 'user-data') };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
    app = await electron.launch({ executablePath: nodeRequire('electron'), args: ['.'], env });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000),
    );
    await page.getByRole('button', { name: 'Lokales Repository öffnen' }).click();
    await page.getByLabel('Repository-Pfade').fill(cwd);
    await page.getByRole('button', { name: 'Repositories öffnen', exact: true }).click();
    await expect(page.locator('.repo-table tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: 'action-workspace', exact: true }).click();
    await page.getByRole('button', { name: '2 lokale Änderungen' }).click();
    await expect(page.getByRole('button', { name: 'Alles stagen', exact: true })).toBeEnabled();
    await page.screenshot({ path: 'test-results/ui/git-workbench-dark.png' });
    const closeOutput = async () => {
      const dialog = page.getByRole('dialog', { name: 'Git-Ausgabe', exact: true });
      await expect(dialog.getByText('Erfolgreich', { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
    };
    await page.getByRole('checkbox', { name: 'Nicht gestagt: new ü.txt', exact: true }).check();
    await page.getByRole('button', { name: 'Auswahl stagen', exact: true }).click();
    await closeOutput();
    expect(run(cwd, 'diff', '--cached', '--name-only').trim()).toBe('new ü.txt');
    await expect(
      page.getByRole('checkbox', { name: 'Gestagt: new ü.txt', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Commit-Nachricht', { exact: true }).fill('Commit from dashboard');
    await page.getByRole('button', { name: 'Commit erstellen', exact: true }).click();
    await closeOutput();
    await expect(page.locator('.history-row').first()).toContainText('Commit from dashboard');
    expect(run(cwd, 'log', '-1', '--format=%s').trim()).toBe('Commit from dashboard');
    expect(await readFile(path.join(cwd, 'tracked.txt'), 'utf8')).toBe('modified\n');
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await expect(page.getByLabel('Zielbranch', { exact: true })).toHaveValue('main');
    await page.getByRole('button', { name: 'Ausführen', exact: true }).click();
    await closeOutput();
    expect(run(bare, 'log', '-1', '--format=%s').trim()).toBe('Commit from dashboard');
    // A destructive action cannot be executed through IPC without confirmation.
    const refused = await page.evaluate(async () => {
      const workspace = await window.gitDashboard!.loadWorkspace();
      if (!workspace.ok) throw new Error(workspace.error);
      const id = workspace.data.repositories[0].id;
      const plan = await window.gitDashboard!.prepareGitAction(id, {
        type: 'discard',
        paths: ['tracked.txt'],
      });
      if (!plan.ok) throw new Error(plan.error);
      return window.gitDashboard!.executeGitAction(id, plan.data.token, crypto.randomUUID(), false);
    });
    expect(refused.ok).toBe(false);
    await page.getByRole('checkbox', { name: 'Nicht gestagt: tracked.txt', exact: true }).check();
    await page.getByRole('button', { name: 'Auswahl verwerfen', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Änderungen verwerfen', exact: true }),
    ).toContainText(cwd);
    await page.screenshot({ path: 'test-results/ui/git-discard-confirmation.png' });
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    expect(await readFile(path.join(cwd, 'tracked.txt'), 'utf8')).toBe('modified\n');
    // Dismiss the recorded, non-executed action if its output is shown.
    const canceledOutput = page.getByRole('dialog', { name: 'Git-Ausgabe', exact: true });
    if (await canceledOutput.isVisible())
      await canceledOutput.getByRole('button', { name: 'Schließen', exact: true }).click();
    await page.getByRole('button', { name: 'Auswahl verwerfen', exact: true }).click();
    await page.getByRole('button', { name: 'Bestätigen und ausführen', exact: true }).click();
    await closeOutput();
    expect(await readFile(path.join(cwd, 'tracked.txt'), 'utf8')).toBe('initial\n');
    await page.getByRole('button', { name: 'Weitere Git-Aktionen', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Git-Aktion', exact: true })).toBeVisible();
    await page.getByLabel('Aktion', { exact: true }).selectOption('branchCreate');
    await page.getByLabel('Branch-Name', { exact: true }).fill('feature/ui');
    await page.getByRole('button', { name: 'Ausführen', exact: true }).click();
    await closeOutput();
    await expect(page.locator('.repo-context-strip .branch-label')).toContainText('feature/ui');
    expect(run(cwd, 'branch', '--show-current').trim()).toBe('feature/ui');
    await page.getByRole('button', { name: 'Weitere Git-Aktionen', exact: true }).click();
    await page.getByLabel('Aktion', { exact: true }).selectOption('custom');
    await page.getByLabel('Git-Befehl', { exact: true }).fill('git log -1 --oneline');
    await page.getByRole('button', { name: 'Ausführen', exact: true }).click();
    await page.getByRole('button', { name: 'Bestätigen und ausführen', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Git-Ausgabe', exact: true })).toContainText(
      'Commit from dashboard',
    );
    await page.screenshot({ path: 'test-results/ui/git-command-output.png' });
    await closeOutput();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(960, 700),
    );
    await page.screenshot({ path: 'test-results/ui/git-workbench-narrow.png' });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await page.getByRole('button', { name: 'Hell', exact: true }).click();
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000),
    );
    await page.screenshot({ path: 'test-results/ui/git-workbench-light.png' });
    await page.keyboard.press('ControlOrMeta+o');
    await page.getByRole('button', { name: 'Klonen', exact: true }).click();
    await page.getByLabel('Clone-URL', { exact: true }).fill(bare);
    await page.getByLabel('Zielpfad', { exact: true }).fill(path.join(root, 'cloned-repo'));
    await page.getByRole('button', { name: 'Repository klonen', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Repositories öffnen' })).toHaveCount(0);
    expect(run(path.join(root, 'cloned-repo'), 'log', '-1', '--format=%s').trim()).toBe(
      'Commit from dashboard',
    );
    await page.keyboard.press('ControlOrMeta+o');
    await page.getByRole('button', { name: 'Neu anlegen', exact: true }).click();
    await page.getByLabel('Zielpfad', { exact: true }).fill(path.join(root, 'initialized-repo'));
    await page.getByRole('button', { name: 'Repository anlegen', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Repositories öffnen' })).toHaveCount(0);
    expect(run(path.join(root, 'initialized-repo'), 'branch', '--show-current').trim()).toBe(
      'main',
    );
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
