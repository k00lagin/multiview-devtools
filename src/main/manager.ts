import path from 'node:path';

import {
  app,
  BaseWindow,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  webContents as webContentsModule,
} from 'electron';
import type { Rectangle, WebContents } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import type {
  DevToolsManager,
  InitDevToolsManagerOptions,
  ManagerOverlayState,
  ManagerSnapshot,
  ManagerTabInfo,
  ManagerTargetInfo,
  OverlayPosition,
  OverlayTriggerRequest,
  PersistedUiState,
  RuntimeTargetId,
  TabContextMenuOverlayMenu,
  TargetContext,
  TargetLike,
  TargetMeta,
  ThemeMode,
} from '../shared/contracts';
import { createDefaultPersistenceAdapter } from './persistence';

interface ManagedTargetRecord {
  runtimeId: RuntimeTargetId;
  webContents: WebContents;
  meta: TargetMeta;
  autoDetected: boolean;
  includeSelf: boolean;
  cleanup: Array<() => void>;
  firstLoaded: boolean;
  pendingOpen: boolean;
}

interface ManagedTabRecord {
  runtimeId: RuntimeTargetId;
  view: WebContentsView | null;
  loaded: boolean;
}

interface InternalState {
  initialized: boolean;
  options: InitDevToolsManagerOptions;
  managerWindow: BaseWindow | null;
  managerUiView: WebContentsView | null;
  managerOverlayView: WebContentsView | null;
  targets: Map<RuntimeTargetId, ManagedTargetRecord>;
  tabs: Map<RuntimeTargetId, ManagedTabRecord>;
  tabOrder: RuntimeTargetId[];
  activeTabId: RuntimeTargetId | null;
  suppressedTargets: Set<RuntimeTargetId>;
  internalWebContentsIds: Set<number>;
  persistedUiState: PersistedUiState;
  overlayRequest: OverlayTriggerRequest | null;
  overlayState: ManagerOverlayState;
  persistenceScheduled: boolean;
  autodetectBound: boolean;
  ipcBound: boolean;
}

const MANAGER_HEADER_HEIGHT = 26;
const DEBUGGER_PROTOCOL_VERSION = '1.3';
const CLOSED_OVERLAY_STATE: ManagerOverlayState = {
  open: false,
  menu: null,
};
const state: InternalState = {
  initialized: false,
  options: {},
  managerWindow: null,
  managerUiView: null,
  managerOverlayView: null,
  targets: new Map(),
  tabs: new Map(),
  tabOrder: [],
  activeTabId: null,
  suppressedTargets: new Set(),
  internalWebContentsIds: new Set(),
  persistedUiState: {},
  overlayRequest: null,
  overlayState: CLOSED_OVERLAY_STATE,
  persistenceScheduled: false,
  autodetectBound: false,
  ipcBound: false,
};

function getCurrentDir() {
  return typeof __dirname !== 'undefined' ? __dirname : process.cwd();
}

function getRuntimeRootDir() {
  return path.resolve(getCurrentDir(), '..');
}

function getRendererEntryPath() {
  return path.join(getRuntimeRootDir(), 'renderer', 'index.html');
}

function getOverlayEntryPath() {
  return path.join(getRuntimeRootDir(), 'renderer', 'overlay.html');
}

function getPreloadPath() {
  return path.join(getRuntimeRootDir(), 'preload', 'index.js');
}

function getTargetWebContents(target: TargetLike): WebContents | undefined {
  if (typeof target === 'number') {
    return state.targets.get(target)?.webContents;
  }

  if ('webContents' in target && target.webContents) {
    return target.webContents;
  }

  return target as WebContents;
}

function toRuntimeTargetId(target: TargetLike): RuntimeTargetId | undefined {
  return getTargetWebContents(target)?.id;
}

function safeGetTitle(webContents: WebContents) {
  try {
    return webContents.getTitle();
  } catch {
    return '';
  }
}

function safeGetUrl(webContents: WebContents) {
  try {
    return webContents.getURL();
  } catch {
    return '';
  }
}

function isDevToolsFrontend(webContents: WebContents) {
  return safeGetUrl(webContents).startsWith('devtools://devtools/');
}

