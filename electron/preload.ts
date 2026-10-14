import { contextBridge, ipcRenderer } from 'electron';
import type { DashboardAPI, RepositoryLoadEvent } from '../shared/types';
import type { GitOperationOutput } from '../shared/git-actions';
const api: DashboardAPI = {
  platform: process.platform,
  gitContext: (id) => ipcRenderer.invoke('git:context', id),
  prepareGitAction: (id, action) => ipcRenderer.invoke('git:prepare', id, action),
  executeGitAction: (id, token, requestId, confirmed) =>
    ipcRenderer.invoke('git:execute', id, token, requestId, confirmed),
  cancelGitOperation: (requestId) => ipcRenderer.invoke('git:cancel', requestId),
  onGitOutput: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, data: GitOperationOutput) => listener(data);
    ipcRenderer.on('git:output', handler);
    return () => {
      ipcRenderer.removeListener('git:output', handler);
    };
  },
  openTerminal: (id) => ipcRenderer.invoke('git:terminal', id),
  chooseDirectory: () => ipcRenderer.invoke('git:choose-directory'),
  createRepository: (requestId, input) => ipcRenderer.invoke('git:create', requestId, input),
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
