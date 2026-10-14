import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('gitDashboard', { platform: process.platform });
