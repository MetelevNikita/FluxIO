# Архитектура

## Цель и граница системы

FluxIO формирует один программный канал из локальных файлов. Control plane и
media plane разделены: React управляет, media-service исполняет. Это позволяет
закрыть/перезапустить окно, не убивая эфир, и хранить runtime checkpoint без
участия UI.

```text
Native dialogs                           PostgreSQL
     ▲                                      ▲
     │ IPC                                  │ Prisma
Electron main ── preload ── React ── HTTP ─ Fastify
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
                    FFmpeg graph          GStreamer             TSDuck
                 renderers + encoder     DVB subtitle PID     TS regulate/cues
```

## Компоненты

### `@gruber/contracts`

Zod-схемы запросов, ответов, workspace, расписаний, сцен и файлов. Сервер
валидирует внешние данные, UI получает типы через `z.infer`. Второй интерфейс с
той же формой создавать нельзя: иначе runtime validation и TypeScript
расходятся.

### `@gruber/scene-renderer`

Одна функция `drawScene` работает поверх узкого `SceneSurface`. В браузере ей
служит Canvas 2D, в media-service — Skia через `@napi-rs/canvas`. Тестовая
`RecordingSurface` записывает команды отрисовки без пиксельных golden files.

### `@gruber/media-server`

Fastify API и все долгоживущие процессы. `RouteContext` передаёт маршрутам
capabilities, database, logger, preview и `PlayoutSupervisor`. UI не запускает
FFmpeg и не получает прямой доступ к файловой системе.

### `@gruber/web`

Операторское состояние, построение `StartPlayoutRequest`, планирование эффектов,
screens и polling. Health опрашивается примерно раз в 2 секунды, playout status
— примерно раз в 750 мс. Тяжёлые экраны загружаются отдельными web chunks.

### `@gruber/desktop`

Electron main создаёт окна, регистрирует native file dialogs и service health
IPC. Preload работает с `contextIsolation`, `sandbox` и без `nodeIntegration`.
Мост `window.gruberDesktop` содержит только заранее перечисленные операции.

## Жизненный цикл эфира

1. UI строит запрос из Current, Future и Broadcast Settings.
2. Contracts проверяют диапазоны, совместимость protocol/subtitles/audio PID.
3. Supervisor выполняет preflight внешних tools, файлов, кодеков и bitrate.
4. Готовится первый clip renderer и preloaded следующий.
5. Запускается постоянный program encoder.
6. Для MPEG-TS запускается TSDuck relay; при необходимости к нему подключаются
   DVB subtitles и SCTE-35.
7. Status отражает frame, fps, bitrate, текущий clip, transport, cues и errors.
8. После Current Future автоматически становится Current, если Repeat выключен.
9. Stop завершает дочерние процессы и синхронизирует сессию.

Пустой Current допустим: supervisor подставляет бесконечные SMPTE colour bars.

## Rolling FFmpeg pipeline

Недельный список не помещается в Windows command line и не должен фиксировать
все input заранее. Поэтому:

- program encoder живёт всю сессию;
- video и каждая audio track приходят в отдельные pipe;
- renderer текущего клипа пишет данные;
- renderer следующего уже запущен, но ожидает активации;
- при границе clips меняется producer, а не encoder/transport;
- PID, PCR, mux clock и endpoint не пересоздаются;
- HOT CHANGE заменяет хвост и пересобирает prefetch.

Audio renderer обязан отдать ровно длительность клипа: короткий источник
дополняется тишиной. Набор многоязычных PID фиксируется на Start; отсутствие
языка у конкретного клипа также даёт тишину, а не изменение PMT.

## Выходной тракт

UDP/SRT:

```text
clip pipes → persistent FFmpeg encoder → loopback MPEG-TS → TSDuck
                                                    ├─ regulate/continuity
                                                    ├─ PCR adjustment (UDP)
                                                    ├─ SCTE-35 merge
                                                    ├─ DVB subtitle merge
                                                    ├─ endpoint
                                                    └─ mirrored HLS preview
```

RTMP/RTMPS:

```text
clip pipes → persistent FFmpeg encoder → FLV → RTMP endpoint
```

FLV не несёт отдельный DVB PID, SCTE-35 и несколько programme audio PID.

## Графика и сцены

Level 1 — logo и AGE конкретного клипа. Level 2 — параметрические broadcast
effects. Планировщик UI разрешает Level 2 в обычные:

- `GraphicEffectLayer`;
- `PlayoutSceneShow`;
- `ClipAudioOverlay`.

Supervisor не знает понятия «уровень эффекта».

Сцена измеряет текст до вычисления области. Рендерится только объединённая
область показа, а не полный RGBA frame. Координаты `x/width` зависят от ширины,
`y/height/font/radius/blur` — от высоты. Время берётся из номера кадра, не из
часов процесса: следующий producer может стартовать заранее.

## Предпросмотр

Есть два тракта:

- clip/composite preview — временная HLS-сессия выбранного материала;
- program preview — зеркало уже собранного transport после TSDuck.

Composite preview строит тот же граф наложений, но использует software encoder,
чтобы не занимать единственный hardware device эфирного профиля.

## Persistence

PostgreSQL хранит:

- media metadata и playlists;
- encoding profiles и endpoints;
- broadcast configurations и sessions;
- последний workspace snapshot;
- runtime checkpoint;
- secrets отдельно от snapshot в зашифрованном виде.

Видео, графика, шрифты и `.fto` не копируются в базу: сохраняются абсолютные
пути. Восстановленная сессия обязана повторно проверить их доступность.

## Ошибки и деградация

- Нет PostgreSQL: health `degraded`, media API доступен, persistence routes = 503.
- Нет tool/filter: capabilities/preflight возвращает понятную ошибку до старта.
- Падает clip producer: supervisor помечает playout failed и завершает тракт.
- Падает transport preview: он перезапускается отдельно и не должен останавливать
  programme output.
- Hardware encoder недоступен: отказ; software fallback запрещён.
- Неверная версия UI/service: UI показывает blocking warning о потере полей.

## Безопасность

CORS разрешает только Electron `null` origin и localhost HTTP origins, но это не
аутентификация. API умеет читать абсолютные пути, сканировать каталоги и
загружать ticker feed. Поэтому штатная граница — loopback. Подробнее:
[operations-and-recovery.md](operations-and-recovery.md).

## Архитектурные invariants

1. Эфир принадлежит media-service, не UI.
2. Contracts — единственный источник формы данных.
3. `drawScene` — единственная реализация сцены.
4. Следующий renderer может стартовать заранее; wall clock для scene timing
   запрещён.
5. Порядок эффектов никогда не сортируется автоматически.
6. Plan и apply эффектов разделены; planner остаётся чистой функцией.
7. PID/PMT не меняются посреди сессии.
8. Hardware failure не маскируется software fallback.
9. Preview не забирает hardware encoder у эфира.
10. Неизвестный или недоступный вход должен дать явный preflight error, а не
    частично верный эфир.
