# Стратегия работы с `WebContentsView` и overlay-view в проекте `guest-internet`

## Короткий вывод

Текущая рабочая архитектура проекта строится не вокруг renderer-`<webview>`, а вокруг `WebContentsView`, которыми владеет `main` process.

Окно собирается как набор слоёв внутри `BaseWindow.contentView`:

1. `toolbarView` c `chrome.html` для браузерного интерфейса.
2. Набор tab-view (`WebContentsView`) для реального веб-контента.
3. Один переиспользуемый `overlayView` c `overlay.html` для кастомных меню и попапов поверх всего окна.

Именно эту стратегию имеет смысл переносить в другой проект.

---

## 1. Основная архитектура окна

### Базовое окно

Окно создаётся в `src/main/index.js` через `BaseWindow`, а не через обычный `BrowserWindow`.

Почему это важно:

- `BaseWindow` даёт `contentView`, в который можно явно добавлять несколько `WebContentsView`.
- Это позволяет собрать собственный multi-layer UI браузера без `<webview>` в renderer.

### Слои окна

В проекте используются три типа view:

- `toolbarView`: верхняя панель браузера, загружающая `chrome.html`.
- tab views: каждая вкладка это отдельный `WebContentsView` с реальным сайтом или внутренней страницей.
- `overlayView`: единый полноэкранный слой для контекстных меню, SSL-popup, главного меню, инкогнито-попапа.

Практический смысл:

- chrome живёт отдельно от веб-контента;
- вкладки контролируются из `main`;
- overlay не вмешивается в layout вкладок, а просто временно ложится сверху.

---

## 2. Как создаётся интерфейс браузера

### Toolbar / Chrome

`toolbarView` создаётся один раз при создании окна:

- preload: `src/preload/browser.js`
- renderer page: `src/renderer/chrome.html`
- entry: `src/renderer/src/chrome.js`
- root component: `src/renderer/src/chrome/Chrome.svelte`

`Chrome.svelte` собирает интерфейс из:

- `Titlebar.svelte`
- `Toolbar.svelte`

Внутри titlebar и toolbar находятся:

- список вкладок;
- кнопка новой вкладки;
- drag-and-drop перестановка вкладок;
- адресная строка и навигационные кнопки;
- триггеры кастомных overlay-меню.

Состояние вкладок в chrome не является source of truth. Оно приходит из `main` через IPC `tabs:update`.

### Поток данных для chrome

`main` хранит:

- `tabs: Map<tabId, WebContentsView>`
- `tabsMeta: Map<tabId, meta>`
- `activeTab`

После изменений `main` делает `broadcastTabsUpdate()` и шлёт одно и то же состояние:

- в `toolbarView.webContents`
- в `overlayView.webContents`

На стороне renderer `src/renderer/src/browser_state.svelte.ts` слушает `tabs:update` и обновляет:

- `tabsOrder`
- `activeTab`
- `tabsMeta`

Итог: chrome и overlay только отображают состояние, а не владеют жизненным циклом вкладок.

---

## 3. Как создаётся view для веб-контента

### Каждая вкладка = отдельный `WebContentsView`

В `openTab()` создаётся новый `WebContentsView`:

- preload: `src/preload/web.js`
- partition: временная, эпизодическая сессия

После создания view:

1. view кладётся в `tabs`.
2. view добавляется в `win.contentView` через `addChildView(view, 0)`.
3. Для `webContents` настраиваются обработчики через `initWebview()` и `attachViewEvents()`.
4. Вызывается `loadURL(url)`.

### Что делает `initWebview()`

`initWebview()` настраивает поведение реального веб-контента:

- горячие клавиши;
- геолокацию;
- `setWindowOpenHandler()` для popup/new-tab поведения;
- `session.webRequest` для блокировок;
- custom protocol `favicon://`;
- native context menu через `electron-context-menu`.

Важно: у проекта есть два разных класса popup/context menu:

1. Нативные меню контента страницы.
   Они навешиваются на `webContents` вкладки через `electron-context-menu`.

2. Кастомные браузерные popover/context menu.
   Они рисуются внутри отдельного `overlayView`.

Это нужно не смешивать при переносе архитектуры.

### Как показывается активная вкладка

`updateViewBounds()` управляет видимостью вкладок геометрией:

- активная вкладка получает bounds ниже toolbar;
- неактивные вкладки получают `width: 0, height: 0`.

То есть вкладки не удаляются при переключении, а просто скрываются изменением bounds.

