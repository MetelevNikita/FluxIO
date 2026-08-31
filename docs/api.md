# API media-service

Base URL по умолчанию: `http://127.0.0.1:4310`. Формы body/response определены
в `packages/contracts/src/index.ts` и `scene.ts`. Клиентский HTTP находится
только в `apps/web/src/media-api.ts`.

## Общие правила

- JSON body: `Content-Type: application/json`.
- Validation error/preflight: 400 `{ "error": "..." }`.
- Conflict active playout: 409.
- Missing resource: 404.
- PostgreSQL not configured: 503.
- Large playlist/workspace routes принимают до 32 MiB.
- CORS разрешён local Electron/localhost, authentication отсутствует.

## System

| Method | Route | Ответ |
|---|---|---|
| GET | `/api/health` | service/version/apiVersion/status/startedAt |
| GET | `/api/capabilities` | FFmpeg version, encoders и filters |
| GET | `/api/system/metrics` | CPU, network Mbps, timestamp |
| GET | `/api/system/network-interfaces` | host adapters |

`ready` означает configured database, `degraded` — service работает без
persistence.

## Media и preview

| Method | Route | Schema/назначение |
|---|---|---|
| POST | `/api/media/probe` | `probeMediaRequestSchema`, analyze paths |
| POST | `/api/media/scan` | `scanMediaRequestSchema`, scan directory |
| GET | `/api/media/thumbnail?path=&at=` | JPEG frame |
| POST | `/api/media/clip-preview/start` | legacy direct clip preview |
| POST | `/api/media/clip-preview/composite` | full `StartPlayoutRequest` + offset |
| POST | `/api/media/clip-preview/stop` | stop temporary preview |
| GET | `/api/media/clip-preview/:sessionId/:file` | HLS manifest/segment |

Composite preview проверяет burn-in subtitles filter до запуска.

## Effects

| Method | Route | Назначение |
|---|---|---|
| POST | `/api/effects/analyze` | partial-success analysis выбранных files |
| POST | `/api/effects/scan` | recursive scan directory |
| POST | `/api/effects/sequence` | infer PNG numbering/range |
| POST | `/api/effects/verify` | missing absolute paths |
| POST | `/api/effects/broadcast/task` | read/normalize task JSON |
| POST | `/api/effects/broadcast/ticker-source` | read TXT/JSON ticker |
| POST | `/api/effects/broadcast/ticker-feed` | fetch RSS/Atom |
| GET | `/api/effects/fonts` | system fonts + Cyrillic capability |

File analysis возвращает valid `items` и `issues` отдельно: один damaged file
не отменяет весь batch.

## Audio

| Method | Route | Назначение |
|---|---|---|
| POST | `/api/audio-tracks/scan` | match `{lang} basename` и ffprobe duration |

Body limit 32 MiB для недельного списка paths.

## Schedule

| Method | Route | Назначение |
|---|---|---|
| POST | `/api/schedule/parse` | server reads path, decodes and parses |
| POST | `/api/schedule/serialize` | returns UTF-8 text schedule |

Parser получает path, не raw upload: файл должен быть доступен media-service.

## Playout

| Method | Route | Назначение |
|---|---|---|
| GET | `/api/playout/status` | complete `PlayoutStatus` |
| GET | `/api/playout/audio-level` | current dBFS sample |
| POST | `/api/playout/start` | validate/preflight/start |
| POST | `/api/playout/take` | managed restart with new request |
| POST | `/api/playout/stop` | graceful stop |
| PUT | `/api/playout/next-playlist` | replace queued Future |
| PUT | `/api/playout/playlist` | HOT CHANGE current tail |
| GET | `/api/playout/preview/:file` | programme HLS files |

`StartPlayoutRequest`:

```text
playlist, nextPlaylist
video, audio, audioProgram
logo
endpoint (udp | srt | rtmp)
subtitleOutput
repeatPlaylist
scte35
```

Status polling также накапливает daily log statistics и синхронизирует finished
database session. Внешний клиент не должен прекращать polling навсегда, если
нужна полная operational статистика.

## Workspace

| Method | Route | Назначение |
|---|---|---|
| GET | `/api/workspace-session` | last snapshot + live checkpoint |
| PUT | `/api/workspace-session` | save snapshot |
| DELETE | `/api/workspace-session` | delete last workspace |

Routes требуют PostgreSQL. DELETE необратим через API.

## Broadcast configurations

| Method | Route | Назначение |
|---|---|---|
| GET | `/api/configurations` | summaries |
| GET | `/api/configurations/:id` | full saved request |
| PUT | `/api/configurations` | create/update after probing playlist |
| DELETE | `/api/configurations/:id` | delete |

Эти routes являются server API; текущий UI не использует их как основной
workflow. Не удаляйте их без migration/compatibility decision.

## Примеры

Health:

```bash
curl -s http://127.0.0.1:4310/api/health
```

Status:

```bash
curl -s http://127.0.0.1:4310/api/playout/status
```

Stop:

```bash
curl -X POST http://127.0.0.1:4310/api/playout/stop
```

Не отправляйте production Start вручную без генерации body через contracts:
ошибка endpoint/PID может быть синтаксически допустимой, но операционно
неверной.

## Добавление route

1. схема request/response в contracts;
2. `npm run build:contracts`;
3. route module с `RouteContext`;
4. `badRequest/notFound/databaseUnavailable`;
5. 32 MiB body limit для playlist;
6. регистрация в `app.ts`;
7. wrapper в `media-api.ts`, если нужен UI;
8. test happy/error/limit.