function isDevToolsRelatedWebContents(webContents: WebContents) {
  const type = webContents.getType?.() as string | undefined;
  return type === 'devtools' || isDevToolsFrontend(webContents);
}

function buildDefaultMeta(webContents: WebContents): TargetMeta {
  const ownerWindow = BrowserWindow.fromWebContents(webContents);
  const url = safeGetUrl(webContents);

  let hostname: string | undefined;
  try {
    hostname = url ? new URL(url).hostname : undefined;
  } catch {
    hostname = undefined;
  }

  let bounds: Rectangle | undefined;
  try {
    bounds = ownerWindow?.getBounds?.();
  } catch {
    bounds = undefined;
  }

  return {
    title: safeGetTitle(webContents) || `wc:${webContents.id}`,
    type: webContents.getType?.(),
    url,
    hostname,
    ownerWindowId: ownerWindow?.id,
    ownerWindowTitle: ownerWindow?.getTitle?.(),
    bounds,
  };
}

function buildTargetContext(
  webContents: WebContents,
  autoDetected: boolean,
  includeSelf: boolean,
): TargetContext {
  return {
    webContents,
    runtimeId: webContents.id,
    autoDetected,
    includeSelf,
  };
}

function buildResolvedMeta(
  webContents: WebContents,
  autoDetected: boolean,
  includeSelf: boolean,
  overrides: Partial<TargetMeta> = {},
) {
  const resolverResult =
    state.options.resolveTargetMeta?.(buildTargetContext(webContents, autoDetected, includeSelf)) ??
    {};

  return {
    ...buildDefaultMeta(webContents),
    ...resolverResult,
    ...overrides,
  } satisfies TargetMeta;
}

function listTargets(): ManagerTargetInfo[] {
  return [...state.targets.values()]
    .map((target) => ({
      runtimeId: target.runtimeId,
      meta: target.meta,
      autoDetected: target.autoDetected,
      suppressed: state.suppressedTargets.has(target.runtimeId) || undefined,
    }))
    .sort((left, right) => left.runtimeId - right.runtimeId);
}

function listTabs(): ManagerTabInfo[] {
  return state.tabOrder
    .map((runtimeId) => {
      const target = state.targets.get(runtimeId);
      const tab = state.tabs.get(runtimeId);
      if (!target || !tab) {
        return undefined;
      }

      return {
        runtimeId,
        loaded: tab.loaded,
        active: state.activeTabId === runtimeId,
        meta: target.meta,
      } satisfies ManagerTabInfo;
    })
    .filter((tab): tab is ManagerTabInfo => Boolean(tab));
}

function buildSnapshot(): ManagerSnapshot {
  return {
    targets: listTargets(),
    tabs: listTabs(),
    activeTabId: state.activeTabId,
    uiState: state.persistedUiState,
  };
}

function getResolvedTheme(theme = state.persistedUiState.theme): ThemeMode {
  return theme ?? 'system';
}

function chooseOverlayAlign(x: number, estimatedWidth: number) {
  const viewportWidth = state.managerWindow?.getContentBounds().width ?? 1280;
  return x + estimatedWidth > viewportWidth - 8 ? 'end' : 'start';
}

function normalizeOverlayPosition(position: OverlayPosition) {
  return {
    x: Math.max(8, Math.round(position.x)),
    y: Math.max(8, Math.round(position.y)),
    align: position.align ?? 'start',
  } satisfies OverlayPosition;
}

function buildTabContextOverlayMenu(
  request: OverlayTriggerRequest,
): TabContextMenuOverlayMenu | null {
  const runtimeId = request.runtimeId;
  if (runtimeId == null) {
    return null;
  }

  const tab = listTabs().find((entry) => entry.runtimeId === runtimeId);
  if (!tab) {
    return null;
  }

  const index = state.tabOrder.indexOf(runtimeId);
  const point = request.point ?? {
    x: request.anchorRect?.x ?? 0,
    y: (request.anchorRect?.y ?? 0) + (request.anchorRect?.height ?? 0),
  };
  const align = chooseOverlayAlign(point.x, 280);

  return {
    kind: 'tab-context-menu',
    theme: getResolvedTheme(),
    position: normalizeOverlayPosition({
      x: point.x,
      y: point.y,
      align,
    }),
    runtimeId,
    tab,
    canUnload: tab.loaded,
    canCloseLeft: index > 0,
    canCloseRight: index >= 0 && index < state.tabOrder.length - 1,
    canCloseOthers: state.tabOrder.length > 1,
  };
}

