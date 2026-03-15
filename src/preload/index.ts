import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS, type RendererBridge } from '../shared/ipc';

const bridge: RendererBridge = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
  subscribe(callback) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      snapshot: Awaited<ReturnType<RendererBridge['getSnapshot']>>,
    ) => {
      callback(snapshot);
    };

    ipcRenderer.on(IPC_CHANNELS.stateChanged, handler);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.stateChanged, handler);
    };
  },
  refreshTargets: () => ipcRenderer.invoke(IPC_CHANNELS.refreshTargets),
  openTab: (runtimeId) => ipcRenderer.invoke(IPC_CHANNELS.openTab, runtimeId),
  activateTab: (runtimeId) => ipcRenderer.invoke(IPC_CHANNELS.activateTab, runtimeId),
  unloadTab: (runtimeId) => ipcRenderer.invoke(IPC_CHANNELS.unloadTab, runtimeId),
  closeTab: (runtimeId) => ipcRenderer.invoke(IPC_CHANNELS.closeTab, runtimeId),
  closeTabsLeftOf: (runtimeId) => ipcRenderer.invoke(IPC_CHANNELS.closeTabsLeftOf, runtimeId),
  closeTabsRightOf: (runtimeId) => ipcRenderer.invoke(IPC_CHANNELS.closeTabsRightOf, runtimeId),
  closeOtherTabs: (runtimeId) => ipcRenderer.invoke(IPC_CHANNELS.closeOtherTabs, runtimeId),
  focusSource: (runtimeId) => ipcRenderer.invoke(IPC_CHANNELS.focusSource, runtimeId),
  setTheme: (theme) => ipcRenderer.invoke(IPC_CHANNELS.setTheme, theme),
};

contextBridge.exposeInMainWorld('multiviewDevtools', bridge);
