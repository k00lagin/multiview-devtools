'use strict';

const path = require('path');
const { app, BaseWindow, WebContentsView, ipcMain, webContents: webContentsModule } = require('electron');

// Internal state
const state = {
  initialized: false,
  options: {},
  // Map of wc.id -> { wc, meta, title }
  managed: new Map(),
  managerWindow: null,
  uiView: null,
  devViews: new Map(), // id -> WebContentsView for DevTools frontend
  activeId: null,
};

// Utility: get display title for a WebContents
function getDisplayTitle(wc, meta = {}) {
  if (meta && meta.title) return String(meta.title);
  try {
    if (wc && wc.getTitle) return wc.getTitle();
  } catch { }
  return `wc:${wc.id}`;
}

function sendToManager(channel, payload) {
  if (state.uiView && state.uiView.webContents && !state.uiView.webContents.isDestroyed()) {
    state.uiView.webContents.send(channel, payload);
  }
}
function notifyActive() {
  sendToManager('emd:active', state.activeId);
}

function broadcastList() {
  const list = Array.from(state.managed.values()).map(e => ({
    id: e.wc.id,
    title: e.title,
    meta: e.meta || {},
    url: safeGetURL(e.wc),
    isDestroyed: e.wc.isDestroyed(),
  }));
  sendToManager('emd:list', list);
  notifyActive();
}

function safeGetURL(wc) {
  try { return wc.getURL ? wc.getURL() : ''; } catch { return ''; }
}

function isDevtoolsFrontend(wc) {
  return wc.getURL().startsWith('devtools://devtools/bundled/devtools_app.html');
}

function onWebContentsCreated(_event, wc) {
  // Ignore DevTools and internal
  try {
    if (wc.getType && wc.getType() === 'devtools') return;
  } catch { }
  if (isDevtoolsFrontend(wc)) return;
  registerWebContents(wc);
  wc.once('destroyed', () => {
    unregisterWebContents(wc);
  });
}

function ensureAutodetect() {
  if (state._autodetectSet) return;
  state._autodetectSet = true;
  app.on('web-contents-created', onWebContentsCreated);
  // Register any existing contents on init (when called after ready)
  try {
    for (const wc of webContentsModule.getAllWebContents()) {
      if (wc.getType && wc.getType() === 'devtools') continue;
      if (isDevtoolsFrontend(wc)) continue;
      if (!state.managed.has(wc.id)) registerWebContents(wc);
    }
  } catch { }
}

function createManagerWindow() {
  if (state.managerWindow && !state.managerWindow.isDestroyed()) return state.managerWindow;
  const win = new BaseWindow({
    width: 900,
    height: 600,
    title: 'Electron Multi DevTools Manager',
    backgroundColor: '#0b1017',
    show: true,
    autoHideMenuBar: true,
  });
  state.managerWindow = win;
  win.on('closed', () => { state.managerWindow = null; state.uiView = null; state.devViews.clear(); });

  // UI view occupies full window; draws tabs (26px) and empty state.
  const uiView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'ui', 'preload.js'),
    },
  });
  state.uiView = uiView;
  // NOTE: Child views MUST be added to the window's contentView
  win.contentView.addChildView(uiView, 0);
  const layoutAll = () => {
    const { width, height } = win.getContentBounds();
    uiView.setBounds({ x: 0, y: 0, width, height });
    layoutActiveDevtools();
  };
  // Apply an initial layout immediately (BaseWindow may not emit ready-to-show)
  layoutAll();
  // Also relayout on common events
  win.on('resize', layoutAll);
  win.on('show', layoutAll);
  uiView.webContents.on('did-finish-load', () => layoutAll());
  uiView.webContents.loadFile(path.join(__dirname, 'ui', 'manager.html')).catch(() => { });

  // Show the window explicitly (BaseWindow may not emit ready-to-show)
  try { win.show(); win.focus(); } catch { }
  return win;
}

function ensureDevtoolsViewFor(id) {
  if (state.devViews.has(id)) return state.devViews.get(id);
  const entry = state.managed.get(id);
  if (!entry || !entry.wc || entry.wc.isDestroyed()) return null;
  const devView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Attach devtools frontend to this WebContents
  try { entry.wc.setDevToolsWebContents(devView.webContents); } catch { }
  // Add view above UI (index 1)
  if (state.managerWindow && !state.managerWindow.isDestroyed()) {
    // NOTE: Child views MUST be added to the window's contentView
    state.managerWindow.contentView.addChildView(devView, 1);
  }
  state.devViews.set(id, devView);
  return devView;
}

function destroyDevtoolsFor(id) {
  const view = state.devViews.get(id);
  if (!view) return;
  try {
    // Hide first
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    view.webContents.destroy();
  } catch { }
  state.devViews.delete(id);
  if (state.activeId === id) {
    // If active was destroyed, choose next active (if any) but do not auto-open
    const keys = Array.from(state.devViews.keys());
    state.activeId = keys[0] ?? null;
  }
  layoutActiveDevtools();
}

function layoutActiveDevtools() {
  if (!state.managerWindow || state.managerWindow.isDestroyed()) return;
  const { width, height } = state.managerWindow.getContentBounds();
  const y = 26; // tab bar height
  const h = Math.max(0, height - y);
  for (const [id, devView] of state.devViews) {
    if (!devView) continue;
    if (id === state.activeId) {
      devView.setBounds({ x: 0, y, width, height: h });
      // devView.setAutoResize({ width: true, height: true, horizontal: true, vertical: true }); // deprecated, need to watch for resize events
    } else {
      devView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      // devView.setAutoResize({ width: false, height: false, horizontal: false, vertical: false }); // deprecated
    }
  }
}

