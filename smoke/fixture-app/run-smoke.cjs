'use strict';

const { app, BrowserWindow, WebContentsView } = require('electron');

app.commandLine.appendSwitch('disable-gpu');

const TIMEOUT_MS = 30_000;

function buildTargetHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>fixture target</title>
  </head>
  <body>
    <main>fixture target</main>
  </body>
</html>`;
}

async function runSmoke(mode, loadPackage) {
  let settled = false;
  let fixtureWindow = null;
  let timeoutHandle = null;
  let currentManager = null;

  const state = {
    toolbarLoaded: false,
    overlayLoaded: false,
  };

  const finish = (code, message, error) => {
    if (settled) {
      return;
    }

    settled = true;

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (error) {
      console.error(error);
    }

    if (message) {
      const writer = code === 0 ? console.log : console.error;
      writer(message);
    }

    try {
      fixtureWindow?.destroy();
    } catch {
      // Best-effort cleanup only.
    }

    for (const window of BrowserWindow.getAllWindows()) {
      try {
        if (!window.isDestroyed()) {
          window.destroy();
        }
      } catch {
        // Best-effort cleanup only.
      }
    }

    app.exit(code);
  };

  process.on('uncaughtException', (error) => {
    finish(1, `SMOKE_FAIL:${mode}:uncaughtException`, error);
  });

  process.on('unhandledRejection', (error) => {
    finish(1, `SMOKE_FAIL:${mode}:unhandledRejection`, error);
  });

  timeoutHandle = setTimeout(() => {
    const targetTitles = currentManager
      ? currentManager
          .listTargets()
          .map((target) => target.meta.title)
          .filter((title) => typeof title === 'string')
          .join(',')
      : 'manager-unavailable';
    finish(
      1,
      `SMOKE_FAIL:${mode}:timeout:toolbar=${state.toolbarLoaded}:overlay=${state.overlayLoaded}:targets=${targetTitles}`,
    );
  }, TIMEOUT_MS);

  app.on('web-contents-created', (_event, webContents) => {
    webContents.on(
      'did-fail-load',
      (_loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (isMainFrame === false) {
          return;
        }

        finish(
          1,
          `SMOKE_FAIL:${mode}:did-fail-load:${errorCode}:${errorDescription}:${validatedURL}`,
        );
      },
    );

    webContents.on('did-finish-load', () => {
      const url = webContents.getURL();
      if (url.includes('/dist/renderer/index.html')) {
        state.toolbarLoaded = true;
      }

      if (url.includes('/dist/renderer/overlay.html')) {
        state.overlayLoaded = true;
      }
    });
  });

  await app.whenReady();

  try {
    const pkg = await loadPackage();
    const { initDevToolsManager } = pkg;
    if (typeof initDevToolsManager !== 'function') {
      throw new Error('initDevToolsManager export is missing');
    }

    fixtureWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#111827',
    });

    const view = new WebContentsView();
    fixtureWindow.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
    await view.webContents.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildTargetHtml())}`,
    );

    const manager = initDevToolsManager({
      autoDetect: false,
      autoShow: false,
      includeSelf: true,
    });
    currentManager = manager;

    manager.show();
    manager.registerWebContents(view, {
      title: 'fixture:target',
      type: 'web-contents-view',
    });
    manager.openTab(view);

    const interval = setInterval(() => {
      if (settled) {
        clearInterval(interval);
        return;
      }

      const targetTitles = new Set(
        manager
          .listTargets()
          .map((target) => target.meta.title)
          .filter((title) => typeof title === 'string'),
      );

      if (
        state.toolbarLoaded &&
        state.overlayLoaded &&
        targetTitles.has('manager:toolbar') &&
        targetTitles.has('manager:overlay') &&
        targetTitles.has('fixture:target')
      ) {
        clearInterval(interval);
        finish(0, `SMOKE_OK:${mode}`);
      }
    }, 100);
  } catch (error) {
    finish(1, `SMOKE_FAIL:${mode}:startup`, error);
  }
}

module.exports = {
  runSmoke,
};