Это даёт:

- быстрое переключение;
- сохранение состояния страницы внутри `webContents`;
- простой контроль z-order.

---

## 4. Как создаются внутренние страницы

Проект использует `index.html` как internal page, которая грузится прямо в tab `WebContentsView`.

Примеры:

- `newtab`
- `settings`
- `blocked`

Это не chrome shell и не overlay layer.

Смысл такой:

- browser chrome живёт в `chrome.html`;
- внутренние браузерные страницы живут внутри tab `WebContentsView`;
- внешний сайт и внутренняя страница вкладки с точки зрения main управляются одинаково: обе грузятся через `view.webContents.loadURL(...)`.

Это сильная часть архитектуры, потому что не нужно городить отдельный механизм рендера для внутренних вкладок.

---

## 5. Overlay: ключевая стратегия проекта

### Главная идея

Вместо множества маленьких overlay-view проект использует один переиспользуемый `overlayView`.

Он:

- создаётся один раз;
- загружает `overlay.html`;
- добавляется в `win.contentView`;
- в обычном состоянии скрывается через `setBounds(... width: 0, height: 0)`;
- при наличии активного overlay растягивается на всё окно.

Это зафиксировано и в IPC: `update-overlay-bounds` теперь legacy no-op, потому что проект ушёл от схемы с отдельными bounds на каждый popup.

### Почему это удобно

- все popover/menus работают в одной координатной системе окна;
- не нужно создавать/уничтожать `WebContentsView` под каждое меню;
- легко закрывать все overlay сразу;
- можно строить сложные меню в Svelte, а не через `Menu.popup()`.

---

## 6. Как открывается overlay

### Триггер из chrome

Компоненты chrome не открывают меню локально. Они отправляют событие в `main`.

Примеры:

- `MainMenuTrigger.svelte`
- `IncognitoMenuTrigger.svelte`
- `SslIndicator.svelte`
- `Tab.svelte` для tab context menu

Они собирают:

- `triggerBounds` через `getBoundingClientRect()`, либо
- точку клика `clientX/clientY`

и вызывают `window.Chrome.handleOverlayTrigger(type, event)`.

### Роль `main`

`main` принимает событие в `ipcMain.handle('handle-overlay-trigger', ...)` и делает три вещи:

1. Ставит `overlayOpenGuard`, чтобы открывающий `mousedown` не закрыл меню мгновенно.
2. Собирает payload через `buildOverlayPayload(type, event)`.
3. Вызывает `openOverlay(type, payload)`.

`buildOverlayPayload()` нормализует позицию:

- main menu и SSL menu опираются на bounds триггера;
- incognito menu якорится справа;
- tab context menu получает явную точку клика и данные вкладки.

Ключевая идея: renderer сообщает факт клика и геометрию, а решение о позиции и типе overlay централизовано в `main`.

---

## 7. Как устроен сам overlay renderer

### Состав

`overlay.html` грузит `src/renderer/src/overlay.js`, который монтирует `Overlay.svelte`.

`Overlay.svelte` держит единый корневой слой и четыре menu-компонента:

- `MainMenu.svelte`
- `IncognitoMenu.svelte`
- `SslMenu.svelte`
- `TabContextMenu.svelte`

### Поведение корневого слоя

`Overlay.svelte`:

- хранит карту `opened` по типам overlay;
- включает pointer-events только если что-то открыто;
- по клику на backdrop просит закрыть все overlay;
- после закрывающей анимации вызывает `window.Chrome.freeOverlay(type)`.

То есть есть два этапа:

1. UI закрывается визуально.
2. `main` снимает overlay из активных типов и снова прячет весь `overlayView`.

Это хорошая схема, потому что анимация не обрывается мгновенным удалением view.

### Открытие/закрытие конкретного меню

Каждый overlay-компонент:

- подписывается на IPC-события `open-*` / `close-*`;
- переключает собственный `open` store;
- позиционируется абсолютно через `left/top` по payload из `main`.

Например:

- `MainMenu.svelte` открывается по `Chrome.onMainMenuOpen`
- `TabContextMenu.svelte` открывается по `Chrome.onTabContextMenuOpen`

Melt UI используется как локальный menu-state/accessibility helper, но фактический orchestration идёт через IPC и `main`.

---

## 8. Как overlay закрывается

Проект использует несколько уровней защиты от "залипания" и случайного мгновенного закрытия:

### 1. `overlayOpenGuard`

