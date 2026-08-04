# Этап 2.5 — Repeat, SCTE-35 planner и macOS icon

Дата завершения: 2026-08-04.

## Результат

- Encoding Monitor получил адаптивное окно 16:9; видео вписывается целиком без crop.
- В Broadcast появилась кнопка `Repeat`. После штатного завершения плейлиста supervisor запускает его заново, увеличивает `loopCount`, а Stop завершает цикл.
- В Playlist добавлен SCTE-35 Marker Planner с clip-relative playhead position, Event ID, Break Start/End, duration, segmentation type и UPID.
- В Broadcast добавлены defaults: command, owner, PID, pre-roll, Event ID, duration, UPID type и repeat ID policy.
- Markers сохраняются в PostgreSQL `PlaylistItem.scte35Markers` через Prisma migration, а SCTE-35 defaults — в JSON encoding profile.
- macOS использует отдельные `icon-mac.svg/png` с full-bleed background; `icon.icns` пересобирается из этого source.

## Архитектурная граница SCTE-35

На момент этапа 2.5 planner только готовил и сохранял metadata. Фактическая выдача cue реализована следующим этапом 2.6 через отдельный TSDuck injector перед UDP/SRT output; RTMP/FLV для этой схемы не поддерживается.

## Проверка

```bash
npm run db:generate
npm run typecheck
npm test
GRUBER_RUN_FFMPEG_TESTS=1 npm test
npm run build
npm run package:desktop
```

FFmpeg integration test дополнительно запускает repeat, дожидается второго цикла и штатно останавливает supervisor. Database integration test проверяет round-trip `repeatPlaylist` и SCTE-35 marker JSON после применения миграции.
