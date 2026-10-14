import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const nodeRequire = createRequire(__filename);

test('desktop workspace, analytics, history, diffs and persistence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'git-dashboard-e2e-'));
  let app: ElectronApplication | undefined;
  const errors: string[] = [];
  const userData = path.join(directory, 'user-data');
  async function fixture(name: string, subjects: string[]) {
    const repo = path.join(directory, name);
    await mkdir(repo);
    const run = (args: string[], env?: NodeJS.ProcessEnv) =>
      execFileSync('git', ['-C', repo, ...args], {
        env: env ?? process.env,
        windowsHide: true,
        stdio: 'pipe',
      });
    run(['init', '-b', 'main']);
    run(['config', 'user.name', 'Joshua Baumann']);
    run(['config', 'user.email', 'joshua@example.test']);
    run(['config', 'core.autocrlf', 'false']);
    for (let i = 0; i < subjects.length; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (subjects.length - i - 1) * 3);
      await writeFile(
        path.join(repo, 'workspace.ts'),
        Array.from({ length: i * 6 + 10 }, (_, n) => `export const item${n} = ${n};`).join('\n') +
          '\n',
      );
      run(['add', '.']);
      run(['commit', '-m', subjects[i]], {
        ...process.env,
        GIT_AUTHOR_NAME: i % 2 ? 'Mara Fischer' : 'Joshua Baumann',
        GIT_AUTHOR_EMAIL: i % 2 ? 'mara@example.test' : 'joshua@example.test',
        GIT_AUTHOR_DATE: date.toISOString(),
        GIT_COMMITTER_DATE: date.toISOString(),
      });
    }
    run(['branch', 'feature/modules']);
    await writeFile(path.join(repo, 'notes.txt'), 'Local work\n');
    return repo;
  }
  async function launch() {
    const env = { ...process.env, GIT_DASHBOARD_USER_DATA: userData };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
    app = await electron.launch({ executablePath: nodeRequire('electron'), args: ['.'], env });
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
    );
    await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible();
    return page;
  }
  try {
    const alpha = await fixture('alpha-workspace', [
      'Initialize workspace',
      'Add repository navigation',
      'Build commit history',
      'Configure statistics modules',
      'Improve keyboard navigation',
    ]);
    const beta = await fixture('design-system', ['Add shared tokens', 'Refine light theme']);
    let page = await launch();
    await expect(page.getByText('Dein Workspace beginnt mit einem Repository')).toBeVisible();
    await page.getByRole('button', { name: 'Lokales Repository öffnen' }).click();
    await page
      .getByRole('textbox', { name: 'Repository-Pfade' })
      .fill(path.join(directory, 'missing'));
    await page.getByRole('button', { name: 'Repositories öffnen', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('textbox', { name: 'Repository-Pfade' }).fill(`${alpha}\n${beta}`);
    await page.getByRole('button', { name: 'Repositories öffnen', exact: true }).click();
    await expect(page.locator('.repo-table tbody tr')).toHaveCount(2);
    await expect(
      page.locator('.module').first().getByText('Mara Fischer', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: 'test-results/ui/overview-dark.png' });

    await page.getByRole('button', { name: 'Modul hinzufügen', exact: true }).click();
    await page.getByLabel('Modultyp', { exact: true }).selectOption('hotspots');
    await page.getByLabel('Titel', { exact: true }).fill('Meine Hotspots');
    await page.getByLabel('Zeitraum', { exact: true }).selectOption('7');
    await page.getByRole('checkbox', { name: 'alpha-workspace', exact: true }).check();
    await page.getByRole('button', { name: 'Modul speichern' }).click();
    await expect(page.getByRole('heading', { name: 'Meine Hotspots' })).toBeVisible();
    await page.getByRole('button', { name: 'Meine Hotspots nach oben' }).click();
    await expect(
      page.locator('.module').nth(3).getByRole('heading', { name: 'Meine Hotspots' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Meine Hotspots konfigurieren' }).click();
    await expect(page.getByLabel('Zeitraum', { exact: true })).toHaveValue('7');
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();

    await page.getByRole('button', { name: 'alpha-workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Commit-Historie' })).toBeVisible();
    await expect(page.locator('.history-row')).toHaveCount(5);
    await page.getByRole('textbox', { name: 'Commits durchsuchen' }).fill('statistics');
    await expect(page.locator('.history-row')).toHaveCount(1);
    await page.locator('.history-row').click();
    await expect(page.getByRole('heading', { name: 'Commit-Details' })).toBeVisible();
    await expect(page.locator('.diff-code')).toContainText('+export const');
    await page.getByRole('button', { name: 'Commit-Hash kopieren' }).click();
    await page.screenshot({ path: 'test-results/ui/commit-detail.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('textbox', { name: 'Commits durchsuchen' }).fill('');
    await page
      .getByRole('combobox', { name: 'Branch auswählen' })
      .selectOption('refs/heads/feature/modules');
    await expect(page.locator('.history-row')).toHaveCount(5);
    await page.getByRole('button', { name: '1 lokale Änderungen' }).click();
    await expect(page.locator('.working-file')).toContainText('notes.txt');
    await page.screenshot({ path: 'test-results/ui/repository-dark.png' });
    await page.getByRole('button', { name: 'Beiträge nach Autor konfigurieren' }).click();
    await page.getByLabel('Titel', { exact: true }).fill('Beiträge in Alpha');
    await page.getByRole('button', { name: 'Modul speichern' }).click();
    await expect(page.getByRole('heading', { name: 'Beiträge in Alpha' })).toBeVisible();
    await app!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(960, 700),
    );
    await page.screenshot({ path: 'test-results/ui/repository-narrow.png' });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await app!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
    );
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await page.getByRole('button', { name: 'Hell', exact: true }).click();
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('tab', { name: 'Übersicht', exact: true }).click();
    await page.screenshot({ path: 'test-results/ui/overview-light.png' });
    expect(errors).toEqual([]);
    await app!.close();
    app = undefined;
    page = await launch();
    await expect(page.locator('.repo-table tbody tr')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Meine Hotspots' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const saved = JSON.parse(await readFile(path.join(userData, 'workspace.json'), 'utf8'));
    expect(saved.settings.modules[3].title).toBe('Meine Hotspots');
    await page.getByRole('button', { name: 'alpha-workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Beiträge in Alpha' })).toBeVisible();
    await page.getByRole('tab', { name: 'Übersicht', exact: true }).click();
    await page.getByRole('button', { name: 'Meine Hotspots konfigurieren' }).click();
    await page.getByRole('button', { name: 'Entfernen', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Meine Hotspots' })).toHaveCount(0);
    await page.getByRole('button', { name: 'design-system aus Workspace entfernen' }).click();
    await page.getByRole('button', { name: 'Aus Workspace entfernen', exact: true }).click();
    await expect(page.locator('.repo-table tbody tr')).toHaveCount(1);
    expect(await readFile(path.join(beta, 'workspace.ts'), 'utf8')).toContain('export const');
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('development server renders the desktop app without CSP or refresh errors', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'git-dashboard-dev-'));
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'pipe' });
  let app: ElectronApplication | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch('http://127.0.0.1:5173')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(ready).toBe(true);
    const env = {
      ...process.env,
      GIT_DASHBOARD_USER_DATA: directory,
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: nodeRequire('electron'), args: ['.'], env });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await expect(page.getByText('Dein Workspace beginnt mit einem Repository')).toBeVisible();
    await page.getByRole('button', { name: 'Lokales Repository öffnen' }).click();
    await expect(page.getByRole('dialog', { name: 'Repositories öffnen' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    server.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
