# Electron Multi-Content-View DevTools Manager (npm Package)

### TL;DR

Electron apps with multiple `webContents` often scatter DevTools windows across the desktop, making debugging cumbersome. The Electron Multi-Content-View DevTools Manager provides a unified manager window for discovering app `webContents` and opening their DevTools in a tabbed workflow from a single interface. It is a developer tool for Electron applications with complex multi-view or multi-window architectures.

---

## Goals

### Product Goals

- Provide a single manager window for discovering and opening DevTools for app `webContents`.

- Reduce time spent switching context and managing separate native DevTools windows.

- Automatically detect app `webContents` with clear default labeling and opt-in customization.

- Keep a clear distinction between detected targets and currently open DevTools tabs.

- Expose enough configuration for real-world app architectures without making manual registration the default path.

### Non-Goals

- This package will not replace Chromium/Electron DevTools functionality.

- This package is not intended for end users or production-facing in-app diagnostics workflows.

- v1 will not provide built-in telemetry, analytics, or usage tracking.

- v1 will not provide in-product onboarding, first-run dialogs, or tutorial messaging.

- v1 will not provide deep integrations for custom or third-party DevTools extensions.

- v1 will not support Electron main-process debugging or inspection of non-`webContents` objects.

---

## User Stories

**Primary Persona: Electron Developer**

- As an Electron developer, I want to discover the active `webContents` in my app from one place, so that I can open the right DevTools quickly.

- As an Electron developer, I want automatic target detection, so that I do not have to register every renderer manually.

- As an Electron developer, I want to control how targets are labeled and filtered, so that the manager stays usable in complex applications.

- As an Electron developer, I want open DevTools tabs to stay alive while I switch between them, so that I can inspect multiple targets efficiently.

- As an Electron developer, I want escape hatches such as manual registration and per-target metadata overrides, so that I can handle edge cases cleanly.

---

## Functional Requirements

- **Core Features (Priority: High)**
  - **Auto-Detection of App Targets:** Dynamically discovers app `webContents` and registers them as detected targets.

  - **Target Registry:** Maintains a live registry of detected targets while the underlying `webContents` exists.

  - **Manager Window:** Opens a single OS window that lets the developer inspect detected targets and work with open DevTools tabs.

  - **On-Demand DevTools Tabs:** A target appears in the open tab bar only after the user explicitly opens it.

  - **Single Tab Per Target:** A detected target may have at most one tab in the workspace at a time.

  - **Persistent Open Tabs:** Once opened, a target's DevTools frontend remains alive until the user closes or unloads that tab.

  - **Loaded vs Unloaded Tabs:** An open tab may remain in the tab bar even when its DevTools frontend has been explicitly unloaded to free resources.

  - **Real-Time Target Updates:** Updates the registry and open tabs live as `webContents` are created, navigated, retitled, reloaded, or destroyed.

- **Tab Metadata & Management (Priority: Medium)**
  - **Target Picker:** Provides a UI for opening a detected target in a new DevTools tab.

  - **Target Search:** Supports lightweight search/filtering within the detected target registry and picker.

  - **Target Metadata:** Displays custom titles and useful identifiers such as `webContents.id`, type, URL/hostname, owner window information, and structural/view metadata such as bounds/position where available.

  - **Target Identity Model:** Uses `webContents.id` as the required runtime identity in v1, while leaving room for optional consumer-provided persistent identifiers for future workspace features.

  - **Tab Operations:** Supports activate, unload, close, focus-source-target, and bulk tab-closing actions for open tabs.

  - **Tab Context Menu:** Open tabs expose a context menu with actions such as Unload, Close, Close Left, Close Right, Close Others, and Focus Source.

  - **Batch Close Semantics:** Close Left, Close Right, and Close Others operate on tab presence in the workspace regardless of whether those tabs are currently loaded or unloaded.

  - **Batch Close Activation Rule:** If the currently active tab is closed by a batch action, activation moves to the tab from whose context menu the batch action was invoked.

  - **Tab Load-State Visibility:** Tabs should visually indicate whether they are currently loaded or unloaded.

  - **Basic Status Visibility:** Targets and tabs should be able to surface short human-readable status/error reasons such as destroyed, filtered, or failed to attach DevTools.

  - **Open Failure Handling:** If DevTools cannot be attached/opened for a target, the package should surface a short error, avoid opening the tab, and clean up any partial resources.

  - **Optional Tab Reordering:** Reordering tabs is desirable but not required for the initial release.

  - **Reordering Scope:** Tab reordering affects only workspace presentation order and does not change target identity, registry semantics, or lifecycle behavior.

  - **Basic UI Preference Persistence:** Persists simple local UI preferences such as theme and manager window bounds/position.

  - **Local Window Shortcuts:** Supports browser-like shortcuts inside the manager window for tab navigation and closing.

