# 03.06 — AGE duration и управление LOGO в Playlist v5.0.5

Дата завершения: 2026-08-07.

## Результат

- При импорте расписания рейтинг берётся из `insertAgeTitle` либо из суффикса
  видео `[0+]`, `[6+]`, `[12+]`, `[16+]`, `[18+]`.
- После выбора AGE-папки рейтинг сопоставляется с подходящей PNG/WebP/JPEG,
  автоматически активируется на ролике и сохраняется вместе с Playlist.
- В Playlist добавлена общая длительность AGE 10–60 секунд. Она применяется к
  Current/Future и передаётся в FFmpeg для показа в начале ролика.
- Экспорт использует `insertAgeTitle {16+} duration {15}`. Старые строки без
  `duration` импортируются как 10 секунд.
- Выбор и параметры channel logo находятся в Playlist: position, width,
  margin и opacity. Карточка Logo Overlay удалена из Broadcast Settings.
- Новый playout не добавляет global overlay: FFmpeg получает только per-item
  logo из Playlist. Старые session snapshots с global logo мигрируют его на
  элементы Current/Future при восстановлении.
- Настройки AGE/LOGO входят в session snapshot и переносимый encoding profile;
  SRT/RTMP secrets по-прежнему не экспортируются.

## Проверка

- `npm run typecheck`;
- `npm test`;
- `npm run build`;
- визуальная проверка Playlist и Broadcast в development UI.
