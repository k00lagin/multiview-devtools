import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS, type RendererBridge } from '../shared/ipc';

const bridge: RendererBridge = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
  getOverlayState: () => ipcRenderer.invoke(IPC_CHANNELS.getOverlayState),
  subscribe(callback) {
    const handler = (
      _event: unknown,
      snapshot: Awaited<ReturnType<RendererBridge['getSnapshot']>>,
    ) => {
      callback(snapshot);
    };

    ipcRenderer.on(IPC_CHANNELS.stateChanged, handler);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.stateChanged, handler);
    };
  },
  subscribeOverlay(callback) {
    const handler = (
      _event: unknown,
      overlayState: Awaited<ReturnType<RendererBridge['getOverlayState']>>,
    ) => {
      callback(overlayState);
    };

    ipcRenderer.on(IPC_CHANNELS.overlayStateChanged, handler);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.overlayStateChanged, handler);
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
  openOverlay: (request) => ipcRenderer.invoke(IPC_CHANNELS.openOverlay, request),
  closeOverlay: () => ipcRenderer.invoke(IPC_CHANNELS.closeOverlay),
};

contextBridge.exposeInMainWorld('multiviewDevtools', bridge);