- **Advanced & Customization (Priority: Low)**
  - **Autodetect Filtering:** Allows consumers to provide a predicate/filter to decide whether a discovered `webContents` should be managed.

  - **Metadata Resolution:** Allows consumers to provide metadata/title resolution logic for detected targets.

  - **Manual Registration/Unregistration API:** Allows developers to directly register or remove targets as an override or escape hatch.

  - **Manual Override Priority:** Explicit manual registration takes precedence over autodetect filtering.

  - **Manual Unregister Semantics:** Explicit manual unregistration suppresses the target for the current runtime session rather than only removing it once.

  - **Self-Debug Opt-In:** Allows developers to opt in to managing the package's own manager UI views for development of the package itself.

  - **Future Shallow Inspection Mode:** Reserves room for a shallow inspection mode for internal/self-debug views, exposing structural metadata without recursively opening deeper DevTools targets.

  - **Filter Rebuild Semantics:** Changes to filtering configuration may be applied on registry refresh/rebuild rather than continuously on every target mutation.

---

## User Experience

**Entry Point & First-Time User Experience**

- User discovers the package via npm, GitHub, or documentation.

- Installs via `npm install electron-multi-content-devtools`.

- Imports the package in Electron’s main process.

- Minimal setup: calls a single `initDevToolsManager()` function.

- On first use, setup guidance lives in package documentation rather than inside the runtime product.

**Core Experience**

- **Step 1:** Package initializes and starts detecting app `webContents` automatically.
  - Internal DevTools-owned contents are excluded by default.

  - Consumers may customize detection and metadata resolution through configuration.

  - Self-debug for the package's own UI views is opt-in and subject to additional exclusion rules.

- **Step 2:** User opens the manager window via API.
  - Window shows the current DevTools workspace and provides access to the detected target registry through picker/search UI.

  - Detected targets and open tabs are separate concepts in the UI and API.

  - If the current runtime workspace already has open tabs, the manager should restore the last active tab for that runtime session when practical.

- **Step 3:** User opens one or more targets in DevTools tabs through the target picker.
  - Opening a target creates or reuses a dedicated DevTools frontend for that target.

  - Open tabs remain alive while the user switches between them.

  - The picker supports lightweight search by title, id, URL/hostname, and other key metadata.

  - Re-opening a target that already has a tab activates the existing tab and reloads/recreates its DevTools frontend if it is currently unloaded.

  - If opening or attaching DevTools fails, the UI reports the error and no new tab is left behind.

- **Step 4:** User switches tabs as needed.
  - Switching tabs changes which DevTools frontend is visible in the manager window.

  - Focus-source-target is an explicit user action rather than an automatic focus change.

  - The package best-effort attempts to focus the owner window and then the source target when possible.

  - Activating an unloaded tab recreates or reattaches its DevTools frontend as needed.

- **Step 5:** User unloads or closes a tab when it is no longer needed.
  - Unloading a tab frees the DevTools frontend resources for that tab but keeps the tab itself in the tab bar.

  - Closing a tab removes it from the tab bar and unloads its DevTools frontend.

  - The underlying detected target remains in the registry until its `webContents` is destroyed or filtered out.

  - A tab context menu provides explicit tab-management actions such as Unload, Close, Close Left, Close Right, Close Others, and Focus Source.

  - Batch close actions apply to both loaded and unloaded tabs; any live DevTools frontend associated with a removed tab is unloaded as part of the close operation.

