import type { Rectangle, WebContents, WebContentsView } from 'electron';

export type RuntimeTargetId = number;
export type PersistentTargetId = string;
export type ThemeMode = 'system' | 'light' | 'dark';

export type TargetLike = WebContents | WebContentsView | RuntimeTargetId;

export interface TargetMeta {
  title?: string;
  type?: string;
  url?: string;
  hostname?: string;
  ownerWindowId?: number;
  ownerWindowTitle?: string;
  bounds?: Rectangle;
  persistentId?: PersistentTargetId;
  [key: string]: unknown;
}

export interface TargetContext {
  webContents: WebContents;
  runtimeId: RuntimeTargetId;
  autoDetected: boolean;
  includeSelf: boolean;
}

export interface PersistedUiState {
  theme?: ThemeMode;
  windowBounds?: Rectangle;
}

export interface PersistenceAdapter {
  load?: () => PersistedUiState | Promise<PersistedUiState | undefined> | undefined;
  save?: (state: PersistedUiState) => void | Promise<void>;
}

export interface InitDevToolsManagerOptions {
  autoDetect?: boolean;
  autoShow?: boolean;
  includeSelf?: boolean;
  shouldManageWebContents?: (ctx: TargetContext) => boolean;
  resolveTargetMeta?: (ctx: TargetContext) => Partial<TargetMeta> | void;
  persistence?: PersistenceAdapter;
}

export interface ManagerTargetInfo {
  runtimeId: RuntimeTargetId;
  meta: TargetMeta;
  autoDetected: boolean;
  suppressed?: boolean;
}

export interface ManagerTabInfo {
  runtimeId: RuntimeTargetId;
  loaded: boolean;
  active: boolean;
  meta: TargetMeta;
}

export interface ManagerSnapshot {
  targets: ManagerTargetInfo[];
  tabs: ManagerTabInfo[];
  activeTabId: RuntimeTargetId | null;
  uiState: PersistedUiState;
}

export interface DevToolsManager {
  show(): void;
  hide(): void;
  toggle(): void;
  refreshTargets(): void;
  listTargets(): ManagerTargetInfo[];
  listTabs(): ManagerTabInfo[];
  registerWebContents(
    target: WebContents | WebContentsView,
    meta?: Partial<TargetMeta>,
  ): RuntimeTargetId | undefined;
  unregisterWebContents(target: TargetLike): void;
  openTab(target: TargetLike): void;
  activateTab(target: TargetLike): void;
  unloadTab(target: TargetLike): void;
  closeTab(target: TargetLike): void;
  closeTabsLeftOf(target: TargetLike): void;
  closeTabsRightOf(target: TargetLike): void;
  closeOtherTabs(target: TargetLike): void;
  focusSource(target: TargetLike): void;
  setMeta(target: TargetLike, meta: Partial<TargetMeta>): void;
}
