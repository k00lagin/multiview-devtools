import type {
  ManagerOverlayState,
  ManagerSnapshot,
  OverlayTriggerRequest,
  ThemeMode,
} from './contracts';

export const IPC_CHANNELS = {
  getSnapshot: 'mvdm:get-snapshot',
  getOverlayState: 'mvdm:get-overlay-state',
  stateChanged: 'mvdm:state-changed',
  overlayStateChanged: 'mvdm:overlay-state-changed',
  refreshTargets: 'mvdm:refresh-targets',
  openTab: 'mvdm:open-tab',
  activateTab: 'mvdm:activate-tab',
  unloadTab: 'mvdm:unload-tab',
  closeTab: 'mvdm:close-tab',
  closeTabsLeftOf: 'mvdm:close-tabs-left-of',
  closeTabsRightOf: 'mvdm:close-tabs-right-of',
  closeOtherTabs: 'mvdm:close-other-tabs',
  focusSource: 'mvdm:focus-source',
  setTheme: 'mvdm:set-theme',
  openOverlay: 'mvdm:open-overlay',
  closeOverlay: 'mvdm:close-overlay',
} as const;

export interface RendererBridge {
  getSnapshot: () => Promise<ManagerSnapshot>;
  getOverlayState: () => Promise<ManagerOverlayState>;
  subscribe: (callback: (snapshot: ManagerSnapshot) => void) => () => void;
  subscribeOverlay: (callback: (state: ManagerOverlayState) => void) => () => void;
  refreshTargets: () => Promise<void>;
  openTab: (runtimeId: number) => Promise<void>;
  activateTab: (runtimeId: number) => Promise<void>;
  unloadTab: (runtimeId: number) => Promise<void>;
  closeTab: (runtimeId: number) => Promise<void>;
  closeTabsLeftOf: (runtimeId: number) => Promise<void>;
  closeTabsRightOf: (runtimeId: number) => Promise<void>;
  closeOtherTabs: (runtimeId: number) => Promise<void>;
  focusSource: (runtimeId: number) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  openOverlay: (request: OverlayTriggerRequest) => Promise<void>;
  closeOverlay: () => Promise<void>;
}
