# План разработки

## Завершённые этапы

### 1. Фундамент

Статус: завершён 2026-08-03. Отчёт: [`progress/01-foundation.md`](progress/01-foundation.md).

- npm workspaces;
- Fastify media-service;
- React и Electron shell;
- общие Zod-контракты;
- build, typecheck и tests.

### 1.1. Figma UI

Статус: завершён 2026-08-03. Отчёт: [`progress/01-1-figma-ui.md`](progress/01-1-figma-ui.md).

- три основных экрана из `Gruber.fig`;
- нативный production scroll и очистка очереди;
- production assets и локальный шрифт;
- responsive desktop layout.

### 2. Одноканальный FFmpeg playout + PostgreSQL

Статус: завершён как MVP 2026-08-03. Отчёт: [`progress/02-playout-postgres.md`](progress/02-playout-postgres.md).

- capability detection;
- реальный ffprobe файлов и папок;
- playlist concat с нормализацией;
- H.264/H.265/MPEG-2 и AAC/MP2/AC-3;
- UDP/SRT/RTMP(S);
- logo overlay;
- HLS program preview;
- Start/Stop/status/logs;
- PostgreSQL/Prisma, миграция и encrypted endpoint secrets;
- Electron packaging и systemd unit;
- development/production runbooks.

### 2.1. Установка одной командой

Статус: завершён 2026-08-04. Отчёт: [`progress/02-1-setup-wizard.md`](progress/02-1-setup-wizard.md).

- root `setup.mjs` на Node.js readline;
- test/production questionnaire;
- обычный PostgreSQL без Docker;
- создание role/database через psql;
- `.env`, Prisma migrations, tests и build;
- systemd, macOS LaunchAgent и Windows Task Scheduler;
- native Electron package для текущей ОС;
- удалён файловый Output из streaming-only UI.

### 2.2. Runtime-метрики, логи и product icon

Статус: завершён 2026-08-04. Отчёт: [`progress/02-2-runtime-metrics-branding.md`](progress/02-2-runtime-metrics-branding.md).

- Fastify access logs отключены;
- terminal logs ограничены событиями playout и критическими ошибками;
- реальные CPU и output NET метрики;
- общий antenna icon для Electron/macOS/Windows/Linux.

### 2.3. Media preview и готовность импорта

Статус: завершён 2026-08-04. Отчёт: [`progress/02-3-media-preview-readiness.md`](progress/02-3-media-preview-readiness.md).

- реальные FFmpeg thumbnails и восьмикадровый filmstrip;
- HLS-preview выбранного исходного ролика с Play/Pause/Stop/Seek;
- безопасный доступ только к уже проанализированным media paths;
- состояния `Analyzing`, `Done` и `Error`;
- вертикальный scroll и sticky header для большой медиатеки;
- PostgreSQL-настройки скрыты из Broadcast UI и остаются внутренней частью media-service.

### 2.4. Надёжный HLS preview и эфирный countdown

Статус: завершён 2026-08-04. Отчёт: [`progress/02-4-live-preview-countdown.md`](progress/02-4-live-preview-countdown.md).

- HLS.js используется приоритетно в Electron/Chromium;
- network retry и media decoder recovery при подготовке/обновлении HLS;
- безопасный muted bootstrap после асинхронного Play с последующим восстановлением громкости;
- адаптивный 16:9 Playlist Preview без фиксированной разрушающей высоты;
- реальный 16:9 program preview во время вещания;
- `Remaining HH:MM:SS` для всей программы в Broadcast monitor.

### 2.5. Repeat, SCTE-35 planner и macOS icon

Статус: завершён 2026-08-04. Отчёт: [`progress/02-5-repeat-scte35-macos-icon.md`](progress/02-5-repeat-scte35-macos-icon.md).

- адаптивный 16:9 Encoding Monitor без обрезки кадра;
- реальный бесконечный repeat supervisor и номер цикла;
- SCTE-35 marker planner на timeline и defaults в Broadcast;
- PostgreSQL/Prisma persistence marker metadata;
- отдельная полноразмерная macOS icon без прозрачных боковых полей;
- документирована граница между планированием и фактическим TS injector.

### 2.6. SCTE-35 injector для UDP/SRT

Статус: завершён 2026-08-04. Отчёт: [`progress/02-6-scte35-injector.md`](progress/02-6-scte35-injector.md).

- Node.js cue planner переводит marker time в 90 kHz PTS;
- FFmpeg формирует CBR MPEG-TS и IDR в cue-time;
- TSDuck добавляет PMT `CUEI`, PID `stream_type 0x86` и `splice_info_section`;
- UDP/SRT output и runtime injector monitor;
- fail-closed lifecycle и requeue/increment Event ID при Repeat;
- реальный UDP capture integration test и SRT loopback verification.

### 2.7. FluxIO branding и startup splash

Статус: завершён 2026-08-04. Отчёт: [`progress/02-7-fluxio-brand-splash.md`](progress/02-7-fluxio-brand-splash.md).

- единый FluxIO antenna mark в header, favicon и Electron assets;
- `FluxIO` wordmark с акцентным `IO`;
- PNG/ICNS/ICO пересобираются из версионируемых SVG sources;
- frameless startup splash 1440 × 920 с пятисекундным progress;
- main window загружается параллельно и открывается только после готовности renderer.

### 2.8. Windows automatic tool discovery

Статус: завершён 2026-08-04. Отчёт: [`progress/02-8-windows-tool-discovery.md`](progress/02-8-windows-tool-discovery.md).

- refresh Machine/User PATH без перезапуска PowerShell;
- абсолютные пути FFmpeg, ffprobe, TSDuck и PostgreSQL tools;
- WinGet, Chocolatey, Scoop и стандартные install locations;
- повторный поиск после автоматической установки;
- TCP fallback для проверки локального PostgreSQL.

## Следующая очередь

### 3. Надёжность playlist engine

- rolling scheduler вместо одного большого filter graph;
- server-side сохранённый rundown до старта;
- skip/next и planned transitions;
- black/slate fallback при ошибке файла;
- watchdog FFmpeg и политика restart;
- deterministic recovery после перезапуска media-service.
- бесшовное переключение repeat без restart gap;

### 4. Media preparation

- checksum и повторный анализ только изменённых файлов;
- очередь ffprobe с ограниченной параллельностью;
- compatibility warnings до старта;
- optional pre-transcode/cache для проблемных материалов.

### 5. Production security и operations

- authentication/roles/TLS;
- remote operator deployment;
- structured metrics и alerting;
- log rotation policy;
- backup/restore command и recovery test;
- signed installers;
- automatic update/rollback procedure.

### 6. 24/7 и резервирование

- длительный soak-test;
- hardware encoder profiles;
- primary/backup channel;
- return-feed monitoring;
- GPIO/API controlled failover;
- MPTS и резервированный SCTE-35 injector как отдельные production-модули.

## Критерий следующего production milestone

Система считается готовой к пилотному постоянному каналу после 72-часового теста на целевом сервере без underrun/overrun, подтверждения всех форматов на головной станции, проверки восстановления PostgreSQL и измеренного запаса CPU не менее 30% на выбранном профиле.
