# Slop audit — multiview-devtools

Audited 2026-09-06 against commit `711b288` (`API tidy up`). This is an investigation and fix proposal, not an implementation. No source, tests, configuration, or existing documents were changed.

## Scope and evidence

The audit covered all 34 implementation, renderer, test, demo, and tooling files under `src/`, `smoke/`, `dev/`, and `scripts/` (4,141 lines), plus root configuration, CI, README, design documents, and recent history. Three subagents independently investigated main-process logic, renderer/contracts, and tests/tooling/docs. The lead reviewer opened the cited code, checked consumers, and consolidated their findings.

`bun run lint` and `bun run typecheck` both passed. A subagent ran two in-memory Bun harnesses against the actual manager module with a stub Electron boundary. Those reproduced stale metadata, invalid active-tab state, retained listeners, uncancelled pending opening, omitted resource cleanup calls, and concurrent persistence saves. These are logic-level reproductions, not live Electron integration tests.

The packed smoke matrix was inspected but not executed: it builds/packages the project, downloads/installs Electron versions, and launches applications. No live UI, native resource measurements, cross-platform behavior, exhaustive dependency-security audit, or generated/dependency implementation audit was performed. The existing untracked `docs/api-review.txt` was read as contextual material and left untouched; its recommendations were independently checked rather than accepted wholesale.

The main diagnosis is duplicated state and incomplete lifecycle ownership, accompanied by small abandoned UI/API remnants. There is no large collection of dead modules or useless unit tests. The existing behavioral gate is too weak, which helps explain why the more consequential patterns survived lint/typecheck.

Effort: **S** = hours; **M** = about a day, sometimes two including native verification. Risk refers to the proposed change, not the existing defect. Priority **P1** means correctness or verification work; **P2** means direct cleanup; **P3** means optional housekeeping. Entries are grouped for review, not a strict implementation sequence.

## Findings at a glance

| ID | Priority | Finding | Effort | Fix risk | Confidence |
|---|---|---|---|---|---|
| 01 | P1 | Smoke success does not prove DevTools or renderer functionality | M | Medium | High |
| 02 | P1 | Visual and main-process tab orders disagree | M | Medium | High |
| 03 | P1 | Computed metadata and explicit overrides are mixed together | M | Medium | High |
| 04 | P1 | Activation wrapper duplicates and contradicts opening | S | Low | High |
| 05 | P1 | Created views, listeners, and IDs lack matching cleanup | M | Medium | High |
| 06 | P1 | Opening failures are reported as loaded tabs | S–M | Medium | High control flow |
| 07 | P1 | Deferred opening survives unload | S | Low | High |
| 08 | P1 | Persistence scheduling does not serialize writes | M | Low–medium | High |
| 09 | P1 | JSON casting substitutes for state validation | S | Low | High |
| 10 | P1 | Refresh is an add/update loop rather than reconciliation | M | Medium | High |
| 11 | P1 | Reinitialization partially replaces configuration | M | Medium | High |
| 12 | P2 | Inert main-process fields, guards, and fallback paths | S | Low–medium | High |
| 13 | P2 | Renderer action wrappers add no behavior | S | Low | High |
| 14 | P2 | Orphaned events, CSS, tokens, and aliases | S | Low | High |
| 15 | P2 | Permissive strings and optional bags weaken TypeScript | S | Low | High |
| 16 | P2 | Async subscription setup can outlive its component | S | Low | High teardown / medium race |
| 17 | P2 | Overlay presentation and derivation are duplicated | S | Low | High |
| 18 | P2 | A smoke assertion checks npm formatting | S | Low | High |
| 19 | P2 | Smoke cases share an uncontrolled Electron profile | S | Low | High |
| 20 | P2 | Current and historical specifications contradict one another | S | Low | High |

## 01 — The smoke test can pass without the core operation working

**Evidence:** `smoke/fixture-app/run-smoke.cjs:157` invokes `openTab()`, but the success predicate at `:172` checks only two HTML load events and three target titles. There is no assertion on `listTabs()`, an attached/open DevTools frontend, Vue mounting, or a round trip through the preload bridge. Autodetection is disabled at `:146`. `package.json:54` uses this smoke as the behavioral release gate.

