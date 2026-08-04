# Этап 2 — FFmpeg playout, PostgreSQL, logo и packaging

Дата завершения MVP: 2026-08-03.

## Результат

Реализован полный одноканальный вертикальный срез:

1. Electron выбирает локальные видеофайлы/папку.
2. Media-service получает реальный metadata через ffprobe.
3. Пользователь собирает playlist и encoder settings.
4. Optional logo накладывается на program.
5. Start создаёт один realtime FFmpeg pipeline.
6. Ролики идут последовательно в UDP/SRT/RTMP(S).
7. Та же программа отображается через HLS preview.
8. UI показывает current item, progress, FPS, bitrate, speed и logs.
9. Configuration сохраняется в PostgreSQL через Prisma.
10. SRT/RTMP secrets шифруются AES-256-GCM.

## Реализованные deployment-части

- Prisma schema и initial SQL migration;
- интерактивный root setup wizard без Docker;
- systemd, macOS LaunchAgent и Windows Task Scheduler;
- electron-builder для macOS/Linux/Windows targets;
- отдельные development и production runbooks.

## Проверки

```bash
npm run typecheck
npm test
npm run build
npm run package:desktop:dir
```

Дополнительные integration tests:

```bash
GRUBER_RUN_FFMPEG_TESTS=1 npm test
GRUBER_RUN_DATABASE_TESTS=1 npm test
```

FFmpeg integration test формирует два ролика, включая источник без аудио, накладывает logo, отправляет MPEG-TS в loopback UDP и создаёт HLS preview в realtime.

Database integration test применён к реальному временному PostgreSQL: configuration записывается/читается/удаляется, а RTMP key отсутствует в открытом JSON.

## Известные ограничения

- один эфирный канал;
- отсутствие rolling scheduler и failover;
- статические thumbnails в media library;
- HLS preview с задержкой;
- Electron package пока не подписан сертификатом разработчика;
- hardware encoding пока только обнаруживается, но не выбирается pipeline;
- требуется soak-test до 24/7 эксплуатации.
