import path from 'node:path';

import {
  app,
  BaseWindow,
  BrowserWindow,
  View,
  WebContentsView,
  ipcMain,
  webContents as webContentsModule,
} from 'electron';
import type { Event as ElectronEvent, Input, Rectangle, WebContents } from 'electron';

import { IPC_CHANNELS, type ManagerCommand } from '../shared/ipc';
import type {
  DevToolsManager,
  InitDevToolsManagerOptions,
  ManagerNotice,
  ManagerOverlayState,
  ManagerSnapshot,
  ManagerTabInfo,
  ManagerTargetInfo,
  OverlayPosition,
  OverlayTriggerRequest,
  PersistedUiState,
  RuntimeTargetId,
  TabContextMenuOverlayMenu,
  TabStatus,
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
  cleanup: Array<() => void>;
  firstLoaded: boolean;
  pendingOpen: boolean;
}

interface ManagedTabRecord {
  runtimeId: RuntimeTargetId;
  view: WebContentsView | null;
  loaded: boolean;
  frontendLoading: boolean;
  error: string | null;
}

interface SourceHighlight {
  window: BaseWindow;
  fill: View;
  edges: [View, View, View, View];
}

type ShortcutAction =
  | { kind: 'open-target-picker' }
  | { kind: 'close-active' }
  | { kind: 'cycle'; direction: 1 | -1 }
  | { kind: 'select'; position: number };

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
  notices: ManagerNotice[];
  lastNoticeId: number;
  sourceHighlight: SourceHighlight | null;
  sourceHighlightTimer: ReturnType<typeof setTimeout> | null;
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
const MAX_NOTICES = 3;
const NOTICE_TIMEOUT_MS = { info: 6000, error: 10000 } as const;
const SOURCE_HIGHLIGHT_MS = 1500;
const SOURCE_HIGHLIGHT_BORDER = 3;
const SOURCE_HIGHLIGHT_COLOR = '#1a73e8';
const SOURCE_HIGHLIGHT_FILL = '#331a73e8';
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
  notices: [],
  lastNoticeId: 0,
  sourceHighlight: null,
  sourceHighlightTimer: null,
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

function buildTargetContext(webContents: WebContents, autoDetected: boolean): TargetContext {
  return {
    webContents,
    runtimeId: webContents.id,
    autoDetected,
  };
}

function buildResolvedMeta(
  webContents: WebContents,
  autoDetected: boolean,
  overrides: Partial<TargetMeta> = {},
) {
  const resolverResult =
    state.options.resolveTargetMeta?.(buildTargetContext(webContents, autoDetected)) ?? {};

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

function getTabStatus(tab: ManagedTabRecord, target: ManagedTargetRecord): TabStatus {
  if (tab.error) {
    return 'error';
  }

  if (target.pendingOpen || tab.frontendLoading) {
    return 'loading';
  }

  return tab.view ? 'ready' : 'unloaded';
}

function getTargetLabel(runtimeId: RuntimeTargetId) {
  return state.targets.get(runtimeId)?.meta.title?.trim() || `wc:${runtimeId}`;
}

function describeError(error: unknown) {
  return error instanceof Error && error.message ? error.message : String(error);
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
        status: getTabStatus(tab, target),
        ...(tab.error ? { error: tab.error } : {}),
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
    notices: state.notices,
    uiState: state.persistedUiState,
  };
}

/** Queues a short toolbar message. Callers broadcast the snapshot themselves. */
function pushNotice(tone: ManagerNotice['tone'], message: string, runtimeId?: RuntimeTargetId) {
  const id = ++state.lastNoticeId;
  const notice: ManagerNotice =
    runtimeId == null ? { id, tone, message } : { id, tone, message, runtimeId };
  state.notices = [...state.notices, notice].slice(-MAX_NOTICES);
  setTimeout(() => dismissNotice(id), NOTICE_TIMEOUT_MS[tone]).unref?.();
}

/** Drops a tab's error notices once they no longer apply (the tab recovered or was closed). */
function clearTabErrorNotices(runtimeId: RuntimeTargetId) {
  state.notices = state.notices.filter(
    (notice) => !(notice.tone === 'error' && notice.runtimeId === runtimeId),
  );
}