- **Step 6:** Target lifecycle updates are reflected live.
  - If a target is destroyed, it is removed from the registry and any open tab for it is closed.

  - If a target reloads or navigates, its metadata and DevTools state are refreshed as gracefully as possible.

  - If a target or tab cannot be opened or attached, the UI should surface a short reason without requiring a full diagnostics panel.

  - If filtering is refreshed and a target no longer qualifies as managed, it is removed from the registry and any associated tab is closed.

- **Step 7:** Simple UI preferences are restored across sessions where supported.
  - Theme and manager window bounds/position may persist locally.

  - Full workspace/session restore for tabs is not part of v1.

**Advanced Features & Edge Cases**

- Handles rapid `webContents` creation/destruction without leaving orphaned targets or tabs.

- Keeps ordinary app targets in scope by default, while excluding DevTools/internal contents unless explicitly opted in for self-debugging.

- Supports manual registration/unregistration as an escape hatch for unusual app architectures.

- v1 excludes recursive targeting of views that host DevTools frontends; future shallow inspection may expose metadata for those views without opening nested DevTools.

**UI/UX Highlights**

- The UI should make the distinction between detected targets and open tabs clear.

- v1 does not require the full detected-target registry to remain permanently visible if picker/search access keeps the model understandable.

- Tab titles should provide useful context without relying on the page title alone.

- The manager window should remain usable with a moderate number of targets and open tabs.

- Accessible keyboard behavior and visual clarity remain important, but advanced workspace features are not part of v1.

- Browser-like shortcuts inside the manager window should feel intuitive for developers.

- Unloaded tabs should remain interactive but appear visually subdued, for example with lower-contrast text.

- Error or unavailable states should be visible in a concise, non-intrusive way.

- Empty states should distinguish between "no detected targets" and "no open tabs yet".

---

## Success Metrics

### Quality Targets

- The package must not include built-in telemetry or analytics.

- Opening the manager window and opening tabs should feel fast enough for normal developer workflows.

- The package should tolerate common `webContents` lifecycle events without leaving broken state in the UI.

- Resource usage should scale reasonably for a moderate number of detected targets and open tabs.

---

## Technical Considerations

### API Direction

- v1 should expose a primary `initDevToolsManager(options)` entry point.

- The initial API direction should cover:
  - autodetect configuration

  - target filtering/predicate configuration

  - metadata/title resolution

  - self-debug opt-in

  - manual `register` / `unregister` overrides

  - manager window controls such as `show`, `hide`, and `toggle`

  - per-target actions such as open/activate/unload/focus-source

  - optional metadata updates for already known targets

- The exact TypeScript signature can evolve during implementation, but the v1 API should stay small, explicit, and main-process-first.

- Consumer-facing renderer APIs are out of scope for v1; any renderer/main IPC used by the manager UI is an internal implementation detail of the package.

- Metadata in the API should be able to represent both ordinary target identity data and richer structural/view metadata when available.

- The model should distinguish between runtime target identity and optional persistent identity supplied by the consumer.

- Manual registration should act as an explicit override rather than being silently re-filtered by autodetect rules.

- Manual unregistration should suppress rediscovery of that target for the current runtime/session unless explicitly re-registered.

### Technical Needs

- Uses Electron APIs for `webContents` enumeration and DevTools management.

- Maintains a registry of detected targets independent from the set of currently open DevTools tabs.

- Creates DevTools frontend views on demand when the user opens a target.

- Keeps opened DevTools frontend views alive until the user closes/unloads them.

- Reacts to target lifecycle events such as creation, destruction, navigation, reload, and title updates.

- Prevents recursive/self-referential DevTools attachment for internal DevTools-hosting views.

- Keeps room in the internal model for richer view-structure metadata that can support future shallow inspection workflows.

### Integration Points

- Integrates with Electron’s main process and developer code for autodetect filtering, metadata resolution, and manual registration overrides.

- Exposes a simple initialization API for default use and a more configurable API for advanced app architectures.

