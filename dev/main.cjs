'use strict';

const { app, BrowserWindow, WebContentsView } = require('electron');
const { initDevToolsManager } = require('../dist/index.js');

const VIEW_GAP = 12;
const VIEW_PADDING = 12;

function buildDemoHtml(label, hue) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${label}</title>
      <style>
        :root {
          color-scheme: dark;
          font-family: "Segoe UI", system-ui, sans-serif;
        }

        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          color: white;
          background:
            radial-gradient(circle at top left, hsla(${hue}, 90%, 62%, 0.42), transparent 36%),
            linear-gradient(135deg, hsl(${hue}, 40%, 16%), hsl(${hue + 24}, 55%, 9%));
        }

        .card {
          width: min(560px, calc(100vw - 40px));
          padding: 28px;
          border-radius: 24px;
          background: rgba(9, 12, 20, 0.54);
          border: 1px solid rgba(255, 255, 255, 0.18);
          box-shadow: 0 22px 64px rgba(0, 0, 0, 0.28);
          backdrop-filter: blur(18px);
        }

        h1 {
          margin: 0 0 8px;
          font-size: 36px;
        }

        p {
          margin: 0 0 18px;
          color: rgba(255, 255, 255, 0.78);
          line-height: 1.55;
        }

        .pill {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.1);
          font-size: 13px;
        }

        .dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: hsl(${hue}, 100%, 70%);
        }
      </style>
    </head>
    <body>
      <main class="card">
        <div class="pill"><span class="dot"></span> WebContentsView demo target</div>
        <h1>${label}</h1>
        <p>This renderer lives in a dedicated WebContentsView so the package can discover and attach DevTools to it independently.</p>
        <p id="clock"></p>
      </main>
      <script>
        const clock = document.getElementById('clock');
        function tick() {
          const now = new Date();
          clock.textContent = 'Updated at ' + now.toLocaleTimeString();
          document.title = '${label} · ' + now.toLocaleTimeString();
        }
        tick();
        setInterval(tick, 1000);
      </script>
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
    leftView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildDemoHtml('Left Panel', 188))}`),
    rightView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildDemoHtml('Right Panel', 24))}`),
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
    manager
      .listTargets()
      .map((target) => [String(target.meta.title), target.runtimeId]),
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
