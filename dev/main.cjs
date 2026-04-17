'use strict';

const { app, BrowserWindow, WebContentsView } = require('electron');
const { initDevToolsManager } = require('../dist/index.js');

const VIEW_GAP = 12;
const VIEW_PADDING = 12;

function buildDemoHtml(label) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${label}</title>
      <style>
        :root {
          color-scheme: dark;
          font-family: system-ui, sans-serif;
        }

        body {
          margin: 0;
          min-height: 100vh;
          padding: 16px;
          color: #f3f4f6;
          background: #141618;
        }

        .card {
          min-height: calc(100vh - 32px);
          padding: 16px;
          border-radius: 4px;
          background: #1d2024;
          border: 1px solid #30343a;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.16);
        }

        header {
          padding-bottom: 12px;
          border-bottom: 1px solid #30343a;
        }

        h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
        }

        .meta {
          margin-top: 4px;
          color: #b3b8be;
          font-size: 12px;
        }

        .section {
          margin-top: 16px;
        }

        .section-title {
          margin: 0 0 8px;
          font-size: 13px;
          font-weight: 600;
        }

        p {
          margin: 0 0 10px;
          color: #d7dade;
          line-height: 1.5;
        }

        .facts {
          margin: 0;
          padding: 0;
          list-style: none;
          border: 1px solid #30343a;
          background: #181b1e;
        }

        .facts li {
          padding: 10px 12px;
        }

        .facts li + li {
          border-top: 1px solid #30343a;
        }

        .facts strong {
          display: inline-block;
          min-width: 84px;
          color: #b3b8be;
          font-weight: 500;
        }
      </style>
    </head>
    <body>
      <main class="card">
        <header>
          <h2>${label}</h2>
          <div class="meta">Dedicated WebContentsView target</div>
        </header>

        <section class="section">
          <p>This renderer exists so the manager can discover it, register it, and attach a separate DevTools frontend.</p>
          <ul class="facts">
            <li><strong>Role</strong> demo target</li>
            <li><strong>Surface</strong> left/right sandbox panel</li>
            <li><strong>Status</strong> active renderer</li>
          </ul>
        </section>
      </main>
    </body>
  </html>`;
}

function layoutViews(window, leftView, rightView) {
  const bounds = window.getContentBounds();
  const width = bounds.width - VIEW_PADDING * 2 - VIEW_GAP;
  const height = bounds.height - VIEW_PADDING * 2;
  const columnWidth = Math.floor(width / 2);

  leftView.setBounds({
    x: VIEW_PADDING,
    y: VIEW_PADDING,
    width: columnWidth,
    height,
  });

  rightView.setBounds({
    x: VIEW_PADDING + columnWidth + VIEW_GAP,
    y: VIEW_PADDING,
    width: bounds.width - VIEW_PADDING * 2 - VIEW_GAP - columnWidth,
    height,
  });
}

async function createDevSandbox() {
  const window = new BrowserWindow({
    width: 1440,
    height: 860,
    title: 'multiview-devtools demo',
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
  });

  const leftView = new WebContentsView();
  const rightView = new WebContentsView();

  window.contentView.addChildView(leftView);
  window.contentView.addChildView(rightView);

  layoutViews(window, leftView, rightView);
  window.on('resize', () => layoutViews(window, leftView, rightView));

  await Promise.all([
    leftView.webContents.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildDemoHtml('Left Panel'))}`,
    ),
    rightView.webContents.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildDemoHtml('Right Panel'))}`,
    ),
  ]);

  const manager = initDevToolsManager({
    autoDetect: false,
    autoShow: false,
    includeSelf: true,
  });

  manager.show();

  manager.registerWebContents(leftView, {
    title: 'app:left',
    type: 'web-contents-view',
  });
  manager.registerWebContents(rightView, {
    title: 'app:right',
    type: 'web-contents-view',
  });

  const targetIdsByTitle = new Map(
    manager.listTargets().map((target) => [String(target.meta.title), target.runtimeId]),
  );

  const orderedTargets = [
    targetIdsByTitle.get('manager:toolbar'),
    leftView.webContents.id,
    rightView.webContents.id,
    targetIdsByTitle.get('manager:overlay'),
  ].filter((runtimeId) => Number.isFinite(runtimeId));

  for (const runtimeId of orderedTargets) {
    manager.openTab(runtimeId);
  }

  const toolbarRuntimeId = targetIdsByTitle.get('manager:toolbar');
  if (toolbarRuntimeId != null) {
    manager.activateTab(toolbarRuntimeId);
  } else {
    manager.activateTab(leftView);
  }

  window.show();
  window.focus();
}

app.whenReady().then(createDevSandbox);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
