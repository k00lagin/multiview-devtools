# multiview-devtools

Tabbed DevTools manager for Electron apps that work with multiple `WebContents` and `WebContentsView` targets.

## Requirements

- Electron `>=30`
- Node `>=20`

## Install

```bash
npm install multiview-devtools electron
```

## Usage

Call `initDevToolsManager()` from the Electron main process:

```ts
import { app, BrowserWindow, WebContentsView } from 'electron';
import { initDevToolsManager } from 'multiview-devtools';

async function main() {
  await app.whenReady();

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
  });

  const view = new WebContentsView();
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });

  await view.webContents.loadURL('https://example.com');

  const manager = initDevToolsManager({
    autoDetect: true,
    autoShow: false,
    resolveTargetMeta({ webContents }) {
      return {
        title: webContents.getTitle() || `wc:${webContents.id}`,
      };
    },
  });

  manager.show();
}

void main();
```

## API

`initDevToolsManager(options?)`

Options:

- `autoDetect`: automatically discover app `webContents`. Default: `true`.
- `autoShow`: open the manager window on startup. Default: `true`.
- `includeSelf`: include the manager's own internal views for package development. Default: `false`.
- `shouldManageWebContents(ctx)`: filter autodetected targets.
- `resolveTargetMeta(ctx)`: provide custom labels and metadata.
- `persistence`: custom adapter for loading and saving simple UI state.

Returned manager methods:

- `show()`, `hide()`, `toggle()`
- `refreshTargets()`
- `listTargets()`, `listTabs()`
- `registerWebContents(target, meta?)`
- `unregisterWebContents(target)`
- `openTab(target)`, `activateTab(target)`, `unloadTab(target)`, `closeTab(target)`
- `closeTabsLeftOf(target)`, `closeTabsRightOf(target)`, `closeOtherTabs(target)`
- `focusSource(target)`
- `setMeta(target, meta)`

## Notes

- The package is main-process-first. Its renderer UI is bundled internally.
- The manager is designed around `WebContentsView`-based workflows and Electron's modern multi-view APIs.
- Internally it relies on `webContents.setDevToolsWebContents(...)`, which is not a prominently documented Electron API. Test against the Electron major versions you plan to support.

## Packaging

Published tarballs include built runtime artifacts from `dist/`, plus this `README.md` and `LICENSE`. Source maps are excluded from the npm package to keep the tarball smaller.
