# Эксплуатация, безопасность и восстановление

## Процессная модель

Background media-service может пережить Electron window. Всегда различайте:

- закрытие UI;
- Stop playout;
- остановку media-service;
- остановку system service.

Launcher останавливает media-service только если сам его породил. systemd,
LaunchAgent или Task Scheduler service остаётся владельцем фонового процесса.

## Журналы

По умолчанию:

- Desktop существует: `Desktop/FluxIO logs`;
- headless host: `~/FluxIO logs`;
- override: `GRUBER_LOG_DIR`.

Один file на локальные сутки, в конце — report sessions/errors/warnings. Запись
последовательная и не должна уронить эфир; после первой filesystem failure
logger прекращает повторные попытки и пишет warning в console.

Проверяйте logs при:

- падении producer/encoder/transport;
- event-loop lag;
- continuity errors;
- subtitle/SCTE restart;
- unexpected schedule transition.

## Workspace autosave

Snapshot включает Current/Future, metadata, libraries, effect definitions,
settings и marker. После изменения UI сохраняет его с debounce; явная кнопка
создаёт операторскую контрольную точку.

Media-service независимо записывает runtime checkpoint: session, state,
current item ID/index/name, item time, total time, loop и interrupted.

## Secrets

SRT passphrase и RTMP key:

- удаляются из ordinary snapshot/profile;
- шифруются AES-256-GCM с `GRUBER_SECRET_KEY`;
- не должны попадать в screenshots, logs или issue attachments.

Backup без `.env` не позволяет восстановить encrypted secrets. Backup с `.env`
является чувствительным и должен храниться отдельно с ограниченным доступом.

## Backup

Сохраняйте:

1. PostgreSQL dump;
2. `.env`;
3. repository commit/tag и `package-lock.json`;
4. media/graphics/fonts или гарантированный network storage;
5. экспорт расписаний, encoding profiles и critical `.fto`;
6. service definitions и список external tool versions.

Пример PostgreSQL:

```bash
pg_dump --format=custom --file=fluxio.dump "$DATABASE_URL"
```

Не помещайте реальный URL в shell history на общей машине; используйте
защищённую environment/session.

## Recovery после аварии

1. убедиться, что предыдущие FFmpeg/TSDuck/GStreamer процессы завершены;
2. поднять PostgreSQL и media-service;
3. проверить health/capabilities;
4. открыть workspace;
5. обработать missing files;
6. сравнить checkpoint и реальный rundown;
7. проверить endpoint свободен;
8. выбрать Resume или Start here;
9. контролировать внешний decoder.

Resume пересобирает request с clip offset. Он не гарантирует frame-identical
продолжение transport: endpoint/PTS могут перезапуститься.

### Автостарт по расписанию

При `autoResumeOnLaunch` и прерванном checkpoint приложение поднимает эфир само,
после видимого обратного отсчёта с кнопкой отмены. Точка подъёма считается **по
часам, а не по месту обрыва**: берётся `start on` расписания, его anchor date и
длительности строк, и эфир идёт с той передачи и с той секунды, которые зритель
ждёт увидеть сейчас. Расписание привязано ко времени суток, поэтому подъём с
места обрыва после часового простоя сдвинул бы всю неделю на час.

Checkpoint остаётся запасным путём — на плейлисте без расписания часам опереться
не на что. Если текущее время раньше начала расписания или позже его конца,
автоматический подъём точку не выбирает и решение остаётся за оператором.

## New playlist

Очищает workspace snapshot/checkpoint и operator state. Перед действием
экспортируйте нужный schedule. Удаление через UI/API не восстанавливается без
database backup.

## Обновление

Порядок:

1. Stop и дождаться idle;
2. backup;
3. установить exact lockfile dependencies;
4. migrations;
5. typecheck/tests/build;
6. restart service;
7. version match;
8. restore workspace;
9. test endpoint;
10. production handover.

Rollback должен включать совместимую database migration strategy. Нельзя просто
запустить старый binary поверх schema, если migration необратима.

## Сетевая безопасность

Media-service не имеет authentication. CORS защищает browser, но не curl или
malware на host. Routes умеют:

- читать/сканировать absolute paths;
- запускать media processes;
- управлять эфиром;
- делать outbound ticker fetch;
- удалять workspace/configurations.

Поэтому:

- `GRUBER_HOST=127.0.0.1`;
- host firewall закрывает port 4310;
- remote control возможен только через отдельный authenticated proxy/VPN с
  allowlist и audit;
- service user имеет минимальные filesystem permissions;
- ticker URL ограничивается операционно доверенными источниками.

## 24/7 readiness

До production 24/7 нужны:

- длительный soak на целевом hardware;
- резервный playout/encoder;
- автоматический независимый transport monitor;
- storage/network redundancy;
- documented failover;
- alerting по fps/speed/continuity/audio silence;
- регулярный restore drill;
- capacity budget CPU/GPU/RAM/disk/network.

Встроенный HLS monitor не является резервированием.
