# Pre-publish blockers and findings

Список проблем, которые стоит устранить перед публикацией `multiview-devtools` на npm. Сгруппировано по важности. Основано на аудите репозитория по состоянию на ветку `master`, коммит `ed062d2`.

---

## 1. Блокирующие (нельзя публиковать без них)

### 1.1. Нет `LICENSE` файла
В `package.json` указано `"license": "MIT"`, но файл `LICENSE` / `LICENSE.md` в репозитории отсутствует. Это нарушение MIT-лицензии (текст лицензии обязан сопровождать код) и нарушает npm best-practice. Нужно добавить файл с полным текстом MIT-лицензии и указанием правообладателя.

### 1.2. Нет `README.md`
Страница пакета на npm рендерит README. Без него страница пустая, и потенциальные пользователи не понимают, что делает пакет и как его подключить. Также `files` в `package.json` явно не перечисляет README/LICENSE — при их появлении в корне `npm pack` включит их автоматически, но лучше выставить явно.

### 1.3. Имя `multiview-devtools` может быть занято на npm
Нужно проверить `npm view multiview-devtools`. Если имя занято — переименовать или использовать scope (`@your-scope/multiview-devtools`) и выставить:
```json
"publishConfig": { "access": "public" }
```

### 1.4. Нет `prepublishOnly` / `prepack` скрипта
Сборка не запускается автоматически перед публикацией. Легко опубликовать устаревший или вообще пустой `dist`. Нужно добавить:
```json
"prepublishOnly": "bun run build"
```
(или `prepack`, если сборка должна происходить и при локальном `npm pack`).

### 1.5. `dist` одновременно в `.gitignore` и закоммичен/присутствует на диске
`.gitignore` содержит `dist/`, но каталог `dist/` физически существует в рабочем дереве и используется скриптами (`dev/main.cjs` импортирует `../dist/index.js`). Это приводит к двусмысленности: собирается ли артефакт локально или из CI, насколько он свежий. Для публикации нужно определить стратегию: собирать в CI при публикации (предпочтительно) и не хранить `dist` в git.

### 1.6. Resolve путей рантайма сломается после `npm install`
В `src/main/manager.ts`:
```ts
function getRuntimeRootDir() {
  return path.resolve(getCurrentDir(), '..');
}
function getRendererEntryPath() {
  return path.join(getRuntimeRootDir(), 'renderer', 'index.html');
}
```
`__dirname` в рантайме (`dist/index.js` как `main`) равен `dist`, но основная логика лежит в `dist/main/manager.js` (`__dirname = dist/main`). Функция `getRuntimeRootDir` предполагает, что точка входа лежит на один уровень ниже `renderer/` — это верно только если вызывается из `dist/main/manager.js` (тогда `dist/main/.. = dist`, а `renderer` действительно находится в `dist/renderer`). В текущем виде работает по совпадению, но логика хрупкая:
- завязана на положение файла после компиляции,
- сломается, если изменить структуру `dist/` или перенести `index.ts` в другое место,
- `dev/main.cjs` импортирует напрямую `../dist/index.js`, тогда `__dirname` отработает из `dist/main` только потому, что `require('./main/manager')` резолвится внутрь `dist/main`.

**Перед публикацией нужно:**
1. Сделать smoke-тест через `npm pack` + `npm install ./multiview-devtools-*.tgz` в чужом Electron-приложении и убедиться, что `manager` реально находит `renderer/index.html` и `preload/index.js`.
2. По возможности заменить эвристику `path.resolve(__dirname, '..')` на более явную:
   ```ts
   const pkgRoot = path.dirname(require.resolve('multiview-devtools/package.json'));
   const rendererEntry = path.join(pkgRoot, 'dist/renderer/index.html');
   ```

---

## 2. Серьёзные проблемы пакета

### 2.1. Legacy `index.js` в корне репозитория
Файл `C:\Git\_probe\multiview-devtools\index.js` — это старый POC-имплементация на CommonJS (~11 KB). Не используется рантаймом (main указывает на `./dist/index.js`), eslint его игнорирует через `ignores: ['...', 'index.js', ...]`. Путает при чтении кода. Нужно удалить.

### 2.2. Legacy `ui/` в корне репозитория
Папка `ui/` содержит старые `manager.html`, `preload.js`, `sprite.svg` от POC. Рантайм грузит UI из `dist/renderer` и preload из `dist/preload`. Удалить или перенести в архив.

### 2.3. `dist/index.mjs` — костыльный ESM wrapper
Файл `scripts/prepare-dist.mjs` пишет:
```js
import pkg from './index.js';
export const initDevToolsManager = pkg.initDevToolsManager;
export default pkg;
```
Это работает через Node CJS↔ESM interop, но:
- это не настоящий dual-package — настоящего ESM bundle нет,
- named import `initDevToolsManager` завязан на `default` CJS-модуля; при изменении формы экспорта сломается молча,
- tree-shaking бессмыслен.
Рекомендация: собирать настоящий ESM через `tsc --module nodenext` во вторую папку или использовать bundler (tsup/unbuild) с двумя форматами.

