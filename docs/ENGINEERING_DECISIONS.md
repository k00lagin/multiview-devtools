# Multiview DevTools Manager: Engineering Decisions

This document complements the PRD and fixes the engineering decisions that are important before implementation of v1.

## 1. Window Composition

The manager window is built with `BaseWindow` and multiple `WebContentsView` layers owned by the main process.

Layer order:

1. Active DevTools `WebContentsView` instances at the bottom.
2. Manager UI view above them.
3. One reusable full-window overlay `WebContentsView` above everything else.

Key rules:

- The source of truth for targets, tabs, active tab, and overlay state lives in the main process.
- The manager UI and overlay renderers are presentation layers only and communicate with main through internal IPC.
- The overlay is a single reusable view, not one view per popup/menu.
- The overlay is hidden by setting its bounds to `0x0` and shown by stretching it to the full manager window.
- UI renderers send trigger intent and geometry; main decides which overlay to open and where to place it.

This follows the proven `WebContentsView` layering strategy from [WEB_CONTENTS_VIEW_STRATEGY.md](/C:/Git/_probe/multiview-devtools/WEB_CONTENTS_VIEW_STRATEGY.md).

## 2. Target Scope

v1 works only with `WebContentsView` targets.

Out of scope for autodetect:

- `BrowserWindow`
- `BrowserView`
- renderer `<webview>`
- Electron DevTools contents not created by this package

Additional rules:

- Hidden/offscreen status is ignored. A `WebContentsView` is treated like any other target.
- Self-debug is opt-in and applies only to manager UI views owned by this package.
- Internal DevTools-hosting views created by this package must never become recursive targets for deeper DevTools attachment.
- External DevTools-related contents are skipped by autodetect, but explicit manual registration is allowed for advanced cases such as DevTools extension development.

## 3. Public API Direction

The public API is main-process-first.

Consumer-facing renderer APIs are out of scope for v1. Any IPC used by the manager UI or overlay is package-internal.

Draft TypeScript shape:

```ts
import type { WebContents, WebContentsView, Rectangle } from 'electron';

type RuntimeTargetId = number; // webContents.id in v1

type PersistentTargetId = string;

type TargetLike = WebContents | WebContentsView | RuntimeTargetId;

interface TargetMeta {
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

interface TargetContext {
  webContents: WebContents;
  runtimeId: RuntimeTargetId;
  autoDetected: boolean;
  includeSelf: boolean;
}

interface PersistedUiState {
  theme?: 'system' | 'light' | 'dark';
  windowBounds?: Rectangle;
}

interface PersistenceAdapter {
  load?: () => PersistedUiState | Promise<PersistedUiState | undefined> | undefined;
  save?: (state: PersistedUiState) => void | Promise<void>;
}

interface InitDevToolsManagerOptions {
  autoDetect?: boolean;
  autoShow?: boolean;
  includeSelf?: boolean;
  shouldManageWebContents?: (ctx: TargetContext) => boolean;
  resolveTargetMeta?: (ctx: TargetContext) => Partial<TargetMeta> | void;
  persistence?: PersistenceAdapter;
}

interface ManagerTargetInfo {
  runtimeId: RuntimeTargetId;
  meta: TargetMeta;
  autoDetected: boolean;
  suppressed?: boolean;
}

interface ManagerTabInfo {
  runtimeId: RuntimeTargetId;
  loaded: boolean;
  active: boolean;
  meta: TargetMeta;
}

interface DevToolsManager {
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

declare function initDevToolsManager(options?: InitDevToolsManagerOptions): DevToolsManager;
```

Behavioral notes:

- Manual `registerWebContents(...)` is an explicit override and is not re-filtered by autodetect rules.
- Manual `unregisterWebContents(...)` suppresses rediscovery for the current runtime unless the target is explicitly re-registered.
- One target may have at most one workspace tab.
- Re-opening an existing tab activates it and loads it if currently unloaded.

## 4. State Model

### Target Lifecycle

```text
discovered
  -> ignored         (fails autodetect rules)
  -> registered      (passes autodetect or manual register)

registered
  -> suppressed      (manual unregister in current runtime)
  -> removed         (target destroyed)
  -> removed         (filter refresh/rebuild excludes it)

registered
  -> tab-open        (user opens tab)
```

### Tab Lifecycle

```text
absent
  -> opening         (user opens target)

opening
  -> loaded          (DevTools attached successfully)
  -> absent          (attach/open failed; show short error; cleanup partial resources)

loaded
  -> active          (user activates tab)
  -> unloaded        (explicit Unload)
  -> absent          (Close / batch close / target removed)

active
  -> loaded          (another tab activated)
  -> unloaded        (explicit Unload on active tab)
  -> absent          (Close / batch close / target removed)

unloaded
  -> opening         (user activates or reopens tab)
  -> absent          (Close / batch close / target removed)
```

Operational rules:

- `Unload` keeps the tab in the workspace but destroys its DevTools frontend/view.
- `Close` removes the tab from the workspace and unloads any live frontend.
- `Close Left`, `Close Right`, and `Close Others` apply to both loaded and unloaded tabs.
- If a batch close removes the currently active tab, activation moves to the tab on which the context menu was invoked.
- If an active tab is unloaded, it remains the selected tab in unloaded state until another tab is activated or it is reopened.

## 5. Persistence

Default persistence in v1 is intentionally small.

Persisted by default:

- theme
- manager window bounds and position

Not persisted in v1:

- open tabs
- tab order
- active tab
- DevTools session/workspace state

Default storage strategy:

- Store a JSON file named after the package in the current Electron profile directory.
- Recommended default location: `app.getPath("userData")/<package-name>.json`

Custom persistence:

- `initDevToolsManager(...)` accepts a custom persistence adapter via callbacks.
- If a custom adapter is provided, it replaces the default JSON-file behavior.

## 6. Immediate Implementation Boundaries

These boundaries are fixed for v1:

- No built-in telemetry.
- No onboarding UI inside the package runtime.
- No global shortcuts shipped by default.
- No recursive self-debug of package-owned DevTools-hosting views.
- No workspace restore across app restarts.
- No pinning.

## 7. Near-Term Follow-Ups

These are the next documents or decisions worth producing before substantial coding:

1. Overlay IPC contract and payload shapes.
2. Final `TargetMeta` schema.
3. Export map for ESM/CJS package output.
4. Minimal smoke-test matrix for Windows, macOS, and Linux.
