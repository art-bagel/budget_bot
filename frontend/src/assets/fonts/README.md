# Onest

Шрифт интерфейса. Лежит здесь, а не тянется с `fonts.googleapis.com`:
запрос к чужому домену блокировал первый рендер, а в нативной оболочке
приложение без сети оставалось без шрифта.

- Источник: Google Fonts, `Onest:wght@400..800` (v11)
- Variable-версия: одно начертание на все веса 400–800
- Подмножества: `cyrillic` (15.5 КБ), `latin` (33 КБ); браузер качает их
  независимо по `unicode-range` — он задан в `@font-face` в начале
  `src/styles.css`
- Лицензия: SIL Open Font License 1.1, см. [OFL.txt](OFL.txt)

## Обновление

```bash
curl -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Onest:wght@400..800&display=swap"
```

В ответе — `@font-face` на каждое подмножество со ссылкой на `.woff2`.
Нужны только `cyrillic` и `latin`; скачать их сюда под теми же именами и
сверить `unicode-range` с тем, что записан в `styles.css`.
