# Технический долг и слабые места

Дата аудита: 2026-08-28. Приоритет отражает риск эфирного отказа и стоимость
изменения, а не эстетическое предпочтение.

## Уже исправлено этим аудитом

- Удалены неиспользуемые demo data, client API wrappers и лишние exports.
- Headless log fallback теперь выбирается до создания logger; раньше сообщение
  о переносе каталога не меняло `readonly directory`.
- Runtime version UI/server/setup/splash берётся из root `package.json`.
- Screens переведены на lazy chunks: initial JS уменьшился примерно с 1.19 MB
  до 304 kB в текущей production build.
- Health, capabilities, network discovery и telemetry polling вынесены из
  `App.tsx` в отдельный domain hook с тестом переходов.
- Добавлен CI workflow: repository metadata/docs, typecheck, tests и build.
- Удалены исторические progress reports, Lottie/After Effects examples и
  устаревшие HTML plans; документация стала evergreen.

## P0 — перед 24/7

### Резервирование и внешний мониторинг

Один media-service/encoder/host остаётся single point of failure. Нужны второй
тракт, автоматический failover и независимые alarms по picture, audio, bitrate,
PCR и continuity.

Критерий закрытия: documented failover drill без ручной импровизации.

### Soak и capacity envelope

Unit tests не доказывают длительный real-time playout. Нужна матрица
codec/resolution/interlace/hardware/effects/subtitles/multiaudio и минимум
24–72 часа на целевой машине.

Критерий: ноль dropped frames/continuity errors и измеренный запас resources.

### API security при remote access

API без authentication безопасен только на loopback. Если потребуется remote
control, нужен authenticated gateway, authorization roles, CSRF-independent
protection, audit log и outbound URL policy.

Критерий: port 4310 недоступен напрямую из LAN.

## P1 — высокий

### `PlayoutSupervisor`, около 2.8k lines

Один class одновременно управляет preflight, FFmpeg, clip/audio producers,
TSDuck, subtitles, preview, restarts и status. Ошибка state transition может
затронуть весь эфир.

План: выделять state machines по ownership — clip producers, transport,
subtitles, preview — сохраняя один coordinator. Начать с characterization tests.

### `App.tsx`, около 3.7k lines и десятки states

Workspace hydration, effects, schedule, dialogs и playout commands ещё связаны
в одном component. Риск stale closures и непредсказуемых renders.

План: продолжить с workspace recovery/autosave, затем playlist synchronization;
не дробить JSX без переноса state invariant.

### CI ещё не покрывает внешние инструменты

Базовый workflow добавлен, но GitHub branch protection на job `validate`
включается в настройках репозитория. Для FFmpeg/TSDuck/GStreamer/PostgreSQL
нужны отдельные runners; обычный Ubuntu job не подтверждает эфирный тракт.

### Интеграционные tests opt-in

Real FFmpeg/TSDuck/SRT/PostgreSQL сценарии легко не запустить перед release.

План: release checklist + CI runners с tools; публиковать причины skipped tests.

### Server-side ticker fetch

Произвольный URL создаёт SSRF risk при ошибочной публикации API.

План: protocol/hostname policy, block private/link-local/metadata addresses,
redirect re-validation и response size/time limits.

## P2 — средний

### Крупные UI screens и CSS

`BroadcastEffectInspector` >2k lines, `PlaylistPreviewScreen` >2k,
`BroadcastSettingsScreen` >1.6k, CSS >100 kB. Lazy loading решило initial load,
но не maintainability.

План: выделять cohesive panels и shared form primitives; добавить visual
regression/E2E.

### HLS player chunk, около 511 kB

После разделения экранов основной JS уменьшен, но vendor chunk `hls-video`
остаётся выше порога Vite 500 kB. Он изолирован от основного bundle, однако
стоит проверить загрузку по требованию и возможность более узкого HLS client.

### Один огромный media-server test file

`app.test.ts` смешивает routes, parsers, commands, hardware и integrations.
Targeted runs и ownership затруднены.

План: разделить по modules, сохранив common fixtures; test script должен
автоматически находить compiled `*.test.js`.

### Ручной список web tests

Новый test нужно добавить и в tsconfig, и в npm script.

План: единый test build include + glob discovery compiled tests.

### Dormant configurations API

Database/routes для named configurations есть, основной UI workflow их не
использует. Это поддерживаемая поверхность без operator value.

Решение: либо подключить UI и acceptance tests, либо объявить deprecation и
удалить migration-safe.

### Generated/version metadata

Workspace package versions всё ещё должны совпадать с root npm metadata.
Runtime duplication устранено, но release command/validation script полезны.

## P3 — низкий

- Добавить lint/formatter без массового шумного reformat.
- Автоматически проверять internal Markdown links.
- Добавить dependency/security update policy.
- Отделить demo seed data от production UI build полностью.
- Задокументировать retention preview caches/logs и disk quotas.

## Как работать с реестром

Каждая задача должна иметь owner, failure scenario, test и measurable exit
criterion. «Разбить большой файл» без сохранения invariants не считается
улучшением.