function buildOverlayState(request: OverlayTriggerRequest | null): ManagerOverlayState {
  if (!request) {
    return CLOSED_OVERLAY_STATE;
  }

  if (request.kind === 'target-picker') {
    const anchorRect = request.anchorRect;
    const align = chooseOverlayAlign(anchorRect?.x ?? 8, 460);
    const position = normalizeOverlayPosition({
      x: align === 'end' ? (anchorRect?.x ?? 8) + (anchorRect?.width ?? 0) : (anchorRect?.x ?? 8),
      y: (anchorRect?.y ?? 8) + (anchorRect?.height ?? 0) + 6,
      align,
    });

    return {
      open: true,
      menu: {
        kind: 'target-picker',
        theme: getResolvedTheme(),
        position,
        targets: listTargets(),
        openTabIds: state.tabOrder,
        activeTabId: state.activeTabId,
      },
    };
  }

  if (request.kind === 'theme-picker') {
    const anchorRect = request.anchorRect;
    const position = normalizeOverlayPosition({
      x: (anchorRect?.x ?? 8) + (anchorRect?.width ?? 0),
      y: (anchorRect?.y ?? 8) + (anchorRect?.height ?? 0) + 6,
      align: 'end',
    });

    return {
      open: true,
      menu: {
        kind: 'theme-picker',
        theme: getResolvedTheme(),
        position,
        selectedTheme: getResolvedTheme(),
      },
    };
  }

  const menu = buildTabContextOverlayMenu(request);
  if (!menu) {
    return CLOSED_OVERLAY_STATE;
  }

  return {
    open: true,
    menu,
  };
}

function buildEmulatedMediaFeatures(theme: PersistedUiState['theme']) {
  if (theme === 'light' || theme === 'dark') {
    return [
      {
        name: 'prefers-color-scheme',
        value: theme,
      },
    ];
  }

  return [];
}

async function applyThemeToDevToolsWebContents(webContents: WebContents) {
  if (webContents.isDestroyed()) {
    return;
  }

  try {
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach(DEBUGGER_PROTOCOL_VERSION);
    }
  } catch {
    return;
  }

  try {
    await webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: buildEmulatedMediaFeatures(state.persistedUiState.theme),
    });
  } catch {
    // Best-effort only. Some nested DevTools flows can detach the debugger.
  }
}

function syncDevToolsThemeForLoadedTabs() {
  for (const tab of state.tabs.values()) {
    const webContents = tab.view?.webContents;
    if (!tab.loaded || !webContents || webContents.isDestroyed()) {
      continue;
    }

    void applyThemeToDevToolsWebContents(webContents);
  }
}

function refreshOverlayState() {
  state.overlayState = buildOverlayState(state.overlayRequest);
  if (!state.overlayState.open) {
    state.overlayRequest = null;
  }
}

function broadcastOverlayState() {
  refreshOverlayState();
  const webContents = state.managerOverlayView?.webContents;
  if (!webContents || webContents.isDestroyed()) {
    return;
  }

  webContents.send(IPC_CHANNELS.overlayStateChanged, state.overlayState);
}

function broadcastSnapshot() {
  refreshOverlayState();
  const webContents = state.managerUiView?.webContents;
  if (webContents && !webContents.isDestroyed()) {
    webContents.send(IPC_CHANNELS.stateChanged, buildSnapshot());
  }

  broadcastOverlayState();
}

function schedulePersistenceSave() {
  if (state.persistenceScheduled) {
    return;
  }

  state.persistenceScheduled = true;
  queueMicrotask(async () => {
    state.persistenceScheduled = false;
    const persistence = state.options.persistence ?? createDefaultPersistenceAdapter();
    await persistence.save?.(state.persistedUiState);
  });
}