function openExclusiveDevTools(targetId) {
  const entry = state.managed.get(targetId);
  if (!entry || !entry.wc || entry.wc.isDestroyed()) return;
  // Defer creation/open until first navigation so title/URL are settled
  if (!entry.firstLoaded) {
    entry.pendingOpen = true;
    return;
  }
  // Ensure devtools view for the active target
  const devView = ensureDevtoolsViewFor(targetId);
  if (entry && entry.wc && !entry.wc.isDestroyed()) {
    try { entry.wc.openDevTools({ mode: 'detach' }); } catch { }
  }
  // Do not close other DevTools; hide via layout only
  layoutActiveDevtools();
}

function wireIPC() {
  if (state._ipcWired) return;
  state._ipcWired = true;
  ipcMain.on('emd:request-list', () => broadcastList());
  ipcMain.on('emd:open-devtools', (_evt, id) => {
    openExclusiveDevTools(Number(id));
  });
  ipcMain.on('emd:activate', (_evt, id) => {
    state.activeId = Number(id);
    openExclusiveDevTools(state.activeId);
    notifyActive();
  });
  ipcMain.on('emd:destroy-devtools', (_evt, id) => {
    destroyDevtoolsFor(Number(id));
  });
  ipcMain.on('emd:refresh', () => broadcastList());
  ipcMain.on('emd:focus', (_evt, id) => {
    const targetId = Number(id);
    const entry = state.managed.get(targetId);
    if (entry && entry.wc && !entry.wc.isDestroyed()) {
      try {
        const bw = entry.wc.getOwnerBrowserWindow?.();
        try { bw?.show(); bw?.focus(); } catch {}
        entry.wc.focus?.();
      } catch {}
    }
  });
}

function initDevToolsManager(options = {}) {
  state.options = options || {};
  if (state.initialized) {
    // idempotent API: still return controls
    return buildAPI();
  }
  state.initialized = true;

  const doInit = () => {
    ensureAutodetect();
    wireIPC();
    if (state.options.autoShow !== false) {
      createManagerWindow();
    }
    broadcastList();
  };

  if (app.isReady()) doInit();
  else app.whenReady().then(doInit);

  return buildAPI();
}

function buildAPI() {
  return {
    registerWebContents,
    unregisterWebContents,
    list: () => Array.from(state.managed.values()).map(e => ({ id: e.wc.id, title: e.title, meta: e.meta })),
    show: () => { const w = createManagerWindow(); w.show(); w.focus(); },
    hide: () => { if (state.managerWindow && !state.managerWindow.isDestroyed()) state.managerWindow.hide(); },
    toggle: () => { const w = createManagerWindow(); if (w.isVisible()) w.hide(); else { w.show(); w.focus(); } },
    openDevToolsFor: (id) => openExclusiveDevTools(Number(id)),
    destroyDevtoolsFor: (id) => destroyDevtoolsFor(Number(id)),
    activate: (id) => { state.activeId = Number(id); openExclusiveDevTools(state.activeId); notifyActive(); },
    layout: () => layoutActiveDevtools(),
    setMeta: (id, meta) => {
      const entry = state.managed.get(Number(id));
      if (entry) { entry.meta = meta || {}; entry.title = getDisplayTitle(entry.wc, entry.meta); broadcastList(); }
    },
  };
}

function registerWebContents(wc, meta = {}) {
  if (!wc || typeof wc.id !== 'number') return;
  // Initialize managed entry
  const entry = {
    wc,
    meta: meta || {},
    title: getDisplayTitle(wc, meta),
    firstLoaded: !!safeGetURL(wc),
    pendingOpen: false,
  };
  state.managed.set(wc.id, entry);

  // Keep title and URL in sync; trigger deferred devtools open on first navigate
  const onDidNavigate = (_event, url) => {
    if (isDevtoolsFrontend(wc)) { unregisterWebContents(wc); return; }
    entry.firstLoaded = true;
    entry.meta = { ...(entry.meta || {}), url: safeGetURL(wc) };
    entry.title = getDisplayTitle(wc, entry.meta);
    broadcastList();
    if (entry.pendingOpen && state.activeId === wc.id) {
      entry.pendingOpen = false;
      openExclusiveDevTools(wc.id);
    }
  };
  const onTitleUpdated = () => {
    try { entry.title = getDisplayTitle(wc, entry.meta); } catch { }
    broadcastList();
  };
  try {
    wc.on('did-navigate', onDidNavigate);
    wc.on('page-title-updated', onTitleUpdated);
  } catch { }

  // if nothing active, pick first registered
  if (state.activeId == null) state.activeId = wc.id;
  broadcastList();
}

function unregisterWebContents(wc) {
  if (!wc) return;
  const id = typeof wc === 'number' ? wc : wc.id;
  if (state.managed.has(id)) {
    state.managed.delete(id);
    // destroy devtools view if exists
    const dv = state.devViews.get(id);
    if (dv) {
      try {
        if (state.managerWindow && !state.managerWindow.isDestroyed()) {
          // Not strictly necessary to remove before destroy, but keep tidy
          // There is no explicit removeChildView prior to destroy; bounds set to 0
          dv.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }
        dv.webContents.destroy();
      } catch { }
      state.devViews.delete(id);
    }
    if (state.activeId === id) {
      // choose next available id
      const first = Array.from(state.managed.keys())[0];
      state.activeId = first ?? null;
    }
    broadcastList();
    layoutActiveDevtools();
  }
}

module.exports = {
  initDevToolsManager,
  registerWebContents,
  unregisterWebContents,
  _state: state,
};

