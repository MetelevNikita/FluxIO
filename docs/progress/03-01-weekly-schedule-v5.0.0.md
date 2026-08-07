# 03.01 — недельные расписания в FluxIO v5.0.0

Статус: завершено 2026-08-07.

## Реализовано

- backend parser `.air` / `.txt` с UTF-8 и Windows-1251;
- заголовок `start on … - delay …`, типы movie/chop/clip и плановый
  хронометраж;
- директивы `insertAgeTitle` и `insertLogoTitle`, относящиеся к следующему
  материалу;
- безопасный Electron file picker для файлов расписания;
- раздельный импорт Current/Future и параллельный ffprobe с ограничением до
  восьми файлов;
- 168-часовой coverage monitor с Overrun/Underrun;
- цветные типы материала, удаление, reorder и переключатели AGE/LOGO;
- per-item AGE/LOGO в FFmpeg filter graph до concat и global logo;
- сохранение per-item schedule metadata через PostgreSQL/Prisma;
- миграция `20260807120000_schedule_metadata`;
- API/parser/encoding/FFmpeg regression tests;
- макеты Import & Analyze и Playlist синхронизированы с исходным Figma-файлом
  в секции `FluxIO v5.0 · 168-hour Schedule Workflow`;
- версия desktop/web/server/contracts/setup синхронизирована как v5.0.0.

## Принятые правила

- AGE показывается первые 5 секунд;
- индивидуальный LOGO показывается весь клип;
- delay входит в недельное заполнение;
- предупреждение о неверном типе не запрещает импорт;
- автоматический запуск по `start on` и автоматическая ротация Future → Current
  будут частью rolling scheduler.

## Проверка

```bash
npm run typecheck
npm test
npm run build
```

Результат: typecheck и production build завершены без ошибок, 54 теста
пройдены, 4 аппаратно-интеграционных теста пропущены штатно.

Подробная инструкция инженеру: `docs/schedule-import-engineer-runbook.md`.
