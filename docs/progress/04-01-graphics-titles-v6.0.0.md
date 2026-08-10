# 04.01 — графика и титры v6.0.0

Статус: завершено 2026-08-10.

## Реализовано

- project Effects library с нативным выбором файлов/папки;
- серверный анализ PNG/WebP/MOV/MP4/M4V/WebM через ffprobe;
- сохранение библиотеки, FX layers и SRT folder в workspace session v2;
- FX selector, chips порядка слоёв и timeline с In/Out handles;
- точное basename-сопоставление video ↔ `.srt` и per-item SRT toggle;
- FFmpeg-composition `SRT → AGE → LOGO → FX`;
- Shift selection, group drag-and-drop и групповые row controls;
- нативный Electron flow для `Add Clip`;
- обратимый `.air/.txt` импорт/экспорт `insertGraphicElement_{…}` и `insertSRT`;
- макеты Playlist и Effects синхронизированы с Figma.

## Проверка

- TypeScript typecheck всех workspaces;
- unit test FFmpeg graph для двух FX-слоёв и SRT burn-in;
- media-server, web и cross-platform setup tests;
- production build всех npm workspaces.
