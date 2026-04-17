# Pre-publish blockers and findings

Актуальный статус подготовки `multiview-devtools` к первой публикации в npm. Документ отражает состояние после hardening-прохода вокруг tarball smoke-test, metadata и CI.

---

## Fixed in HEAD

### Package hygiene

- Добавлены `LICENSE` и `README.md`.
- Удалены legacy root `index.js` и legacy `ui/`.
- `files` в `package.json` теперь явно публикует только `dist/**/*`, `README.md` и `LICENSE`.
- Source maps исключены из npm tarball через `!dist/**/*.map`.
- Для publish path используется `prepack`, который всегда пересобирает `dist` перед `npm pack` / `npm publish`.

### Metadata and docs

- Добавлены `repository`, `homepage`, `bugs`, `keywords`, `author`, `sideEffects`.
- Имя `multiview-devtools` проверено в npm и доступно как unscoped package.
- README документирует текущие ограничения и tested Electron range.

### Verification and automation

- Добавлен отдельный smoke consumer, который ставит именно packed tarball в чистый temp-проект.
- Smoke runner проверяет и `require('multiview-devtools')`, и `import('multiview-devtools')` внутри Electron.
- Добавлен `smoke:pack` и агрегирующий `check:release`.
- Добавлен GitHub Actions workflow для `lint`, `typecheck` и packed tarball smoke на `windows-latest`.

---

## Blocking before first publish

### 1. Packed tarball smoke must stay green

Критичный publish gate теперь формализован: перед первой публикацией обязательно должен проходить `bun run smoke:pack`.

Этот тест подтверждает:

- tarball корректно устанавливается в отдельный Electron consumer;
- runtime находит `dist/renderer/index.html`, `dist/renderer/overlay.html` и `dist/preload/index.js`;
- CommonJS import path работает;
- ESM compatibility entrypoint работает;
- manager реально создаёт окно и видит целевой `WebContentsView`.

Если smoke начинает падать, публикацию блокировать до выяснения причины.

### 2. CI gate must stay green

Публикация без зелёного workflow `release-readiness` не допускается. Минимальный обязательный набор:

- `bun run lint`
- `bun run typecheck`
- `bun run smoke:pack`

### 3. Electron support policy must remain explicit

Текущий пакет использует связку:

- `BaseWindow`
- `WebContentsView`
- `setDevToolsWebContents(...)`

Это означает, что слишком широкий peer range вводит в заблуждение. До первого релиза поддержка должна оставаться консервативной и документированной как tested against Electron `41.x`.

### 4. ESM wrapper is acceptable only while smoke stays green

`dist/index.mjs` по-прежнему является compatibility wrapper над CommonJS build, а не отдельным ESM bundle.

Это допустимо только при двух условиях:

- ESM smoke в packed consumer проходит;
- README не обещает полноценный native ESM build.

Если ESM smoke ломается, это снова становится blocking issue до публикации.

---

## Post-publish hardening

### 1. Real dual-package build

Текущий `index.mjs` остаётся временным решением. После первого релиза стоит перейти на настоящий dual-build (`cjs` + `esm`) через `tsc`/bundler, чтобы убрать зависимость от CJS interop.

### 2. Wider Electron support matrix

Сейчас тестируется только Electron `41.x`. Следующий этап:

- прогон на нескольких major-версиях Electron;
- при необходимости расширение `peerDependencies`.

### 3. Cross-platform CI matrix

Текущий baseline ограничен `windows-latest`. После стабилизации релиза расширить smoke matrix на:

- `ubuntu-latest`
- `macos-latest`

### 4. Bun metadata cleanup

`packageManager: "bun@1.3.7"` пока остаётся как contributor detail. Если появится запрос на более нейтральный contributor workflow, можно пересмотреть это поле отдельно.

---

## Release Checklist

- [x] `LICENSE` и `README.md` присутствуют
- [x] Legacy root artifacts удалены
- [x] npm tarball исключает `*.map`
- [x] `repository` / `homepage` / `bugs` / `keywords` заполнены
- [x] Есть packed tarball smoke-test
- [x] Есть GitHub Actions release gate
- [x] README фиксирует tested Electron range и ограничения API
- [ ] Перед публикацией прогнать `bun run check:release`
- [ ] Убедиться, что workflow `release-readiness` зелёный в GitHub