**Impact:** A no-op `openTab()` could satisfy the pass predicate. An HTML document finishing loading is not proof that its application script mounted or hydrated through IPC. This is the most consequential test weakness; there are no removal-assertion or mock-only tests to delete instead.

**Proposal:** Keep the real packed CJS/ESM/Electron matrix. Add bounded checks for the expected active/loaded tab, actual frontend readiness, and a rendered target title after IPC hydration. Exercise open → unload → reopen → close, and use a fresh process for default autodetection. Add focused regressions for the state defects below, rather than snapshots or tests asserting source text disappeared.

**Effort/risk/confidence:** M / medium due to Electron timing / high. Establish this baseline before broad lifecycle refactoring.

## 02 — Drag reordering creates two incompatible tab orders

**Evidence:** `src/renderer/src/App.vue:39` changes only `visibleOrder`; `:87` sends context-menu intent without order. `src/main/manager.ts:277` computes menu enablement from `state.tabOrder`; `:743` and `:757` calculate close-left/right ranges from it. Single-close fallback also uses that order at `:731`.

**Impact:** With main order `[A,B,C]`, drag C to the front so the UI displays `[C,A,B]`. Close-right on C is disabled even though A and B appear to its right. Other reorderings can close tabs from the wrong visible side. This is a concrete consequence of maintaining an independent presentation copy of authoritative state.

**Proposal:** Send reorder intent to main, update its order, and render that order from snapshots. Only transient drag preview belongs locally. Verify menu enablement, actual removed IDs, and active-tab fallback after reordering. This does not require persisting tab order across restarts.

**Effort/risk/confidence:** M / medium across IPC and closing semantics / high.

## 03 — Metadata uses competing merge rules and stale captured state

**Evidence:** `src/main/manager.ts:201` merges defaults → resolver → overrides. At `:856`, a navigation/title handler supplies the entire previously resolved metadata object as overrides. Re-registration at `:830` instead overlays newly computed metadata on old metadata. `:834` can change `existing.autoDetected`, while callbacks at `:850`, `:856`, and `:865` retain the original `autoDetected` argument.

**Impact:** Old title/URL values override fresh values on navigation, while refresh can erase a custom title set by `setMeta()`. Both behaviors were reproduced. Promoting an automatically detected target to manual registration also leaves its existing callbacks using the old provenance.

**Proposal:** Store caller overrides separately and use one resolution rule everywhere: current defaults → current resolver result → explicit overrides. Make `setMeta()` update those overrides. Read current record provenance inside callbacks. Verify changing source metadata, retaining explicit overrides through refresh, and automatic-to-manual promotion.

**Effort/risk/confidence:** M / medium because precedence is public behavior / high. This improves the model; a net line increase can be appropriate.

## 04 — `activateTab()` is an actively harmful wrapper

**Evidence:** `src/main/manager.ts:628` and `:660` already activate, publish, and lay out during `openTab()`. `:664` calls it and repeats activation/publication/layout unconditionally.

**Impact:** Besides redundant work, the wrapper undoes `openTab()`'s failure rollback. The stub harness observed an empty tab list with a non-null active ID after attachment failure and after activating an unregistered WebContents object.

**Proposal:** Preserve both public names but have activation delegate directly to the same implementation, without the second state mutation. Add a failed-activation regression asserting that selection still names an existing tab or is null.

**Effort/risk/confidence:** S / low / high, reproduced. Approximately 10–11 implementation lines can disappear.

## 05 — Resource registration and cleanup do not match

**Evidence:** `src/main/manager.ts:561` allocates a frontend, then `:575` returns on attachment failure without closing it. `:870` installs a destroyed listener, while cleanup at `:872` covers only the other three listeners. `:1050` drops toolbar/overlay references on window closure without closing their WebContents. `:457` adds internal IDs with no removal path.