function dismissNotice(id: number) {
  if (!state.notices.some((notice) => notice.id === id)) {
    return;
  }

  state.notices = state.notices.filter((notice) => notice.id !== id);
  broadcastSnapshot();
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
    unregisterTarget(id, false);
  }
}

function closeOverlay(options: { restoreFocus?: boolean } = {}) {
  state.overlayRequest = null;
  state.overlayState = CLOSED_OVERLAY_STATE;
  broadcastOverlayState();
  layoutActiveTabView();

  if (options.restoreFocus !== false) {
    focusActiveTabContents();
  }
}

function focusActiveTabContents() {
  const activeView = state.activeTabId == null ? null : state.tabs.get(state.activeTabId)?.view;
  try {
    (activeView?.webContents ?? state.managerUiView?.webContents)?.focus();
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

function resolveShortcut(input: Input): ShortcutAction | null {
  if (input.type !== 'keyDown' || input.alt || !(input.control || input.meta)) {
    return null;
  }

  // `code` is layout-independent, so shortcuts also work with non-Latin keyboard layouts.
  switch (input.code) {
    case 'Tab':
      return { kind: 'cycle', direction: input.shift ? -1 : 1 };
    case 'PageDown':
      return input.shift ? null : { kind: 'cycle', direction: 1 };
    case 'PageUp':
      return input.shift ? null : { kind: 'cycle', direction: -1 };
    case 'KeyT':
    case 'KeyK':
      return input.shift ? null : { kind: 'open-target-picker' };
    case 'KeyW':
      return input.shift ? null : { kind: 'close-active' };
  }

  const digit = /^Digit([1-9])$/.exec(input.code);
  return digit && !input.shift ? { kind: 'select', position: Number(digit[1]) } : null;
}

function activateTabFromShortcut(runtimeId: RuntimeTargetId | undefined) {
  if (runtimeId == null) {
    return false;
  }

  activateTab(runtimeId);
  focusActiveTabContents();
  return true;
}

/** Runs a shortcut and reports whether it did anything, so unused keys still reach DevTools. */
function runShortcut(shortcut: ShortcutAction) {
  const { tabOrder, activeTabId } = state;

  switch (shortcut.kind) {
    case 'open-target-picker': {
      const webContents = state.managerUiView?.webContents;
      if (!webContents || webContents.isDestroyed()) {
        return false;
      }

      webContents.send(IPC_CHANNELS.command, 'open-target-picker' satisfies ManagerCommand);
      return true;
    }
    case 'close-active':
      if (activeTabId == null) {
        return false;
      }

      closeTab(activeTabId);
      focusActiveTabContents();
      return true;
    case 'cycle': {
      if (!tabOrder.length) {
        return false;
      }

      const index = activeTabId == null ? -1 : tabOrder.indexOf(activeTabId);
      const nextIndex =
        index < 0 ? 0 : (index + shortcut.direction + tabOrder.length) % tabOrder.length;
      return activateTabFromShortcut(tabOrder[nextIndex]);
    }
    case 'select':
      // Like browsers, the last digit always jumps to the last tab.
      return activateTabFromShortcut(
        shortcut.position === 9 ? tabOrder.at(-1) : tabOrder[shortcut.position - 1],
      );
  }
}

function handleShortcutInput(event: ElectronEvent, input: Input) {
  const shortcut = resolveShortcut(input);
  if (shortcut && runShortcut(shortcut)) {
    event.preventDefault();
  }
}

function handleOverlayShortcutInput(event: ElectronEvent, input: Input) {
  const shortcut = resolveShortcut(input);
  if (!shortcut) {
    return;
  }

  event.preventDefault();
  const pickerWasOpen = state.overlayState.menu?.kind === 'target-picker';
  closeOverlay();
  if (!(pickerWasOpen && shortcut.kind === 'open-target-picker')) {
    runShortcut(shortcut);
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

/** Returns the tab's DevTools view, creating it if needed. Throws when attaching fails. */
function ensureTabView(runtimeId: RuntimeTargetId) {
  const target = state.targets.get(runtimeId);
  const tab = state.tabs.get(runtimeId);
  if (!target || !tab) {
    throw new Error('target is no longer managed');
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
  const devToolsContents = devToolsView.webContents;
  const isCurrentView = () => state.tabs.get(runtimeId)?.view === devToolsView;
  const syncTheme = () => {
    void applyThemeToDevToolsWebContents(devToolsContents);
  };

  rememberInternalWebContents(devToolsContents.id);

  try {
    target.webContents.setDevToolsWebContents(devToolsContents);
  } catch (error) {
    devToolsContents.close();
    throw error;
  }

  state.managerWindow?.contentView.addChildView(devToolsView, 1);
  devToolsContents.on('did-finish-load', () => {
    syncTheme();
    const currentTab = state.tabs.get(runtimeId);
    if (currentTab?.view === devToolsView && currentTab.frontendLoading) {
      currentTab.frontendLoading = false;
      broadcastSnapshot();
    }
  });
  devToolsContents.on('did-navigate-in-page', syncTheme);
  devToolsContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    // -3 is ERR_ABORTED, which also fires when a load is superseded by another navigation.
    if (isMainFrame && errorCode !== -3 && isCurrentView()) {
      failTab(runtimeId, `DevTools failed to load (${errorDescription || errorCode})`);
    }
  });
  devToolsContents.on('render-process-gone', (_event, details) => {
    if (isCurrentView()) {
      failTab(runtimeId, `DevTools crashed (${details.reason})`);
    }
  });
  devToolsContents.on('before-input-event', handleShortcutInput);
  tab.view = devToolsView;
  tab.loaded = true;
  tab.frontendLoading = true;
  syncTheme();

  return devToolsView;
}

function destroyTabView(runtimeId: RuntimeTargetId) {
  const tab = state.tabs.get(runtimeId);
  if (!tab?.view) {
    return;
  }

  // Detach first so events fired while closing are ignored by the view's handlers.
  const view = tab.view;
  tab.view = null;
  tab.loaded = false;
  tab.frontendLoading = false;

  try {
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    view.webContents.close();
  } catch {
    // Best-effort cleanup.
  }
}

function failTab(runtimeId: RuntimeTargetId, message: string) {
  const tab = state.tabs.get(runtimeId);
  if (!tab) {
    return;
  }

  destroyTabView(runtimeId);
  tab.error = message;
  pushNotice('error', `${getTargetLabel(runtimeId)}: ${message}`, runtimeId);
  broadcastSnapshot();
  layoutActiveTabView();
}

/**
 * Attaches the DevTools frontend for an existing tab, or defers it until the target has loaded.
 * Returns false and records the reason on the tab when attaching fails.
 */
function loadTabView(runtimeId: RuntimeTargetId) {
  const targetRecord = state.targets.get(runtimeId);
  const tab = state.tabs.get(runtimeId);
  if (!targetRecord || !tab) {
    return false;
  }

  tab.error = null;
  if (!targetRecord.firstLoaded) {
    targetRecord.pendingOpen = true;
    return true;
  }

  targetRecord.pendingOpen = false;

  try {
    ensureTabView(runtimeId);
  } catch (error) {
    tab.error = `Couldn't attach DevTools (${describeError(error)})`;
    return false;
  }

  clearTabErrorNotices(runtimeId);

  try {
    targetRecord.webContents.openDevTools({ mode: 'detach' });
  } catch {
    // Electron opens the frontend against the custom WebContents when available.
  }

  return true;
}

function openTab(target: TargetLike) {
  const runtimeId = toRuntimeTargetId(target);
  const targetRecord = runtimeId == null ? undefined : state.targets.get(runtimeId);
  if (runtimeId == null || !targetRecord || targetRecord.webContents.isDestroyed()) {
    pushNotice('error', "Can't open DevTools: the target is no longer available.");
    broadcastSnapshot();
    return;
  }

  const isNewTab = !state.tabs.has(runtimeId);
  const previousActiveTabId = state.activeTabId;
  if (isNewTab) {
    state.tabs.set(runtimeId, {
      runtimeId,
      view: null,
      loaded: false,
      frontendLoading: false,
      error: null,
    });
    state.tabOrder.push(runtimeId);
  }

  state.activeTabId = runtimeId;

  if (!loadTabView(runtimeId)) {
    pushNotice(
      'error',
      `${getTargetLabel(runtimeId)}: ${state.tabs.get(runtimeId)?.error}`,
      runtimeId,
    );
    // PRD: a failed open must not leave a new tab behind. Existing tabs keep the error state.
    if (isNewTab) {
      state.tabs.delete(runtimeId);
      state.tabOrder = state.tabOrder.filter((id) => id !== runtimeId);
      state.activeTabId = previousActiveTabId;
    }
  }

  broadcastSnapshot();
  layoutActiveTabView();
}

function activateTab(target: TargetLike) {
  openTab(target);
}

function moveTab(runtimeId: RuntimeTargetId, toIndex: number) {
  if (!state.tabs.has(runtimeId) || !Number.isFinite(toIndex)) {
    return;
  }

  const nextOrder = state.tabOrder.filter((id) => id !== runtimeId);
  nextOrder.splice(Math.max(0, Math.min(nextOrder.length, Math.trunc(toIndex))), 0, runtimeId);
  state.tabOrder = nextOrder;
  broadcastSnapshot();
}

function unloadTab(target: TargetLike) {
  const runtimeId = toRuntimeTargetId(target);
  if (runtimeId == null) {
    return;
  }

  const targetRecord = state.targets.get(runtimeId);
  if (targetRecord) {
    targetRecord.pendingOpen = false;
  }

  destroyTabView(runtimeId);
  broadcastSnapshot();
  layoutActiveTabView();
}

function closeTabsByIds(
  runtimeIds: RuntimeTargetId[],
  fallbackActiveId: RuntimeTargetId | null = null,
) {
  const idsToClose = runtimeIds.filter((runtimeId) => state.tabs.has(runtimeId));
  if (!idsToClose.length) {
    return;
  }

  const activeRemoved = state.activeTabId != null && idsToClose.includes(state.activeTabId);
  for (const runtimeId of idsToClose) {
    const targetRecord = state.targets.get(runtimeId);
    if (targetRecord) {
      targetRecord.pendingOpen = false;
    }

    destroyTabView(runtimeId);
    state.tabs.delete(runtimeId);
    clearTabErrorNotices(runtimeId);
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

function intersectRects(left: Rectangle, right: Rectangle): Rectangle | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const width = Math.min(left.x + left.width, right.x + right.width) - x;
  const height = Math.min(left.y + left.height, right.y + right.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Finds the view hosting `webContents` and returns its rect relative to the window content. */
function findHostViewRect(
  parent: View,
  webContents: WebContents,
  originX = 0,
  originY = 0,
): Rectangle | null {
  for (const child of parent.children) {
    // `getVisible()` only exists on newer Electron versions.
    const { getVisible } = child as View & { getVisible?: () => boolean };
    if (getVisible && !getVisible.call(child)) {
      continue;
    }

    const bounds = child.getBounds();
    const rect: Rectangle = {
      x: originX + bounds.x,
      y: originY + bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
    if (child instanceof WebContentsView && child.webContents.id === webContents.id) {
      return rect;
    }

    const nestedRect = findHostViewRect(child, webContents, rect.x, rect.y);
    if (nestedRect) {
      return nestedRect;
    }
  }

  return null;
}

/**
 * Computes where a target is currently drawn on screen. This uses live view geometry rather than
 * `meta.bounds`, which describes the owner window and goes stale when the app relayouts.
 */
function getSourceScreenRect(webContents: WebContents): Rectangle | null {
  for (const window of BaseWindow.getAllWindows()) {
    if (window === state.sourceHighlight?.window || window.isDestroyed()) {
      continue;
    }

    const content = window.getContentBounds();
    const rect =
      window instanceof BrowserWindow && window.webContents.id === webContents.id
        ? { x: 0, y: 0, width: content.width, height: content.height }
        : findHostViewRect(window.contentView, webContents);
    if (!rect) {
      continue;
    }

    if (!window.isVisible() || window.isMinimized()) {
      return null;
    }

    const visibleRect = intersectRects(rect, { ...content, x: 0, y: 0 });
    return (
      visibleRect && { ...visibleRect, x: content.x + visibleRect.x, y: content.y + visibleRect.y }
    );
  }

  return null;
}

function createSourceHighlight(): SourceHighlight {
  // A bare window without WebContents: it never shows up as a target and cannot take input.
  const window = new BaseWindow({
    show: false,
    frame: false,
    transparent: true,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: false,
  });
  window.setIgnoreMouseEvents(true);

  const fill = new View();
  fill.setBackgroundColor(SOURCE_HIGHLIGHT_FILL);
  window.contentView.addChildView(fill);

  const edges = [new View(), new View(), new View(), new View()] as SourceHighlight['edges'];
  for (const edge of edges) {
    edge.setBackgroundColor(SOURCE_HIGHLIGHT_COLOR);
    window.contentView.addChildView(edge);
  }

  return { window, fill, edges };
}

function clearSourceHighlight() {
  if (state.sourceHighlightTimer != null) {
    clearTimeout(state.sourceHighlightTimer);
    state.sourceHighlightTimer = null;
  }

  // Destroyed rather than hidden, so an idle highlight window never keeps the app alive.
  const highlight = state.sourceHighlight;
  state.sourceHighlight = null;
  if (highlight && !highlight.window.isDestroyed()) {
    highlight.window.destroy();
  }
}

/**
 * Briefly outlines the target's view on screen. Returns false when the target is not currently
 * visible, e.g. its window is hidden or minimized or the view has no on-screen area.
 */
function identifySource(target: TargetLike) {
  const runtimeId = toRuntimeTargetId(target);
  const webContents = runtimeId == null ? undefined : state.targets.get(runtimeId)?.webContents;
  const rect = webContents && !webContents.isDestroyed() ? getSourceScreenRect(webContents) : null;
  if (!rect) {
    clearSourceHighlight();
    return false;
  }

  if (!state.sourceHighlight || state.sourceHighlight.window.isDestroyed()) {
    state.sourceHighlight = createSourceHighlight();
  }

  const { window, fill, edges } = state.sourceHighlight;
  const { width, height } = rect;
  const border = SOURCE_HIGHLIGHT_BORDER;
  window.setBounds(rect);
  fill.setBounds({ x: 0, y: 0, width, height });
  edges[0].setBounds({ x: 0, y: 0, width, height: border });
  edges[1].setBounds({ x: 0, y: height - border, width, height: border });
  edges[2].setBounds({ x: 0, y: 0, width: border, height });
  edges[3].setBounds({ x: width - border, y: 0, width: border, height });
  window.showInactive();

  if (state.sourceHighlightTimer != null) {
    clearTimeout(state.sourceHighlightTimer);
  }
  state.sourceHighlightTimer = setTimeout(clearSourceHighlight, SOURCE_HIGHLIGHT_MS);
  return true;
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

function registerTarget(
  target: WebContents | WebContentsView,
  meta: Partial<TargetMeta> = {},
  autoDetected = false,
) {
  const webContents = 'webContents' in target ? target.webContents : target;
  if (!webContents || typeof webContents.id !== 'number' || webContents.isDestroyed()) {
    return undefined;
  }

  if (state.internalWebContentsIds.has(webContents.id) && !state.options.includeSelf) {
    return undefined;
  }

  state.suppressedTargets.delete(webContents.id);

  const existing = state.targets.get(webContents.id);
  if (existing) {
    existing.meta = {
      ...existing.meta,
      ...buildResolvedMeta(webContents, autoDetected, meta),
    };
    existing.autoDetected = existing.autoDetected && autoDetected;
    broadcastSnapshot();
    return webContents.id;
  }

  const targetRecord: ManagedTargetRecord = {
    runtimeId: webContents.id,
    webContents,
    meta: buildResolvedMeta(webContents, autoDetected, meta),
    autoDetected,
    cleanup: [],
    firstLoaded: Boolean(safeGetUrl(webContents)),
    pendingOpen: false,
  };

  const syncMetadata = () => {
    if (autoDetected && isDevToolsRelatedWebContents(webContents)) {
      unregisterTarget(webContents.id, false);
      return;
    }

    targetRecord.firstLoaded = Boolean(safeGetUrl(webContents));
    targetRecord.meta = buildResolvedMeta(webContents, autoDetected, targetRecord.meta);
    broadcastSnapshot();

    if (targetRecord.pendingOpen && targetRecord.firstLoaded) {
      if (!loadTabView(targetRecord.runtimeId)) {
        const error = state.tabs.get(targetRecord.runtimeId)?.error;
        pushNotice(
          'error',
          `${getTargetLabel(targetRecord.runtimeId)}: ${error}`,
          targetRecord.runtimeId,
        );
      }

      broadcastSnapshot();
      layoutActiveTabView();
    }
  };

  const onDestroyed = () => {
    if (state.tabs.has(targetRecord.runtimeId)) {
      const label = getTargetLabel(targetRecord.runtimeId);
      pushNotice('info', `Closed "${label}": its webContents was destroyed.`);
    }

    unregisterTarget(targetRecord.runtimeId, autoDetected);
  };

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

function unregisterTarget(target: TargetLike, suppress = true) {
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
  if (webContents.isDestroyed()) {
    return false;
  }

  if (state.internalWebContentsIds.has(webContents.id) && !state.options.includeSelf) {
    return false;
  }

  if (isDevToolsRelatedWebContents(webContents)) {
    return false;
  }

  if (state.suppressedTargets.has(webContents.id)) {
    return false;
  }

  return state.options.shouldManageWebContents?.(buildTargetContext(webContents, true)) ?? true;
}

function refreshTargets() {
  for (const webContents of webContentsModule.getAllWebContents()) {
    if (!shouldManageWebContents(webContents)) {
      continue;
    }

    registerTarget(webContents, {}, true);
  }

  broadcastSnapshot();
}

function onWebContentsCreated(_event: unknown, webContents: WebContents) {
  if (!shouldManageWebContents(webContents)) {
    return;
  }

  registerTarget(webContents, {}, true);
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
    registerTarget(
      managerUiView,
      {
        title: 'manager:toolbar',
        type: 'manager-ui',
      },
      false,
    );
    registerTarget(
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
  managerWindow.on('blur', () => closeOverlay({ restoreFocus: false }));
  managerWindow.on('closed', () => {
    state.managerWindow = null;
    state.managerUiView = null;
    state.managerOverlayView = null;
    state.overlayRequest = null;
    state.overlayState = CLOSED_OVERLAY_STATE;
    clearSourceHighlight();
  });

  managerUiView.webContents.on('before-input-event', handleShortcutInput);
  managerOverlayView.webContents.on('before-input-event', handleOverlayShortcutInput);
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
  ipcMain.handle(IPC_CHANNELS.closeTab, (_event: unknown, runtimeId: number) =>
    closeTab(runtimeId),
  );
  ipcMain.handle(IPC_CHANNELS.moveTab, (_event: unknown, runtimeId: number, toIndex: number) =>
    moveTab(runtimeId, toIndex),
  );
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
  ipcMain.handle(
    IPC_CHANNELS.identifySource,
    (_event: unknown, runtimeId: number, reportUnavailable: boolean) => {
      if (!identifySource(runtimeId) && reportUnavailable) {
        pushNotice('info', `"${getTargetLabel(runtimeId)}" isn't visible on screen right now.`);
        broadcastSnapshot();
      }
    },
  );
  ipcMain.handle(IPC_CHANNELS.clearSourceHighlight, () => clearSourceHighlight());
  ipcMain.handle(IPC_CHANNELS.dismissNotice, (_event: unknown, id: number) => dismissNotice(id));
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
    registerTarget,
    unregisterTarget: (target) => unregisterTarget(target, true),
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
      app.on('web-contents-created', onWebContentsCreated);
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
