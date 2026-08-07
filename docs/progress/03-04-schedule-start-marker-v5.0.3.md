# 03.04 — стартовый ролик и hot take в FluxIO v5.0.3

Дата завершения: 2026-08-07.

## Результат

В Current Playlist добавлена управляемая точка запуска по границе ролика.
Оператор может заранее назначить ролик через `Start here`, сохранить выбор в
`Save session list` и начать следующий эфир кнопкой `Start from Marker`.

Во время активного эфира действие у ролика меняется на `Take on air`. После
подтверждения media-server:

1. формирует плейлист от выбранного ролика до конца;
2. проверяет encoder, файлы и transport-инструменты до прерывания эфира;
3. корректно останавливает текущие FFmpeg/TSDuck процессы;
4. ждёт их фактического завершения;
5. запускает новый playout на том же настроенном endpoint.

Одновременная передача двух процессов на один endpoint исключена. Переключение
выполнено как управляемый restart, поэтому оно может дать короткий transport gap.

## Приоритеты запуска

1. `Resume Stream` — аварийный checkpoint;
2. `Start from Marker` — ручной стартовый ролик;
3. `Start from beginning` — первый ролик Current Playlist.

Стартовый маркер не является SCTE-35 событием и не экспортируется в `.air/.txt`.

## Изменённые области

- shared contracts: `ScheduleStartMarker` в workspace snapshot;
- web Playlist: marker state, строка `START`, `Start here` и `Take on air`;
- Broadcast: `Start from Marker` и явный обход маркера;
- media API: `POST /api/playout/take`;
- supervisor: preflight, stop-and-wait и последовательный hot restart;
- инженерные runbooks и version metadata.

## Проверка

- TypeScript typecheck всех workspaces;
- unit/integration tests media-server, contracts, setup и launcher;
- production build Electron/web/media-server;
- визуальная проверка Playlist и Broadcast в desktop-sized viewport.
