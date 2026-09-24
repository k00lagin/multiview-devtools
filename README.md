# multiview-devtools

Tabbed DevTools manager for Electron apps that work with multiple `WebContents` and `WebContentsView` targets.

## Requirements

- Node `>=20`
- Electron `>=30 <42` (peer dependency; smoke-tested against `30.5.1`, `35.7.5`, `41.2.1`)

## Install

```bash
npm install multiview-devtools
# electron is a peer dependency
```

## Usage

Call `initDevToolsManager()` from the Electron main process, after `app.whenReady()`:

```ts
import { app } from 'electron';
import { initDevToolsManager } from 'multiview-devtools';

app.whenReady().then(() => {
  initDevToolsManager(); // autodetects existing WebContents and opens the manager window
});
```

`manager.show()`, `manager.toggle()`, and any method that touches windows must be called after `app.whenReady()` resolves.

## API

### `initDevToolsManager(options?) => DevToolsManager`

Options:

- `autoDetect` (default `true`) — discover existing and future `WebContents` automatically.
- `autoShow` (default `true`) — open the manager window on startup.
- `shouldManageWebContents(ctx)` — filter autodetected targets. Receives `{ webContents, runtimeId, autoDetected }`.
- `resolveTargetMeta(ctx)` — return `Partial<TargetMeta>` to override title/url/etc. shown in the UI.
- `persistence` — custom adapter `{ load?, save? }` for the UI state (`theme`, `windowBounds`). Defaults to an in-app adapter backed by `app.getPath('userData')`.
- `includeSelf` (default `false`) — register the manager's own windows as targets. Useful only when debugging the package itself.

### Manager

Methods accepting `target` accept a `WebContents`, a `WebContentsView`, or a numeric runtime id returned from `listTargets()` / `registerTarget()`.

- `show()`, `hide()`, `toggle()` — control the manager window.
- `listTargets()`, `listTabs()` — current snapshot. Tabs are returned in tab-bar order and carry a `status` (`loading`, `ready`, `unloaded`, or `error` with an `error` message).
- `refreshTargets()` — re-scan all `webContents` (only relevant with `autoDetect`).
- `registerTarget(target, meta?) => runtimeId | undefined` — register a target manually. Returns `undefined` if the `WebContents` is destroyed or filtered out.
- `unregisterTarget(target)` — remove a target and suppress re-autodetection until it is registered again.
- `openTab(target)`, `activateTab(target)`, `unloadTab(target)`, `closeTab(target)`.
- `closeTabsLeftOf(target)`, `closeTabsRightOf(target)`, `closeOtherTabs(target)`.
- `focusSource(target)` — focus the owning window and the source `WebContents`.
- `setMeta(target, meta)` — patch the metadata used by the UI.

## Identifying targets

Hovering a tab, or highlighting a row in the target picker, briefly outlines that target's `WebContentsView` on screen. The tab context menu's **Identify Source** does the same on demand and reports when the target isn't visible (hidden or minimized window, zero-size view). The outline is computed from live view geometry, so it stays correct after the app relayouts.

On Electron versions without `View.getVisible()` (e.g. 30), a view hidden with `setVisible(false)` is still outlined at its last bounds.

## Keyboard shortcuts

Shortcuts work inside the manager window, including while a DevTools tab has focus. Use `Cmd` instead of `Ctrl` on macOS.

- `Ctrl+T` / `Ctrl+K` — open the target picker (`↑`/`↓` to choose, `Enter` to open, `Esc` to close).
- `Ctrl+W` — close the active tab.
- `Ctrl+Tab` / `Ctrl+Shift+Tab`, `Ctrl+PageDown` / `Ctrl+PageUp` — next / previous tab.
- `Ctrl+1` … `Ctrl+8` — go to that tab; `Ctrl+9` — go to the last tab.

These take precedence over DevTools' optional `Ctrl+1…9` panel switching.

## Notes

- Main-process-only. The renderer UI is bundled inside the package.
- Ships both CJS and ESM-compat entrypoints.
- Requires `webContents.setDevToolsWebContents(...)`, which is main-process API.
