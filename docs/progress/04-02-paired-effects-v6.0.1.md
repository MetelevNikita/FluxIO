# 04.02 — составные FX BG + per-clip title v6.0.1

Статус: завершено 2026-08-10.

## Реализовано

- карточка эффекта хранит общий background и отдельную рекурсивную папку titles;
- alpha-title сопоставляется с роликом по точному basename без расширения;
- назначение FX сохраняет resolved `backgroundPath` и `titlePath`;
- FFmpeg накладывает BG, затем индивидуальный TITLE в одном диапазоне timeline;
- отсутствие совпадения показывает `TITLE MISSING`, но не останавливает playout;
- `.air/.txt` импорт и экспорт сохраняют оба пути;
- project library, title folder и assignments восстанавливаются через Save session list.

## Проверка

- TypeScript typecheck всех workspaces;
- unit test FFmpeg graph для BG + title + SRT;
- media-server, web и cross-platform setup tests;
- production build всех npm workspaces.
