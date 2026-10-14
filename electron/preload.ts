import { contextBridge, ipcRenderer } from 'electron';
import type { DashboardAPI } from '../shared/types';
const api: DashboardAPI = {
  platform: process.platform,
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  addRepositories: (paths) => ipcRenderer.invoke('workspace:add', paths),
  scanParentRepositories: (id) => ipcRenderer.invoke('repos:scan-parent', id),
  removeRepository: (id) => ipcRenderer.invoke('workspace:remove', id),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  snapshots: () => ipcRenderer.invoke('repos:snapshots'),
  history: (id, branch, offset) => ipcRenderer.invoke('repo:history', id, branch, offset),
  commitDetail: (id, hash) => ipcRenderer.invoke('repo:commit', id, hash),
  revealRepository: (id) => ipcRenderer.invoke('repo:reveal', id),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
};
contextBridge.exposeInMainWorld('gitDashboard', api);