**Impact:** Failed opens abandon frontends; repeated registration cycles retain destroyed listeners; closing/reopening the manager abandons obsolete toolbar/overlay renderers. The harness confirmed the omitted closes and two retained destroyed listeners after two registration cycles. Electron explicitly requires owners to close child WebContents when a BaseWindow closes; it does not do this automatically. [Electron resource management](https://www.electronjs.org/docs/latest/api/base-window#resource-management).

**Proposal:** Pair each allocation/listener/internal ID with explicit teardown. Close newly allocated frontends on failed attachment and close obsolete toolbar/overlay WebContents on manager-window closure. Preserve the intentionally retained DevTools tab views used when recreating the window. Use direct cleanup functions, not a lifecycle-management framework.

**Effort/risk/confidence:** M / medium because cleanup order and retained tabs matter / high.

## 06 — “Best effort” opening catches publish success after failure

**Evidence:** `src/main/manager.ts:583` sets loaded before opening. The catch at `:651` swallows an `openDevTools()` failure, and `:657` still marks the tab loaded. The comment describes no recovery operation.

**Impact:** Failure is represented as successful loading, leaving a blank or unusable frontend and forcing later code to accommodate an inaccurate state.

**Proposal:** Commit successful loaded state only after the operation succeeds; consolidate attachment/open failure rollback and close partial resources. Retain the prior valid selection. Expose a concise failure through the internal UI state instead of silently claiming success. Keep best-effort focus/theme operations separate: failure there does not invalidate tab existence.

**Effort/risk/confidence:** S–M / medium because native opening order needs verification / high on control flow; native failure behavior remains to be tested.

## 07 — Deferred opening survives an explicit unload

**Evidence:** `src/main/manager.ts:630` stores `pendingOpen` on the target. `:676` unloads without clearing it; `destroyTabView()` returns early when there is no view at `:591`. The metadata callback at `:859` later consumes the old intent.

**Impact:** Open a target before its first navigation, unload it, then navigate: the supposedly unloaded tab opens anyway. The harness reproduced `loaded: true` and a call to `openDevTools()` after this sequence.

**Proposal:** Cancel pending intent on unload, close, and unregister, and clear it after a completed opening. Start with this narrow fix. If lifecycle work still needs multiple coordinated flags, put opening intent on the tab with a small explicit status; do not add a state-machine dependency.

**Effort/risk/confidence:** S / low / high, reproduced.

## 08 — Persistence has a scheduling flag, but no write coordination

**Evidence:** `src/main/manager.ts:437` starts an async microtask and clears `persistenceScheduled` before awaiting `save()`. `src/main/persistence.ts:23` writes directly to the destination. `manager.ts:958` awaits custom load without handling rejection, while startup's promise is discarded at `:1186`.

**Impact:** Separate resize/move/theme events can overlap writes; the harness observed two unresolved saves in progress simultaneously. Save failures become unhandled rejections. A rejected custom load aborts initialization after the initialized flag is already set. The name suggests stronger coordination than it provides.

**Proposal:** Resolve the adapter once, allow one write at a time, and retain the latest pending state while it runs. Deliberately handle load/save failures. Use temporary-file replacement for default file persistence. Debouncing alone does not serialize async writes. Verify a delayed save followed by newer state, a rejected adapter, and final saved state.

**Effort/risk/confidence:** M / low–medium for adapter compatibility / high. Expect some justified new code.

## 09 — A TypeScript assertion pretends JSON has been validated

**Evidence:** `src/main/persistence.ts:16` casts `JSON.parse()` to `PersistedUiState`. `src/main/manager.ts:959` trusts it, and `:967` uses its bounds to construct a native window.

**Impact:** Syntactically valid JSON with invalid field types bypasses the parse-error fallback. Native window options then receive values the TypeScript type claimed were safe.

**Proposal:** Treat parsed data as `unknown`; accept the three theme values and finite numeric rectangle fields, including usable positive dimensions. Discard invalid fields. A small local validator is sufficient. Cover malformed field values, not just invalid JSON syntax.

**Effort/risk/confidence:** S / low / high.

## 10 — Refresh is a per-item mutation loop with repeated full publication

**Evidence:** `src/main/manager.ts:936` skips targets that fail filtering without removing previously automatic registrations. Each accepted target calls `registerTarget()`, which publishes at `:835` or `:877`; refresh publishes again at `:945`. The current PRD promises filter-based removal at `docs/PRD.md:192`.

**Impact:** Filtered-out existing targets remain registered. For N accepted targets, refresh sends N+1 full snapshots and repeatedly rebuilds/sorts menu data. This mixes low-level registry mutation with user-visible notification.

**Proposal:** Make refresh a reconciliation operation: preserve explicit manual registrations and suppression, remove automatic registrations no longer accepted, update/add accepted targets, then publish once. Separate internal mutation from the public command boundary instead of adding ambiguous `silent` flags everywhere. Verify manual overrides, filtered removal, and final snapshot contents. If scan-only behavior is intended instead, explicitly correct the PRD; do not leave both contracts active.

**Effort/risk/confidence:** M / medium because manual versus automatic provenance matters / high.

## 11 — Initialization silently supports only half of reconfiguration

**Evidence:** `src/main/manager.ts:1160` replaces global options before checking `initialized`. Startup checks captured original options at `:1172` and `:1178`; metadata, filtering, and persistence consult mutable `state.options`. `buildApi()` at `:1123` creates another facade for every call.

**Impact:** Repeated initialization changes some behavior and leaves other settings unchanged. Calls during an awaited load can mix configurations. The module presents one init API while implementing an undocumented partial reconfiguration API.

**Proposal:** Prefer first initialization winning: store one options set and one API object, and return that same instance on repeats. Document the policy. If consumers actually require reconfiguration, specify it explicitly before implementing it. Do not add dispose, multiple managers, or an events framework solely to tidy this singleton.

**Effort/risk/confidence:** M / medium because repeated-call behavior is public / high.

## 12 — Main-process fields and helpers advertise nonexistent flexibility

**Evidence and proposed cuts:**

- `src/main/manager.ts:44` and `:621`: delete internal `ManagedTabRecord.runtimeId`; it is written but never read. The map key supplies identity.
- `manager.ts:214`: stop computing `suppressed` for registered targets. Registration clears suppression at `:826`; unregistration removes the target before adding suppression at `:899`. Listed records cannot produce `true`. Treat removing the exported field at `src/shared/contracts.ts:51` as a compatibility decision, not automatic dead-code deletion.
- `manager.ts:65`, `:66`, `:1074`, and `:1172`: `ipcBound`/`autodetectBound` duplicate the one-shot initialization guard. `wireIpc()` has one callsite inside startup. Remove redundant fields and guard branches after settling item 11.
- `manager.ts:95`: `process.cwd()` fallback is unsupported by the actual output model. `tsconfig.build.json:4` compiles CommonJS; `scripts/prepare-dist.mjs:7` makes ESM import that CommonJS. Use `__dirname` directly and collapse the five-step path-helper chain where it adds no meaning.
- `manager.ts:247`: no caller supplies the optional theme parameter. Remove unused flexibility.
- `manager.ts:422` rebuilds overlay state immediately before `broadcastOverlayState()` does so again at `:412`; opening repeats this too at `:481`. Compute once per publication and reuse it.

**Impact:** Extra state, impossible outputs, and fallback paths inflate the number of cases a reader has to reason about.

**Effort/risk/confidence:** S / low internally, medium for exported-field removal or initialization policy / high. Preserve meaningful asset-path construction and actual suppression behavior.

## 13 — The renderer wraps an already adequate command bridge

**Evidence:** `src/renderer/src/composables/useManagerState.ts:27` defines ten async wrappers, each only awaiting the identically named bridge method. Its sole caller at `src/renderer/src/App.vue:13` uses four. Unused wrappers: `openTab`, `unloadTab`, `closeTabsLeftOf`, `closeTabsRightOf`, `closeOtherTabs`, and `setTheme`. Overlay code already calls the bridge directly at `OverlayApp.vue:43`.

`src/renderer/src/components/ManagerTabBar.vue:223` forwards dragover to the container handler; both child `:502` and ancestor `:473` handle that bubbling event. `:272` forwards dragend to `resetDrag()`.

**Impact:** The extra command layer contributes no validation, state ownership, adaptation, or error handling. The duplicate dragover handler also repeats geometry reads.

**Proposal:** Let the composable own snapshot subscription only; use bridge commands directly. Delete the child dragover binding/forwarder and rely on the container. Bind dragend directly to `resetDrag()`. Preserve preload wrappers: those cross an actual IPC boundary.

**Effort/risk/confidence:** S / low / high. Roughly 50–60 lines are removable across these wrappers and bindings.

## 14 — Abandoned UI contracts and configuration can be deleted

**Evidence and proposed cuts:**

- `TargetPickerOverlay.vue:11`, `ThemeMenuOverlay.vue:11`, `TabContextMenuOverlay.vue:11` under `src/renderer/src/overlay/`: each declares a `close` event that is never emitted. Delete the declarations and the unused parent listeners at `OverlayApp.vue:115`, `:123`, and `:131`.
- `src/renderer/src/styles.css:279` and `:283`: unused `.picker` and `.picker__select--hidden` selectors.
- `src/renderer/src/theme.css:6`, `:12`, `:13`, and their dark/system counterparts: unused `--surface-muted`, `--danger`, and `--tab-bg`; nine declarations total.
- `src/renderer/src/components/ManagerTabBar.vue:465`: unused `tabs-shell--scroll-active` class binding. Keep the `scrollActive` state used by scrollbar visibility.
- `tsconfig.json:19`/`:21` and `vite.config.ts:22`/`:24`: unused `@` and `@renderer` aliases. Keep `@shared`.

**Impact:** These remnants describe features or conventions with no consumers. Repository-wide searches confirmed the absence of live internal uses.

**Proposal:** Delete directly, then typecheck and visually smoke the existing UI. Do not write tests asserting that these names no longer exist.

**Effort/risk/confidence:** S / low / high. No dead Vue component or icon symbol was found.

## 15 — TypeScript is weakened at the places it could help most

**Evidence:** `src/renderer/src/overlay/TabContextMenuOverlay.vue:12` emits an arbitrary string action; `OverlayApp.vue:53` accepts it and silently ignores unknown values at `:73`. `src/shared/contracts.ts:77` permits every request payload field to be absent regardless of menu kind. `ManagerTabBar.vue:139` and `:177` use `Record<string,string>` for CSS instead of Vue's `CSSProperties`. `contracts.ts:117` independently represents `open` and nullable `menu`; theme-picker state also stores both `theme` and identical `selectedTheme` at `manager.ts:340`.

**Impact:** Misspelled commands, invalid request combinations, and inconsistent state combinations compile. Runtime fallback branches compensate for missing contracts. Generic dictionaries discard useful property checking.

**Proposal:** Use a literal tab-action union and exhaustive dispatch; define requests as a discriminated union with required per-kind fields. Use `CSSProperties`. Derive whether a menu is open from its presence, or encode the two valid cases as a union; use one selected theme value. Keep appropriate runtime IPC checks—static types do not validate process messages.

**Effort/risk/confidence:** S / low for internal contracts / high. Most other TypeScript is conventional; loops, plain functions, and `Map` are not evidence of a Python background.

## 16 — Duplicated async subscription setup can escape cleanup

**Evidence:** `src/renderer/src/composables/useManagerState.ts:16` fetches state before subscribing at `:18`. `src/renderer/src/overlay/OverlayApp.vue:80` repeats this and installs a keyboard listener after the await. Cleanup at `useManagerState.ts:23` and `OverlayApp.vue:88` only removes listeners already assigned.

**Impact:** Unmounting while the initial request is pending allows the continuation to install listeners after cleanup. There is also a possible missed-update interval between snapshot capture and subscription. The latter was inferred from ordering, not reproduced in live IPC.

**Proposal:** Establish subscriptions before fetching, ensure a late initial reply cannot overwrite a newer event, and stop async continuation after disposal. Install keyboard listeners synchronously with lifecycle hooks. Test a delayed reply with an intervening update and unmount. No generic event bus is needed.

**Effort/risk/confidence:** S / low / high for teardown ordering; medium for observable update race.

## 17 — Overlay presentation is implemented multiple ways

**Evidence:** Identical position-to-style logic lives at `ThemeMenuOverlay.vue:33`, `TabContextMenuOverlay.vue:15`, and `TargetPickerOverlay.vue:59`; the last uses a template-called function while the others use computed values. `TargetPickerOverlay.vue:20` sorts by ID after main already sorted at `src/main/manager.ts:216`. Tab titles at `ManagerTabBar.vue:506` use nullish fallback; picker/context titles at `TargetPickerOverlay.vue:112` and `TabContextMenuOverlay.vue:21` trim and use truthy fallback.

**Impact:** A whitespace title can look blank in the tab but named in menus. Position changes require three edits. Sorting is duplicated with no differing ordering requirement.

**Proposal:** Use one small pure position-style helper and a consistent display-title rule. Remove the redundant picker sort and make sorted input explicit. Keep the three menu components; a general menu framework would cost more than it saves.

**Effort/risk/confidence:** S / low / high. This is consistency cleanup, not a claimed performance bottleneck.

## 18 — The smoke's version assertion checks npm output style

**Evidence:** `scripts/run-pack-smoke.mjs:130` reads raw fixture manifest text and requires exactly `"electron": "^<version>"` at `:131`.

**Impact:** A correct exact-version install can fail under different npm save-prefix preferences, while a caret entry does not prove the version actually running. This is the clearest low-value assertion in the codebase.

**Proposal:** Replace it with an exact installed-version check from the installed Electron manifest or, preferably, `process.versions.electron` inside the running fixture. Preserve the compatibility matrix and its CJS/ESM sentinels.

**Effort/risk/confidence:** S / low / high.

## 19 — Temporary package installs do not isolate smoke profile state

**Evidence:** `smoke/fixture-app/run-smoke.cjs:145` uses default persistence and never assigns test `userData`. `src/main/persistence.ts:10` uses the application profile. `scripts/run-pack-smoke.mjs:167` cleans only the temporary fixture tree.

**Impact:** Different entrypoints/versions and repeated runs can load existing profile state and leave files outside the test's temporary directory. Starting window bounds/theme depend on prior runs.

**Proposal:** Before readiness, assign a distinct `userData` directory under the temporary fixture for each Electron-version/entrypoint case. This preserves real persistence coverage while making cleanup deterministic. Use an in-memory adapter only for scenarios specifically unrelated to persistence.

**Effort/risk/confidence:** S / low / high by path/control-flow inspection; no profile files were modified by this audit.

## 20 — Historical plans masquerade as current contracts

**Evidence:** `README.md:47` says target-accepting methods accept numeric IDs, but registration accepts only WebContents/View in `src/shared/contracts.ts:129`. README `:51` suggests refresh only matters with autodetect, although the implementation scans independently. `docs/ENGINEERING_DECISIONS.md:27` says WebContentsView-only and excludes BrowserWindow, unlike current README/implementation. `docs/PRD.md:130` gives the wrong package name. Engineering decisions `:240` still lists already-implemented IPC/schema/export-map work as future pre-implementation decisions. The filter-refresh disagreement is tracked in item 10.

**Impact:** Readers and future agents receive incompatible instructions about shipped behavior. An agent can reintroduce obsolete scope while believing it is following the specification.

**Proposal:** Make the current API reference explicit, document registration's exception and actual refresh behavior, fix the install name, and mark superseded planning sections as historical or update them. Preserve rationale. Do not treat the donor-project strategy document or the user's untracked API review as current implementation requirements.

**Effort/risk/confidence:** S / low for documentation; behavior changes belong in their own reviewed work / high.

## Optional simplifications, separate from defects

**O1 — Reduce scrollbar bookkeeping without discarding its design.** `src/renderer/src/components/ManagerTabBar.vue:22` stores three derived booleans alongside three measurements; `:49` assigns all six manually. Derive edge/overflow flags from measured values. The deep watcher at `:448` traverses unrelated metadata and adds `nextTick` despite `flush: 'post'`; use one post-render update path with relevant dependencies. Effort S–M, risk medium, confidence high in redundancy but no measured performance claim. The custom scrollbar was recent deliberate work; replacing it with native CSS is only an option if its interaction/appearance requirements can be retained, not an automatic deletion recommendation.

**O2 — Consider replacing cleanup-only `rimraf`.** `package.json:47` uses it solely for `dist`; `:70` declares it. The project already uses native `fs.rm` with retries at `scripts/run-pack-smoke.mjs:168`. A native fixed-directory cleanup can remove this dependency, preserving Windows retry behavior. Effort S, risk low–medium, confidence high in scope but medium in priority. There is no evidence of a broader unused-dependency pile.

## What should remain

- The main-process source of truth, reusable overlay WebContentsView, zero-size hidden views, and retained DevTools tabs are documented design choices.
- The ESM compatibility shim, public export barrel, CJS/ESM fixture entrypoints, Electron launcher, and preload adapters have real boundary responsibilities.
- Small picker/empty-state components, SVG sprite reuse, and plain object conversion for DOMRect are useful.
- Target metadata extensibility and `persistentId` are documented consumer-facing choices. Lack of a built-in persistent-ID resolver is not evidence that these fields are dead.
- Best-effort title/URL/focus/theme operations are reasonable at Electron boundaries. The failure-as-success opening path is the specific exception worth fixing.
- Repeated dark/system CSS supports different theme modes; consolidating all of it is not worth redesigning theme handling.
- No removal-assertion tests, mock-only filler tests, dead Vue components, unused icons, or disconnected root scripts were found.
- The manager's 1,192 lines mix many responsibilities, but splitting it first would relocate defects. After the state fixes, pure metadata and overlay construction are sensible small extraction candidates. No classes, generic dispatcher, plugin system, or new state-management library are needed.

## Proposed execution order and verification

1. **Strengthen the current behavioral gate:** items 01, 18, and 19. Keep the packaged compatibility tests; replace the one formatting assertion and add a few actual outcomes. This is the prerequisite for native lifecycle changes.
2. **Land safe deletions independently:** items 13 and 14, plus clearly inert internal fields/path fallback from 12. Run `bun run lint`, `bun run typecheck`, and the improved `bun run smoke:pack`. No tests whose purpose is to prove text was deleted.
3. **Repair tab transitions and resource ownership:** items 04–07 and 02. Cover failed activation/opening, deferred opening cancelled by unload, listener cleanup, window recreation, and reorder followed by close-left/right. Keep native verification for actual WebContents ownership and DevTools readiness.
4. **Unify registry and configuration behavior:** items 03, 10, and 11. Cover navigation/title refresh, explicit override retention, manual promotion, filter exclusion, suppression, and repeated initialization. Remove redundant binding guards only after the init policy is settled.
5. **Harden async boundaries and simplify internal contracts:** items 08, 09, 15, and 16; then item 17. Use delayed/rejecting adapters and delayed bridge responses to exercise the actual failure modes. Validate malformed persistence data. Avoid asserting incidental helper calls or implementation layout.
6. **Reconcile documentation and consider optional housekeeping:** item 20 and O1/O2. Update each affected contract alongside its implementation; final documentation cleanup resolves the remaining historical contradictions.

The release command is `bun run check:release` (lint → typecheck → packed smoke). Renderer/package integration is exercised by `bun run smoke:pack`, whose `npm pack` invokes the build. `bun run format:check` exists but was not run during this audit. A focused new regression runner should be wired into release readiness once added; there is currently no unit-test script to pretend already exists.

Safe cleanup should remove approximately **100–150 implementation/configuration lines**, excluding generated files, lockfile churn, and optional scrollbar replacement. This is a rough estimate, not a measured patch. Correct resource cleanup, validation, and regression coverage will add worthwhile code, so the final repository-wide diff need not be negative.

**Deletion estimate: net −100–150 lines possible in the cleanup-only slice.**
