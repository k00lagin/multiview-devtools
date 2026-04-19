# multiview-devtools

Tabbed DevTools manager for Electron apps that work with multiple `WebContents` and `WebContentsView` targets.

## Requirements

- Node `>=20`
- Electron `>=30 <42`

## Install

```bash
npm install multiview-devtools electron@30
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
- Internally it depends on `WebContentsView`, `BaseWindow`, and `webContents.setDevToolsWebContents(...)`.

## Compatibility

> Notice: Electron `29.x` and earlier are out of scope.

- Supported package range: Electron `30.x` through `41.x`.
- Package compatibility is currently constrained to `electron >=30 <42`.
- Release-readiness smoke tests currently run against Electron `30.5.1`, `35.7.5`, and `41.2.1`.

## Packaging

The package exposes CommonJS plus an ESM compatibility entrypoint; it does not currently ship a separate native ESM build.

Published tarballs include built runtime artifacts from `dist/`, plus this `README.md` and `LICENSE`. Source maps are excluded from the npm package to keep the tarball smaller.