После открытия меню `main` помнит `senderId` и короткое время жизни guard.

Это нужно, чтобы тот же `mousedown`, который открыл меню, не считался кликом "снаружи" и не закрыл overlay сразу.

### 2. Закрытие при клике вне overlay

`src/preload/browser.js` вешает глобальные слушатели пользовательских событий и шлёт `browser-interaction`.

Когда `main` получает `mousedown`:

- если overlay открыт;
- и событие пришло не из `overlayView`;

тогда выполняется `triggerOverlaysClose()`.

Иными словами, клик по toolbar или другому не-overlay renderer закрывает активное меню.

### 3. Закрытие по blur окна

При `win.on('blur', ...)` вызывается закрытие overlay.

### 4. Deferred free

`triggerOverlayClose()` сначала шлёт `close-*` в overlay renderer, а только потом, с задержкой, делает fallback cleanup через `freeOverlay()`.

Это защищает от ситуации, когда renderer не успел корректно освободить overlay сам.

---

## 9. Что именно является overlay в этом проекте

К overlay относятся только кастомные браузерные UI-элементы:

- главное меню;
- popover инкогнито;
- SSL-информация;
- контекстное меню вкладки.

Не относятся:

- стандартное контекстное меню внутри веб-страницы;
- popup-окна сайтов, которые открываются через `setWindowOpenHandler()`;
- внутренние страницы вроде settings/newtab.

Это принципиально важно для переноса: overlay-view должен обслуживать browser chrome popovers, а не весь подряд UI.

---

## 10. Popup-окна сайтов: отдельный механизм

В `initWebview()` есть отдельная логика для `window.open()`:

- если Electron считает, что это popup (`details.features` содержит `popup`), разрешается отдельное модальное окно;
- иначе ссылка уходит в новую вкладку через `openTab(...)`.

Это другой тип popup. Он не использует `overlayView`.

Если переносить архитектуру в другой проект, лучше сохранять это разделение:

- browser UI popup -> overlay layer;
- site popup window -> отдельное окно или новая вкладка.

---

## 11. Порядок слоёв и практическая модель

По коду видно следующую намеренную модель слоёв:

1. tab `WebContentsView` находятся внизу;
2. `toolbarView` лежит поверх верхней части окна;
3. `overlayView` при открытии занимает всё окно и лежит выше остальных.

Дополнительно:

- вкладки всегда смещены вниз на `toolbarHeight`;
- overlay использует координаты окна, а не координаты вкладки;
- именно поэтому overlay удобно позиционировать от `getBoundingClientRect()` chrome-элементов.

---

## 12. Актуальная схема против легаси

В репозитории есть старые файлы renderer-only браузера:

- `src/renderer/browser.html`
- `src/renderer/src/main.js`
- `src/renderer/src/Browser.svelte`
- `src/renderer/src/browser/Webview.svelte`

Там используется `<webview>`.

Но текущий рабочий runtime уже не опирается на этот путь:

- `electron.vite.config.mjs` собирает `index.html`, `chrome.html`, `overlay.html`;
- `main` реально загружает `chrome.html` в `toolbarView`;
- вкладки создаются как `WebContentsView` в `main`.

Для другого проекта нужно копировать именно current architecture, а не старую `<webview>`-ветку.

---

## 13. Практическая стратегия для переноса в другой проект

### Рекомендуемый шаблон

1. Создать `BaseWindow`.
2. Создать отдельный `toolbarView` для browser chrome.
3. Каждую вкладку делать отдельным `WebContentsView`, создаваемым в `main`.
4. Держать source of truth вкладок только в `main`.
5. Передавать состояние вкладок в chrome/overlay через IPC.
6. Создать ровно один `overlayView` на всё окно.
7. Не создавать overlay-view под каждое меню.
8. Хранить открытые overlay по типам (`Set`).
9. Показывать overlay через полный bounds окна и скрывать через `0x0`.
10. Пусть chrome посылает только событие-триггер и геометрию, а `main` рассчитывает payload и открывает нужный overlay.
11. Делать закрытие overlay двухфазным: сначала анимация в renderer, потом cleanup в `main`.
12. Отдельно обработать native context menu страницы и popup-окна сайтов.

### Почему это хороший компромисс

- сохраняется строгий контроль над жизненным циклом вкладок;
- UI браузера не зависит от DOM web-страницы;
- overlay-меню легко делать кастомными и анимированными;
- архитектура остаётся расширяемой: можно добавить новый overlay-тип без создания нового `WebContentsView`.