### 2.4. `files: ["dist"]` не включает LICENSE / README
При появлении файлов в корне они попадут в tarball автоматически, но лучше явно:
```json
"files": ["dist", "LICENSE", "README.md"]
```

---

## 3. Недостающие поля в `package.json`

### 3.1. Нет метаданных для страницы пакета на npm
Отсутствуют: `repository`, `homepage`, `bugs`, `author`, `keywords`.

### 3.2. Нет `publishConfig`
Если пакет будет scoped (`@scope/multiview-devtools`), потребуется:
```json
"publishConfig": { "access": "public" }
```

### 3.3. `engines.bun` нестандартно
```json
"engines": { "node": ">=20.0.0", "bun": ">=1.3.7" }
```
`bun` не является обязательным ранером. Большинство потребителей пакета (Electron-разработчики) используют npm/pnpm/yarn. Поле не мешает публикации, но сбивает с толку. Убрать или перенести в `devEngines`.

### 3.4. `packageManager: "bun@1.3.7"`
Через corepack это жёстко привязывает контрибьюторов к bun. Для dev это допустимо, но если нужен вклад без bun — удалить.

---

## 4. Качество / инфраструктура

### 4.1. Нет тестов
Ни `test` скрипта, ни unit/e2e тестов. PRD (`PRD.md`) явно упоминает smoke-test matrix для Windows/macOS/Linux. Минимум — запускаемый smoke-тест в Electron.

### 4.2. Нет CI
Нет `.github/workflows/*`. Публикация вручную без проверок (lint/typecheck/build) рискует выпустить сломанный tarball.

### 4.3. Source maps раздувают размер пакета
В `dist/renderer/assets`:
- `theme-*.js.map` ~518 KB,
- `overlay-*.js.map` ~33 KB,
- `index-*.js.map` ~27 KB.
В `dist/main/manager.js.map` ~30 KB.
Варианты:
- выключить `sourcemap` в `vite.config.ts` и `tsconfig.build.json` для публикации,
- либо исключить `*.map` из `files` (например `files: ["dist/**/*", "!dist/**/*.map"]`).

### 4.4. Использование `setDevToolsWebContents`
В `src/main/manager.ts` и `index.js` используется `wc.setDevToolsWebContents(devView.webContents)`. Это приватное/недокументированное API Electron, которое регулярно меняется между мажорами. Нужно:
- документировать риск в README,
- зафиксировать протестированные версии Electron,
- иметь регрессионный smoke-тест.

### 4.5. Широкий диапазон peer-версий Electron
```json
"peerDependencies": { "electron": ">=30.0.0" }
```
Фактически требуется связка `BaseWindow + WebContentsView + setDevToolsWebContents`. Имеет смысл:
- сузить до проверенных версий (`>=30 <42`),
- документировать минимальную/максимальную.

### 4.6. Нет `sideEffects: false`
Не критично для main-process пакета, но помогает бандлерам потребителей делать tree-shaking.

### 4.7. Документация публичного API отсутствует
PRD и `ENGINEERING_DECISIONS.md` — внутренние документы, не заменяют README с примером использования. Для npm-страницы требуется хотя бы:
- короткий usage-пример (инициализация `initDevToolsManager`),
- список опций `InitDevToolsManagerOptions`,
- ограничения (только `WebContentsView`, Electron ≥ 30).

---

## 5. Быстрый чек-лист перед публикацией

- [ ] Добавить `LICENSE` (MIT)
- [ ] Добавить `README.md` с usage-примером
- [ ] Проверить доступность имени: `npm view multiview-devtools`
- [ ] Заполнить `repository` / `bugs` / `homepage` / `keywords` / `author`
- [ ] Добавить `"prepublishOnly": "bun run build"`
- [ ] Исправить / подтвердить resolve путей в `manager.ts` (`getRuntimeRootDir`)
- [ ] Удалить legacy `index.js` и `ui/` из корня
- [ ] Явно прописать `"files": ["dist", "LICENSE", "README.md"]`
- [ ] Определить стратегию сборки: `dist` не в git, собирается в CI или через `prepublishOnly`
- [ ] (Опц.) Выключить source maps или исключить `*.map` из tarball
- [ ] (Опц.) Настроить реальный ESM-бандл вместо wrapper-а `index.mjs`
- [ ] Прогнать локально: `npm pack --dry-run` и просмотреть список файлов
- [ ] Smoke-тест: `npm install ./multiview-devtools-0.1.0.tgz` в отдельном Electron-проекте, проверить, что менеджер грузит UI и preload
- [ ] Настроить CI (lint + typecheck + build + smoke-test)
- [ ] Документировать в README поддерживаемые версии Electron и риск использования `setDevToolsWebContents`

---

## 6. Самое опасное

**Пункт 1.6 (resolve путей рантайма)** — пакет собирается и работает из `dev/main.cjs` внутри репозитория, потому что структура `dist/` гарантированно присутствует. После `npm install` в чужом проекте нужно убедиться, что `getRuntimeRootDir()` действительно указывает в `dist/` внутри `node_modules/multiview-devtools/dist`, а не мимо. Проверить обязательно до первой публикации.
