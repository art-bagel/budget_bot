# iOS-клиент

Нативная оболочка вокруг существующего веб-фронта: `WKWebView` на весь экран,
экран ошибки с кнопкой «Повторить» и больше ничего. Смысл фазы 1 — иконка на
домашнем экране и независимость от Telegram, а не переписывание интерфейса.

Вёрстка не дублируется: фронт уже отдаёт `viewport-fit=cover` и считает отступы
через `env(safe-area-inset-*)`, поэтому чёлка и home indicator работают сами.
Сессионный токен лежит в `localStorage`, а хранилище `WKWebView` по умолчанию
персистентное — повторный вход после перезапуска не нужен.

## Сборка

Нужен полный Xcode (Command Line Tools не хватит — нет iOS SDK и симулятора).

Адрес приложения задан в [`Budget/Config.swift`](Budget/Config.swift) —
`https://budget.mrbagel.ru`. Только `https://`: ослаблять App Transport
Security под `http` не нужно.

Если `xcodebuild` ругается на Command Line Tools или на лицензию, это
делается один раз и требует пароля:

```
sudo xcode-select -s /Applications/Xcode.app
sudo xcodebuild -license
```

1. Сгенерируйте проект:
   ```
   cd ios && xcodegen generate
   ```
   `.xcodeproj` не хранится в git: `pbxproj` нечитаемо конфликтует при слиянии.
   После правки `project.yml` команду нужно повторить.

   Team зафиксирована в `project.yml` через `DEVELOPMENT_TEAM`, иначе каждая
   генерация проекта стирала бы подпись и её приходилось бы выбирать заново.
   Этот идентификатор не секрет — он есть в каждом собранном приложении, — но
   привязан к личному Apple ID: при передаче репозитория кому-то ещё его
   нужно заменить на свой.
2. Откройте `ios/Budget.xcodeproj`.
3. Xcode → Settings → Accounts → добавьте свой Apple ID (личная команда,
   без $99).
4. Target `Budget` → Signing & Capabilities → Team = ваша личная команда.
   Если бесплатная учётка ругается на занятый bundle id — поменяйте
   `PRODUCT_BUNDLE_IDENTIFIER` в `project.yml` и перегенерируйте.
5. Подключите iPhone кабелем, выберите его в списке устройств, Run.
6. На телефоне: Настройки → Основные → VPN и управление устройством →
   доверять разработчику.

## Проверка без телефона

Симулятору подпись не нужна — сборка и запуск идут без Apple ID:

```
xcodebuild -project Budget.xcodeproj -scheme Budget -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath DerivedData build
xcrun simctl install booted DerivedData/Build/Products/Debug-iphonesimulator/Budget.app
xcrun simctl launch booted ru.mrbagel.budget
```

## Ограничения бесплатной подписи

- Профиль живёт **7 дней**, потом приложение перестаёт запускаться — лечится
  повторным Run из Xcode.
- Одновременно на устройстве не больше трёх своих приложений.
- Недоступны App Groups. Именно поэтому виджетов здесь нет: без общего
  контейнера расширение не прочитает сессионный токен и не сможет ходить в API.
  Виджеты и Siri Shortcuts — фаза 2, после оплаты $99/год.

## Известные шероховатости

- Внешние ссылки открываются внутри `WKWebView`, а кнопки «назад» нет.
  Сейчас SPA никуда не уходит со своей страницы, так что проблемы не возникает.
- Иконка собрана из `frontend/src/assets/logo.png` обычным `sips` и лежит
  готовым PNG в `Budget/Assets.xcassets`. Если логотип поменяется, иконку
  нужно пересобрать вручную — автоматики тут нет и ради одной картинки
  она не нужна.
