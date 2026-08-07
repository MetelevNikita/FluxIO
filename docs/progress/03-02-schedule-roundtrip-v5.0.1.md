# 03.02 — round-trip расписания в FluxIO v5.0.1

Статус: завершено 2026-08-07.

## Реализовано

- сохранение активного Current/Future расписания в `.air` или `.txt`;
- сериализация `start on`, `delay`, типов, хронометража, AGE/LOGO и путей;
- безопасный Electron Save Dialog и запись UTF-8;
- выбор отдельного логотипа либо папки с логотипами;
- выбор папки AGE и сопоставление `0+`, `6+`, `12+`, `16+`, `18+`;
- автоматическое определение AGE по суффиксу имени видео `[16+]`;
- графическая AGE-плашка через FFmpeg с текстовым fallback;
- ручное изменение AGE в каждой строке;
- `Ctrl+A` / `Cmd+A`, множественное выделение и массовые AGE/LOGO операции;
- API и FFmpeg regression tests;
- обновлённый Playlist-макет в Figma.

Figma: секция `FluxIO v5.0.1 · 168-hour Schedule Workflow`, экран
`v5.0.1 · Playlist · Schedule round-trip & bulk actions` (`node 32:2`).

## Формат round-trip

В экспорт попадает только активная вкладка и её текущий порядок. Отключённые
AGE/LOGO не сериализуются. Новый файл снова принимается импортёром FluxIO без
дополнительной конвертации.

## Проверка

```bash
npm run typecheck
npm test
npm run build
```

Инструкция оператору: `docs/schedule-import-engineer-runbook.md`.
