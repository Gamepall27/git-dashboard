import { contextBridge, ipcRenderer } from 'electron';
import type { DashboardAPI, RepositoryLoadEvent } from '../shared/types';
const api: DashboardAPI = {
  platform: process.platform,
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  addRepositories: (paths) => ipcRenderer.invoke('workspace:add', paths),
  scanParentRepositories: (id) => ipcRenderer.invoke('repos:scan-parent', id),
  removeRepository: (id) => ipcRenderer.invoke('workspace:remove', id),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  startRepositoryLoad: (requestId, options) => ipcRenderer.invoke('repos:load', requestId, options),
  cancelRepositoryLoad: (requestId) => ipcRenderer.invoke('repos:cancel-load', requestId),
  prioritizeRepositoryLoad: (id) => ipcRenderer.invoke('repos:prioritize', id),
  onRepositoryLoad: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, data: RepositoryLoadEvent) =>
      listener(data);
    ipcRenderer.on('repos:load-event', handler);
    return () => {
      ipcRenderer.removeListener('repos:load-event', handler);
    };
  },
  history: (id, branch, offset) => ipcRenderer.invoke('repo:history', id, branch, offset),
  commitDetail: (id, hash) => ipcRenderer.invoke('repo:commit', id, hash),
  revealRepository: (id) => ipcRenderer.invoke('repo:reveal', id),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
};
contextBridge.exposeInMainWorld('gitDashboard', api);