function syncWindowBoundsIntoState() {
  const bounds = state.managerWindow?.getBounds();
  if (!bounds) {
    return;
  }

  state.persistedUiState = {
    ...state.persistedUiState,
    windowBounds: bounds,
  };
  schedulePersistenceSave();
}

function rememberInternalWebContents(id: number) {
  state.internalWebContentsIds.add(id);
  if (!state.options.includeSelf) {
    unregisterWebContents(id, false);
  }
}

function closeOverlay() {
  state.overlayRequest = null;
  state.overlayState = CLOSED_OVERLAY_STATE;
  broadcastOverlayState();
  layoutActiveTabView();

  try {
    state.managerUiView?.webContents.focus();
  } catch {
    // Best-effort focus restore.
  }
}

function openOverlay(request: OverlayTriggerRequest) {
  state.overlayRequest = request;
  refreshOverlayState();
  if (!state.overlayState.open) {
    broadcastOverlayState();
    layoutActiveTabView();
    return;
  }

  broadcastOverlayState();
  layoutActiveTabView();

  try {
    state.managerOverlayView?.webContents.focus();
  } catch {
    // Best-effort focus only.
  }
}

function layoutActiveTabView() {
  if (!state.managerWindow || state.managerWindow.isDestroyed()) {
    return;
  }

  const { width, height } = state.managerWindow.getContentBounds();
  const viewportHeight = Math.max(0, height - MANAGER_HEADER_HEIGHT);

  for (const [runtimeId, tab] of state.tabs) {
    if (!tab.view || tab.view.webContents.isDestroyed()) {
      continue;
    }

    if (tab.loaded && state.activeTabId === runtimeId) {
      tab.view.setBounds({
        x: 0,
        y: MANAGER_HEADER_HEIGHT,
        width,
        height: viewportHeight,
      });
      continue;
    }

    tab.view.setBounds({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  }

  const overlayView = state.managerOverlayView;
  if (overlayView && !overlayView.webContents.isDestroyed()) {
    if (state.overlayState.open) {
      overlayView.setBounds({
        x: 0,
        y: 0,
        width,
        height,
      });
    } else {
      overlayView.setBounds({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    }
  }
}

function ensureTabView(runtimeId: RuntimeTargetId) {
  const target = state.targets.get(runtimeId);
  const tab = state.tabs.get(runtimeId);
  if (!target || !tab) {
    return undefined;
  }

  if (tab.view && !tab.view.webContents.isDestroyed()) {
    void applyThemeToDevToolsWebContents(tab.view.webContents);
    return tab.view;
  }

  const devToolsView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const syncTheme = () => {
    void applyThemeToDevToolsWebContents(devToolsView.webContents);
  };

  rememberInternalWebContents(devToolsView.webContents.id);

  try {
    target.webContents.setDevToolsWebContents(devToolsView.webContents);
  } catch {
    return undefined;
  }

  state.managerWindow?.contentView.addChildView(devToolsView, 1);
  devToolsView.webContents.on('did-finish-load', syncTheme);
  devToolsView.webContents.on('did-navigate-in-page', syncTheme);
  tab.view = devToolsView;
  tab.loaded = true;
  syncTheme();

  return devToolsView;
}

function destroyTabView(runtimeId: RuntimeTargetId) {
  const tab = state.tabs.get(runtimeId);
  if (!tab?.view) {
    return;
  }

  try {
    tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    tab.view.webContents.close();
  } catch {
    // Best-effort cleanup.
  }

  tab.view = null;
  tab.loaded = false;
}

function openTab(target: TargetLike) {
  const runtimeId = toRuntimeTargetId(target);
  if (runtimeId == null) {
    return;
  }

  const targetRecord = state.targets.get(runtimeId);
  if (!targetRecord || targetRecord.webContents.isDestroyed()) {
    return;
  }

  const existingTab = state.tabs.get(runtimeId);
  const previousActiveTabId = state.activeTabId;
  if (!existingTab) {
    state.tabs.set(runtimeId, {
      runtimeId,
      view: null,
      loaded: false,
    });
    state.tabOrder.push(runtimeId);
  }

  state.activeTabId = runtimeId;

  if (!targetRecord.firstLoaded) {
    targetRecord.pendingOpen = true;
    broadcastSnapshot();
    layoutActiveTabView();
    return;
  }

  const view = ensureTabView(runtimeId);
  if (!view) {
    if (!existingTab) {
      state.tabs.delete(runtimeId);
      state.tabOrder = state.tabOrder.filter((id) => id !== runtimeId);
      state.activeTabId = previousActiveTabId ?? null;
      broadcastSnapshot();
      layoutActiveTabView();
    }
    return;
  }

  try {
    targetRecord.webContents.openDevTools({ mode: 'detach' });
  } catch {
    // Electron opens the frontend against the custom WebContents when available.
  }

  const tab = state.tabs.get(runtimeId);
  if (tab) {
    tab.loaded = true;
  }

  broadcastSnapshot();
  layoutActiveTabView();
}

function activateTab(target: TargetLike) {
  openTab(target);
  const runtimeId = toRuntimeTargetId(target);
  if (runtimeId == null) {
    return;
  }

  state.activeTabId = runtimeId;
  broadcastSnapshot();
  layoutActiveTabView();
}

function unloadTab(target: TargetLike) {
  const runtimeId = toRuntimeTargetId(target);
  if (runtimeId == null) {
    return;
  }

  destroyTabView(runtimeId);
  broadcastSnapshot();
  layoutActiveTabView();
}

function closeTabsByIds(runtimeIds: RuntimeTargetId[], fallbackActiveId: RuntimeTargetId | null = null) {
  const idsToClose = runtimeIds.filter((runtimeId) => state.tabs.has(runtimeId));
  if (!idsToClose.length) {
    return;
  }

  const activeRemoved = state.activeTabId != null && idsToClose.includes(state.activeTabId);
  for (const runtimeId of idsToClose) {
    destroyTabView(runtimeId);
    state.tabs.delete(runtimeId);
  }

  state.tabOrder = state.tabOrder.filter((runtimeId) => !idsToClose.includes(runtimeId));

  if (activeRemoved) {
    if (fallbackActiveId != null && state.tabs.has(fallbackActiveId)) {
      state.activeTabId = fallbackActiveId;
    } else {
      state.activeTabId = state.tabOrder.at(-1) ?? null;
    }
  }

  if (
    state.overlayState.open &&
    state.overlayState.menu?.kind === 'tab-context-menu' &&
    idsToClose.includes(state.overlayState.menu.runtimeId)
  ) {
    state.overlayRequest = null;
    state.overlayState = CLOSED_OVERLAY_STATE;
  }

  broadcastSnapshot();
  layoutActiveTabView();
}

function closeTab(target: TargetLike) {
  const runtimeId = toRuntimeTargetId(target);
  if (runtimeId == null) {
    return;
  }

  const index = state.tabOrder.indexOf(runtimeId);
  const fallbackActiveId =
    state.tabOrder[index - 1] ?? state.tabOrder[index + 1] ?? state.tabOrder.at(-1) ?? null;
  closeTabsByIds([runtimeId], fallbackActiveId);
}

function closeTabsLeftOf(target: TargetLike) {
  const runtimeId = toRuntimeTargetId(target);
  if (runtimeId == null) {
    return;
  }

  const index = state.tabOrder.indexOf(runtimeId);
  if (index <= 0) {
    return;
  }

  closeTabsByIds(state.tabOrder.slice(0, index), runtimeId);
}

function closeTabsRightOf(target: TargetLike) {
  const runtimeId = toRuntimeTargetId(target);
  if (runtimeId == null) {
    return;
  }

  const index = state.tabOrder.indexOf(runtimeId);
  if (index < 0 || index === state.tabOrder.length - 1) {
    return;
  }

  closeTabsByIds(state.tabOrder.slice(index + 1), runtimeId);
}

function closeOtherTabs(target: TargetLike) {
  const runtimeId = toRuntimeTargetId(target);
  if (runtimeId == null) {
    return;
  }

  closeTabsByIds(
    state.tabOrder.filter((id) => id !== runtimeId),
    runtimeId,
  );
}

function focusSource(target: TargetLike) {
  const runtimeId = toRuntimeTargetId(target);
  if (runtimeId == null) {
    return;
  }

  const targetRecord = state.targets.get(runtimeId);
  const ownerWindow = targetRecord ? BrowserWindow.fromWebContents(targetRecord.webContents) : null;
  try {
    ownerWindow?.show();
    ownerWindow?.focus();
    targetRecord?.webContents.focus();
  } catch {
    // Best-effort focus.
  }
}

function setMeta(target: TargetLike, meta: Partial<TargetMeta>) {
  const runtimeId = toRuntimeTargetId(target);
  if (runtimeId == null) {
    return;
  }

  const targetRecord = state.targets.get(runtimeId);
  if (!targetRecord) {
    return;
  }

  targetRecord.meta = {
    ...targetRecord.meta,
    ...meta,
  };
  broadcastSnapshot();
}

function registerWebContents(
  target: WebContents | WebContentsView,
  meta: Partial<TargetMeta> = {},
  autoDetected = false,
) {
  const webContents = 'webContents' in target ? target.webContents : target;
  if (!webContents || typeof webContents.id !== 'number' || webContents.isDestroyed()) {
    return undefined;
  }

  const includeSelf = Boolean(state.options.includeSelf);
  if (state.internalWebContentsIds.has(webContents.id) && !includeSelf) {
    return undefined;
  }

  state.suppressedTargets.delete(webContents.id);

  const existing = state.targets.get(webContents.id);
  if (existing) {
    existing.meta = {
      ...existing.meta,
      ...buildResolvedMeta(webContents, autoDetected, includeSelf, meta),
    };
    existing.autoDetected = existing.autoDetected && autoDetected;
    broadcastSnapshot();
    return webContents.id;
  }

  const targetRecord: ManagedTargetRecord = {
    runtimeId: webContents.id,
    webContents,
    meta: buildResolvedMeta(webContents, autoDetected, includeSelf, meta),
    autoDetected,
    includeSelf,
    cleanup: [],
    firstLoaded: Boolean(safeGetUrl(webContents)),
    pendingOpen: false,
  };

  const syncMetadata = () => {
    if (autoDetected && isDevToolsRelatedWebContents(webContents)) {
      unregisterWebContents(webContents.id, false);
      return;
    }

    targetRecord.firstLoaded = Boolean(safeGetUrl(webContents));
    targetRecord.meta = buildResolvedMeta(webContents, autoDetected, includeSelf, targetRecord.meta);
    broadcastSnapshot();

    if (targetRecord.pendingOpen && state.activeTabId === webContents.id) {
      targetRecord.pendingOpen = false;
      openTab(webContents.id);
    }
  };

  const onDestroyed = () => unregisterWebContents(webContents.id, autoDetected);

  webContents.on('did-navigate', syncMetadata);
  webContents.on('did-navigate-in-page', syncMetadata);
  webContents.on('page-title-updated', syncMetadata);
  webContents.once('destroyed', onDestroyed);

  targetRecord.cleanup.push(() => webContents.off('did-navigate', syncMetadata));
  targetRecord.cleanup.push(() => webContents.off('did-navigate-in-page', syncMetadata));
  targetRecord.cleanup.push(() => webContents.off('page-title-updated', syncMetadata));

  state.targets.set(webContents.id, targetRecord);
  broadcastSnapshot();
  return webContents.id;
}

function unregisterWebContents(target: TargetLike, suppress = true) {
  const runtimeId = toRuntimeTargetId(target);
  if (runtimeId == null) {
    return;
  }

  const targetRecord = state.targets.get(runtimeId);
  if (!targetRecord) {
    if (suppress) {
      state.suppressedTargets.add(runtimeId);
    }
    return;
  }

  for (const cleanup of targetRecord.cleanup) {
    cleanup();
  }

  state.targets.delete(runtimeId);
  destroyTabView(runtimeId);
  state.tabs.delete(runtimeId);
  state.tabOrder = state.tabOrder.filter((id) => id !== runtimeId);

  if (state.activeTabId === runtimeId) {
    state.activeTabId = state.tabOrder.at(-1) ?? null;
  }

  if (suppress) {
    state.suppressedTargets.add(runtimeId);
  }

  broadcastSnapshot();
  layoutActiveTabView();
}

function shouldManageWebContents(webContents: WebContents) {
  const includeSelf = Boolean(state.options.includeSelf);
  if (webContents.isDestroyed()) {
    return false;
  }

  if (state.internalWebContentsIds.has(webContents.id) && !includeSelf) {
    return false;
  }

  if (isDevToolsRelatedWebContents(webContents)) {
    return false;
  }

  if (state.suppressedTargets.has(webContents.id)) {
    return false;
  }

  return (
    state.options.shouldManageWebContents?.(buildTargetContext(webContents, true, includeSelf)) ??
    true
  );
}

function refreshTargets() {
  for (const webContents of webContentsModule.getAllWebContents()) {
    if (!shouldManageWebContents(webContents)) {
      continue;
    }

    registerWebContents(webContents, {}, true);
  }

  broadcastSnapshot();
}

function onWebContentsCreated(_event: unknown, webContents: WebContents) {
  if (!shouldManageWebContents(webContents)) {
    return;
  }

  registerWebContents(webContents, {}, true);
}

async function restorePersistedUiState() {
  const persistence = state.options.persistence ?? createDefaultPersistenceAdapter();
  const restoredState = await persistence.load?.();
  state.persistedUiState = restoredState ?? {};
}

function createManagerWindow() {
  if (state.managerWindow && !state.managerWindow.isDestroyed()) {
    return state.managerWindow;
  }

  const bounds = state.persistedUiState.windowBounds;
  const managerWindowOptions = {
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 820,
    title: 'Multiview DevTools',
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
  };

  const managerWindow = new BaseWindow(
    bounds?.x != null && bounds?.y != null
      ? {
          ...managerWindowOptions,
          x: bounds.x,
          y: bounds.y,
        }
      : managerWindowOptions,
  );

  const managerUiView = new WebContentsView({
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath(),
    },
  });
  const managerOverlayView = new WebContentsView({
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath(),
      transparent: true,
    },
  });

  state.managerWindow = managerWindow;
  state.managerUiView = managerUiView;
  state.managerOverlayView = managerOverlayView;
  rememberInternalWebContents(managerUiView.webContents.id);
  rememberInternalWebContents(managerOverlayView.webContents.id);

  managerOverlayView.setBackgroundColor('#00000000');

  managerWindow.contentView.addChildView(managerUiView, 0);
  for (const tab of state.tabs.values()) {
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      managerWindow.contentView.addChildView(tab.view, 1);
    }
  }
  managerWindow.contentView.addChildView(managerOverlayView, 2);

  if (state.options.includeSelf) {
    registerWebContents(
      managerUiView,
      {
        title: 'manager:toolbar',
        type: 'manager-ui',
      },
      false,
    );
    registerWebContents(
      managerOverlayView,
      {
        title: 'manager:overlay',
        type: 'manager-overlay',
      },
      false,
    );
  }

  const relayout = () => {
    const { width, height } = managerWindow.getContentBounds();
    managerUiView.setBounds({ x: 0, y: 0, width, height });
    layoutActiveTabView();
  };

  managerWindow.on('resize', relayout);
  managerWindow.on('move', syncWindowBoundsIntoState);
  managerWindow.on('resize', syncWindowBoundsIntoState);
  managerWindow.on('blur', closeOverlay);
  managerWindow.on('closed', () => {
    state.managerWindow = null;
    state.managerUiView = null;
    state.managerOverlayView = null;
    state.overlayRequest = null;
    state.overlayState = CLOSED_OVERLAY_STATE;
  });

  managerUiView.webContents.on('did-finish-load', () => {
    managerUiView.webContents.send(IPC_CHANNELS.stateChanged, buildSnapshot());
    relayout();
  });
  managerOverlayView.webContents.on('did-finish-load', () => {
    broadcastOverlayState();
    relayout();
  });

  void managerUiView.webContents.loadFile(getRendererEntryPath());
  void managerOverlayView.webContents.loadFile(getOverlayEntryPath());
  relayout();
  return managerWindow;
}

function wireIpc() {
  if (state.ipcBound) {
    return;
  }

  state.ipcBound = true;

  ipcMain.handle(IPC_CHANNELS.getSnapshot, () => buildSnapshot());
  ipcMain.handle(IPC_CHANNELS.getOverlayState, () => {
    refreshOverlayState();
    return state.overlayState;
  });
  ipcMain.handle(IPC_CHANNELS.refreshTargets, () => refreshTargets());
  ipcMain.handle(IPC_CHANNELS.openTab, (_event: unknown, runtimeId: number) => openTab(runtimeId));
  ipcMain.handle(IPC_CHANNELS.activateTab, (_event: unknown, runtimeId: number) =>
    activateTab(runtimeId),
  );
  ipcMain.handle(IPC_CHANNELS.unloadTab, (_event: unknown, runtimeId: number) =>
    unloadTab(runtimeId),
  );
  ipcMain.handle(IPC_CHANNELS.closeTab, (_event: unknown, runtimeId: number) => closeTab(runtimeId));
  ipcMain.handle(IPC_CHANNELS.closeTabsLeftOf, (_event: unknown, runtimeId: number) =>
    closeTabsLeftOf(runtimeId),
  );
  ipcMain.handle(IPC_CHANNELS.closeTabsRightOf, (_event: unknown, runtimeId: number) =>
    closeTabsRightOf(runtimeId),
  );
  ipcMain.handle(IPC_CHANNELS.closeOtherTabs, (_event: unknown, runtimeId: number) =>
    closeOtherTabs(runtimeId),
  );
  ipcMain.handle(IPC_CHANNELS.focusSource, (_event: unknown, runtimeId: number) =>
    focusSource(runtimeId),
  );
  ipcMain.handle(IPC_CHANNELS.setTheme, (_event: unknown, theme: PersistedUiState['theme']) => {
    state.persistedUiState = {
      ...state.persistedUiState,
      theme,
    };
    syncDevToolsThemeForLoadedTabs();
    schedulePersistenceSave();
    broadcastSnapshot();
  });
  ipcMain.handle(IPC_CHANNELS.openOverlay, (_event: unknown, request: OverlayTriggerRequest) =>
    openOverlay(request),
  );
  ipcMain.handle(IPC_CHANNELS.closeOverlay, () => closeOverlay());
}

function buildApi(): DevToolsManager {
  return {
    show() {
      const window = createManagerWindow();
      window.show();
      window.focus();
    },
    hide() {
      state.managerWindow?.hide();
    },
    toggle() {
      const window = createManagerWindow();
      if (window.isVisible()) {
        window.hide();
      } else {
        window.show();
        window.focus();
      }
    },
    refreshTargets,
    listTargets,
    listTabs,
    registerWebContents,
    unregisterWebContents(target) {
      unregisterWebContents(target, true);
    },
    openTab,
    activateTab,
    unloadTab,
    closeTab,
    closeTabsLeftOf,
    closeTabsRightOf,
    closeOtherTabs,
    focusSource,
    setMeta,
  };
}

export function initDevToolsManager(options: InitDevToolsManagerOptions = {}): DevToolsManager {
  state.options = options;

  if (state.initialized) {
    return buildApi();
  }

  state.initialized = true;

  const start = async () => {
    await restorePersistedUiState();
    wireIpc();

    if (options.autoDetect !== false && !state.autodetectBound) {
      state.autodetectBound = true;
      (
        app as unknown as {
          on(event: 'web-contents-created', listener: typeof onWebContentsCreated): void;
        }
      ).on('web-contents-created', onWebContentsCreated);
      refreshTargets();
    }

    if (options.autoShow !== false) {
      const window = createManagerWindow();
      window.show();
      window.focus();
    }
  };

  if (app.isReady()) {
    void start();
  } else {
    void app.whenReady().then(start);
  }

  return buildApi();
}
