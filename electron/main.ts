import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { WorkspaceStore } from './store';
import { registerIPC } from './ipc';

if (process.env.GIT_DASHBOARD_USER_DATA && !app.isPackaged) app.setPath('userData', path.resolve(process.env.GIT_DASHBOARD_USER_DATA));

function createWindow() {
  const window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 960, minHeight: 640,
    title: 'Git Dashboard', backgroundColor: '#151719',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(__dirname, '../../dist/index.html'));
}
void app.whenReady().then(async () => {
  const store = new WorkspaceStore(app.getPath('userData'));
  try { await store.load(); }
  catch (error) { const { dialog } = await import('electron'); dialog.showErrorBox('Workspace konnte nicht geladen werden', (error as Error).message); app.quit(); return; }
  registerIPC(store);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' as const }, { role: 'quit' as const }] }] : []),
    { label: 'Bearbeiten', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Ansicht', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Fenster', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