---

## 14. Файлы, которые стоит брать за основу

### Main process

- `src/main/index.js`

Ключевые зоны:

- `initWebview()` и настройка поведения вкладочного `webContents`: примерно `383-585`
- `broadcastTabsUpdate()` и состояние вкладок: примерно `606-615`
- `attachViewEvents()` и синхронизация meta/certificate/loading: примерно `617-694`
- `openTab()`: примерно `696-756`
- `updateViewBounds()`: примерно `899-916`
- `createOverlay()`: примерно `958-977`
- `openOverlay()/triggerOverlayClose()/freeOverlay()`: примерно `979-1021`
- `buildOverlayPayload()`: примерно `1042-1069`
- создание окна и `toolbarView`: примерно `1119-1164`
- IPC для `handle-overlay-trigger`, `close-overlay`, `free-overlay`: примерно `1289-1345`

### Preload

- `src/preload/browser.js`
- `src/preload/web.js`

Ключевые зоны:

- bridge API для chrome/overlay: `src/preload/browser.js`, примерно `4-59`
- прокидывание interaction-событий в `main`: `src/preload/browser.js`, примерно `82-89`
- preload для tab webContents: `src/preload/web.js`, подключается из `src/main/index.js` в районе `703-707`

### Renderer: chrome

- `src/renderer/chrome.html`
- `src/renderer/src/chrome.js`
- `src/renderer/src/chrome/Chrome.svelte`
- `src/renderer/src/chrome/Toolbar.svelte`
- `src/renderer/src/chrome/Titlebar.svelte`
- `src/renderer/src/chrome/Tabs.svelte`
- `src/renderer/src/chrome/Tab.svelte`

Ключевые зоны:

- shell chrome: `src/renderer/src/chrome/Chrome.svelte`, `1-13`
- titlebar layout: `src/renderer/src/chrome/Titlebar.svelte`, `1-46`
- tabs strip и reorder: `src/renderer/src/chrome/Tabs.svelte`, `29-149`, `165-226`
- trigger tab context menu: `src/renderer/src/chrome/Tab.svelte`, `32-42`
- trigger main menu: `src/renderer/src/chrome/MainMenuTrigger.svelte`, `2-6`
- trigger incognito menu: `src/renderer/src/chrome/IncognitoMenuTrigger.svelte`, `4-9`
- trigger SSL menu: `src/renderer/src/chrome/SslIndicator.svelte`, `8-12`

### Renderer: overlay

- `src/renderer/overlay.html`
- `src/renderer/src/overlay.js`
- `src/renderer/src/overlay/Overlay.svelte`
- `src/renderer/src/overlay/MainMenu.svelte`
- `src/renderer/src/overlay/IncognitoMenu.svelte`
- `src/renderer/src/overlay/SslMenu.svelte`
- `src/renderer/src/overlay/TabContextMenu.svelte`

Ключевые зоны:

- bootstrap overlay: `src/renderer/src/overlay.js`, `1-13`
- корневой overlay layer: `src/renderer/src/overlay/Overlay.svelte`, `8-77`
- main menu open/close orchestration: `src/renderer/src/overlay/MainMenu.svelte`, `14-23`
- incognito popover: `src/renderer/src/overlay/IncognitoMenu.svelte`, `12-21`
- SSL popup: `src/renderer/src/overlay/SslMenu.svelte`, `32-39`
- tab context menu: `src/renderer/src/overlay/TabContextMenu.svelte`, `16-67`

### Renderer: shared state

- `src/renderer/src/browser_state.svelte.ts`

Ключевые зоны:

- window state sync: примерно `17-37`
- stores вкладок: примерно `77-79`
- подписка на `tabs:update`: примерно `81-100`
- начальная гидратация tab meta: примерно `102-107`

### Сборка и runtime-страницы

- `electron.vite.config.mjs`

Ключевые зоны:

- renderer entry points: `index.html`, `chrome.html`, `overlay.html` в районе `22-33`
- preload entry points: `browser.js`, `web.js` в районе `9-18`

---

## 15. Итог

Если переносить эту идею в другой проект, то главный принцип такой:

`WebContentsView` должны принадлежать `main`, browser chrome должен быть отдельным view, а все браузерные popover/context menu должны жить в одном переиспользуемом полноэкранном `overlayView`.

Это и есть ключевая стратегия текущего проекта.
