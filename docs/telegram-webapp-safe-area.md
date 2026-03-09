# Telegram WebApp Safe Area Notes

## Проблема

На iPhone внутри Telegram Mini App верхние нативные элементы Telegram (`Закрыть`, меню, status bar) могут визуально наезжать на интерфейс приложения и особенно на модальные окна.

Симптомы:

- верхние карточки или заголовок стартуют слишком высоко;
- модальные окна оказываются прямо под системной шапкой Telegram;
- `contentSafeAreaInset.top` в Telegram ведет себя нестабильно или приходит слишком маленьким;
- обычного `env(safe-area-inset-top)` недостаточно, потому что он учитывает только iOS safe area, но не всю Telegram chrome.

## Что не сработало надежно

- Полагаться только на `env(safe-area-inset-top)`.
- Полагаться только на `Telegram.WebApp.contentSafeAreaInset.top`.

На части клиентов Telegram этого недостаточно: интерфейс все равно остается слишком близко к верхней панели.

## Рабочее решение в проекте

Логика лежит в [telegram.ts](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/frontend/src/telegram.ts).

Мы вычисляем верхний offset так:

1. Берем `contentSafeAreaInset.top`, если Telegram его отдал корректно.
2. Делаем fallback от `safeAreaInset.top + headerHeight`.
3. Применяем минимальный гарантированный верхний offset для Telegram WebApp.

Текущее правило:

- `fallbackHeaderHeight = 52`
- `minimumTelegramTopOffset = 64`

Итог записывается в CSS-переменную:

- `--tg-app-top-offset`

## Где это используется

В [styles.css](/Users/aleksandrkostenko/Desktop/Dev/budget_bot/frontend/src/styles.css):

- основной контейнер `.main`
- модальный backdrop `.modal-backdrop`
- ограничение высоты `.modal-card`

Это важно: если обновлять только основной экран, но не модалки, проблема останется в диалогах при открытой клавиатуре.

## Почему модалки требовали отдельного внимания

У модалок в Telegram WebApp проблема заметнее, потому что:

- они фиксированы поверх всего экрана;
- клавиатура уменьшает visual viewport;
- верхняя chrome Telegram остается поверх;
- без дополнительного top offset карточка диалога визуально конфликтует с верхней панелью.

Дополнительная проблема: при открытой клавиатуре и длинном контенте модалка могла визуально "уезжать" вниз, и нижняя часть перекрывалась клавиатурой.

### Рабочее решение для клавиатуры

Модалка должна вести себя не как блок с `max-height`, а как контейнер с фиксированной доступной высотой по `visualViewport`.

Что сделано:

- в JS обновляются:
  - `--visual-viewport-height`
  - `--visual-viewport-offset-top`
- `.modal-backdrop` привязывается к текущему `visualViewport`
- `.modal-card` получает явную `height`, а не только `max-height`
- `.modal-body` получает:
  - `flex: 1`
  - `min-height: 0`
  - `overflow-y: auto`

Именно связка `height + min-height: 0 + overflow-y: auto` нужна для стабильного внутреннего скролла формы до клавиатуры.

## Что еще было изменено

- Для модальных карточек включено полное скругление снизу и сверху через `border-radius: var(--radius-l)`.
- Высота модалок по-прежнему ограничивается через `--visual-viewport-height`, чтобы они не уезжали под клавиатуру.

## Если проблема повторится

Порядок действий:

1. Проверить реальный вид именно в Telegram на iPhone, а не только в браузере.
2. Если интерфейс слишком низко, уменьшить:
   - `minimumTelegramTopOffset`
   - или `fallbackHeaderHeight`
3. Если интерфейс снова наезжает на верх Telegram, увеличить:
   - `minimumTelegramTopOffset`
   - или `fallbackHeaderHeight`
4. Если проблема только у модалок, а основной экран нормальный:
   - сначала править `.modal-backdrop`
   - и `max-height` у `.modal-card`
   - затем проверить, что у `.modal-card` есть явная `height`
   - а у `.modal-body` есть `min-height: 0`

## Хорошая формулировка для будущих промптов

Если нужно повторно чинить это место, лучше формулировать задачу так:

"Проверь safe area и верхний offset в Telegram WebApp на iPhone. Нужно, чтобы верхняя Telegram chrome не наезжала ни на основной экран, ни на модалки с клавиатурой. Используй fallback, если `contentSafeAreaInset.top` недостаточен, и учитывай `visualViewport` для высоты модалок."
