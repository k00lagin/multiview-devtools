import type {
  ManagerOverlayState,
  ManagerSnapshot,
  OverlayTriggerRequest,
  RuntimeTargetId,
  ThemeMode,
} from './contracts';

export const IPC_CHANNELS = {
  getSnapshot: 'mvdm:get-snapshot',
  getOverlayState: 'mvdm:get-overlay-state',
  stateChanged: 'mvdm:state-changed',
  overlayStateChanged: 'mvdm:overlay-state-changed',
  command: 'mvdm:command',
  refreshTargets: 'mvdm:refresh-targets',
  openTab: 'mvdm:open-tab',
  activateTab: 'mvdm:activate-tab',
  unloadTab: 'mvdm:unload-tab',
  closeTab: 'mvdm:close-tab',
  moveTab: 'mvdm:move-tab',
  closeTabsLeftOf: 'mvdm:close-tabs-left-of',
  closeTabsRightOf: 'mvdm:close-tabs-right-of',
  closeOtherTabs: 'mvdm:close-other-tabs',
  focusSource: 'mvdm:focus-source',
  setTheme: 'mvdm:set-theme',
  dismissNotice: 'mvdm:dismiss-notice',
  openOverlay: 'mvdm:open-overlay',
  closeOverlay: 'mvdm:close-overlay',
} as const;

/** Commands main sends to the manager UI when it needs renderer geometry to act. */
export type ManagerCommand = 'open-target-picker';

export interface RendererBridge {
  getSnapshot: () => Promise<ManagerSnapshot>;
  getOverlayState: () => Promise<ManagerOverlayState>;
  subscribe: (callback: (snapshot: ManagerSnapshot) => void) => () => void;
  subscribeOverlay: (callback: (state: ManagerOverlayState) => void) => () => void;
  subscribeCommands: (callback: (command: ManagerCommand) => void) => () => void;
  refreshTargets: () => Promise<void>;
  openTab: (runtimeId: number) => Promise<void>;
  activateTab: (runtimeId: number) => Promise<void>;
  unloadTab: (runtimeId: number) => Promise<void>;
  closeTab: (runtimeId: number) => Promise<void>;
  moveTab: (runtimeId: RuntimeTargetId, toIndex: number) => Promise<void>;
  closeTabsLeftOf: (runtimeId: number) => Promise<void>;
  closeTabsRightOf: (runtimeId: number) => Promise<void>;
  closeOtherTabs: (runtimeId: number) => Promise<void>;
  focusSource: (runtimeId: number) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  dismissNotice: (id: number) => Promise<void>;
  openOverlay: (request: OverlayTriggerRequest) => Promise<void>;
  closeOverlay: () => Promise<void>;
}
