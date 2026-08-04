# Этап 2.2 — runtime-метрики, чистые логи и product icon

Дата завершения: 2026-08-04.

## Результат

- Fastify request/access logging отключён полностью;
- terminal получает только важные playout-события и критические ошибки media-service/database;
- подробный FFmpeg log по-прежнему доступен в Broadcast monitor;
- `/api/system/metrics` отдаёт реальную загрузку CPU сервера по дельтам `node:os.cpus()`;
- NET в header показывает фактический bitrate активного программного выхода FFmpeg;
- фиктивная GPU-метрика удалена;
- header обновляет CPU/NET раз в секунду;
- antenna mark из интерфейса стал иконкой окна, Dock/Finder, Windows EXE и Linux package.

## Иконки

Исходник и готовые платформенные assets находятся в `apps/desktop/build`:

- `icon.svg` — векторный исходник;
- `icon.png` — Electron window и Linux;
- `icon.icns` — macOS;
- `icon.ico` — Windows.

На macOS варианты можно пересобрать командой:

```bash
npm run icons -w @gruber/desktop
```

## Проверка

```bash
npm run typecheck
npm test
npm run build
npm run package:desktop:dir
```