- The host application remains responsible for any app-level or global shortcut integration used to open the manager window.

### Keyboard Shortcuts

- v1 does not provide global shortcuts out of the box.

- Local shortcuts inside the manager window are in scope.

- Initial local shortcuts should include `Ctrl+W`, `Ctrl+Tab`, and `Ctrl+Shift+Tab`.

### Compatibility

- v1 targets Electron 30+.

- Current package support is intended for Electron 30.x through 41.x.

- Electron 29.x and earlier are out of scope for the initial release.

- v1 targets Windows, macOS, and Linux on a best-effort parity basis.

- Some focus, windowing, and native-control behavior may vary by platform.

### Packaging

- The repository may contain source code and tooling intended for package development, including code that requires a build step before use.

- The npm package should publish the built runtime artifacts needed by consumers, not the full development workspace.

- v1 should ship TypeScript typings.

- v1 should provide both ESM and CJS entry points so consumers can choose the import style that fits their Electron app.

- Internal implementation details such as manager UI source, build tooling, and package-private assets should remain hidden behind the public package entry points.

### Data Storage & Privacy

- No built-in telemetry, analytics, or event collection.

- No persistent service-side storage.

- The package may persist simple local UI preferences such as theme and manager window bounds/position.

- v1 does not persist full workspace/session state such as open tabs, tab order, or restored DevTools sessions.

- A possible v2 direction is restoring workspace tabs in an unloaded state, which would require stable persistent identifiers for targets/views across runs.

- The package does not record or transmit DevTools activity; it only manages local UI state and DevTools attachment.

### Scalability & Performance

- Designed for smooth operation with a moderate number of concurrent detected targets and open tabs.

- Persistent open tabs improve switching performance but increase memory/CPU use compared with a single-live-frontend model.

- Explicit tab unloading is part of the v1 resource-management model.

- More advanced tab unloading/eviction strategies can be considered after v1 if resource usage becomes a real issue.

### Potential Challenges

- Handling rapid create/destroy cycles without UI glitches or orphaned targets/tabs.

- Correctly filtering which discovered `webContents` should be managed in varied app architectures.

- Preserving a clear target identity when titles or URLs are unstable.

- Balancing persistent-tab UX against memory/CPU usage in heavier workflows.

- Supporting self-debug scenarios without allowing recursive nesting of DevTools targets.

---

## Milestones & Sequencing

### Project Estimate

- Extra-small: 1–2 days (initial proof)

- Small: 1–2 weeks (alpha and beta)

- Medium: 2–4 weeks (polished v1, feedback loop)

### Team Size & Composition

- Extra-small: 1 person who handles product, engineering, and basic design/ui
  - (Ideal for initial PoC and alpha; community and early adopters handle external feedback.)

### Suggested Phases

**Proof of Concept (2 days)**

- Key Deliverables:
  - Internal demo with dynamic target detection and on-demand DevTools tabs.

  - Core autodetect, target registry, and central manager window logic.

- Dependencies:
  - Electron (30+), minimal demo app for validation.

**Alpha Release (1 week)**

- Key Deliverables:
  - npm package with documented API.

  - Basic manager UI, target picker, auto/manual registration, and tab lifecycle management.

  - Initial error/edge case handling.

- Dependencies:
  - User test group (devs from local team/community); initial feedback channel.

**Beta Release (1 week)**

- Key Deliverables:
  - Enhanced metadata display and target filtering UI.

  - Configurable autodetect filtering and metadata resolution.

  - Accessibility improvements and optional tab reordering.

- Dependencies:
  - Beta testers from 2–4 real-world Electron projects.

**v1.0 Launch (optional — 1 week, can overlap with Beta)**

- Key Deliverables:
  - Polished documentation.

  - Edge-case and cross-platform fixes.

  - Smoke coverage on Windows, macOS, and Linux.

  - Release on npm and GitHub.

- Dependencies:
  - User documentation/readme, logo/basic website.

**Ongoing Iteration**

- Rapid bug fixes and feature additions based on tracked metrics and user feedback.

- Community support and contributions.

---
