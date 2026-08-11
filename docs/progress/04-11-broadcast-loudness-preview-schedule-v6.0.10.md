# 04.11 — Broadcast loudness, preview и schedule handover v6.0.10

Статус: завершено 2026-08-11.

## Эфирный звук

В Broadcast → Audio добавлен отключаемый режим programme loudness. При
включении FFmpeg применяет `loudnorm` после объединения всех роликов и до split
в program/preview: target по умолчанию `-23 LUFS`, true peak `-1 dBTP`,
loudness range `7 LU`. Поэтому одинаково нормализуются основной выход и
операторский preview. Настройки сохраняются в переносимом encoding profile.

## Финальный monitor

Program preview формируется отдельной HLS-веткой из финальных composited video
и audio до сетевой упаковки. Он не зависит от жизненного цикла TSDuck. HLS
использует epoch start number, уникальные десятизначные имена segment,
`temp_file` и новую query version при loop/schedule transition, чтобы Electron
не открывал старый manifest после смены выдачи.

## Current → Future

При старте Current media-service получает также Future. После штатного
завершения Current Future автоматически подготавливается и запускается без
операторского Start. UI повышает Future в Current, переносит metadata и очищает
Future. Если включён Repeat, повтор Current имеет приоритет и handover не
выполняется.

Изменения Future во время активного Current синхронизируются в media-service с
debounce, поэтому оператор может загрузить или отредактировать следующую неделю
уже после начала текущего эфира. Encoding Monitor показывает `Future queued`.

В строке ON AIR Playlist отображается оставшееся время текущего ролика.

## DVB subtitles

Legacy default `PTS offset = 1400 ms` заменён на `0 ms`, поскольку основной
FFmpeg MPEG-TS FluxIO работает с `muxdelay=0`. Значение `1400` из старой
workspace session мигрирует в `0`.

После subtitle merge TSDuck запускает `pcrextract` на subtitle PID. Encoding
Monitor показывает количество реально найденных subtitle PES и последний PTS.
Это отделяет пустую PMT-сигнализацию от проблемы декодера или remux головной
станции. Добавлены regression tests для UTF-8 BOM/CRLF SRT, page IDs, merge
command и нового PTS default.

## Splash

Пятисекундный splash переведён на русский язык. Footer показывает текущий год,
версию FluxIO, BroflovskiTeam и безопасно открываемую внешнюю Telegram-ссылку
`@MetelevNikita`.

## Проверка

- `npm run typecheck`;
- `npm test`;
- production build web/contracts/media-server/desktop.
