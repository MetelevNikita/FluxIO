# Тестирование и выпуск

## Обычный набор

```bash
npm run check:repo
npm run typecheck
npm test
npm run build
```

`npm test` компилирует tests и запускает `node:test`. Contracts и
scene-renderer имеют отдельные suites; media-server пока агрегирует большинство
tests в `app.test.ts`; web перечисляет test files в script и
`tsconfig.test.json`.

## Что покрыто

- Zod contracts, defaults и invalid combinations;
- scene timing/layout/reveal/text units;
- RecordingSurface drawing;
- schedule parse/serialize;
- FFmpeg/TSDuck/GStreamer command construction;
- hardware encoder selection;
- API routes;
- effect planning/application;
- workspace/profile/title formats;
- setup/launcher cross-platform helpers.

## Opt-in integration

| Variable | Назначение |
|---|---|
| `GRUBER_RUN_FFMPEG_TESTS=1` | real FFmpeg sessions/filter inputs |
| `GRUBER_RUN_SCTE35_TESTS=1` | real FFmpeg + TSDuck SCTE capture |
| `GRUBER_RUN_SRT_TESTS=1` | real SRT relay |
| `GRUBER_RUN_RTMP_TESTS=1` | real RTMP publish в локальный FLV receiver |
| `GRUBER_RUN_MULTISTREAM_TESTS=1` | SRT + UDP + RTMP и независимый stop/start выхода |
| `GRUBER_RUN_DATABASE_TESTS=1` | Prisma/PostgreSQL persistence |

Запускайте на изолированных ports и test database. Tests не должны отправлять
сигнал на production endpoint.

## UI/visual QA

Automated browser E2E отсутствует, поэтому перед release вручную:

1. Import files/schedule;
2. Effects library и JSON mapping;
3. Playlist selection/drag/timeline;
4. Broadcast Settings для каждого protocol;
5. title editor: drag, resize, group, anchor, reveal, timeline, undo;
6. 960×640 и 1440×920;
7. Russian/English;
8. Electron native dialogs;
9. splash и startup failure.

Для scene property добавьте RecordingSurface assertion, а не только screenshot.

## Media acceptance

На target host:

- progressive HD;
- interlaced SD/HD, если используется;
- hardware UHD;
- clips разных codecs/resolutions;
- multiaudio;
- burn-in/DVB;
- SCTE OUT/IN;
- Repeat;
- Current → Future;
- HOT CHANGE и Take;
- recovery после forced termination;
- soak.

Измеряйте final endpoint независимым analyzer.

Реальные локальные проверки протоколов и трёх выходов (нужны FFmpeg и TSDuck):

```bash
GRUBER_RUN_SRT_TESTS=1 npm test -w @gruber/media-server
GRUBER_RUN_RTMP_TESTS=1 npm test -w @gruber/media-server
GRUBER_RUN_MULTISTREAM_TESTS=1 npm test -w @gruber/media-server
```

Тесты поднимают локальных приёмников, передают синтетический H.264/AAC и
проверяют результат через ffprobe; внешняя сеть и публичный сервер не нужны.

## Кроссплатформенный offline smoke

Нативные части не кросс-компилируются: этот прогон выполняется отдельно на
Windows, macOS и Linux той же архитектуры, что у эфирной машины.

На каждой машине-сборщике с интернетом:

```bash
npm ci --include=dev
npm run check:repo
npm run typecheck
npm test
npm run build
npm run bundle:offline -- --tools-from ./tools --with-desktop --pack
```

Затем отключите сеть, перенесите файл комплекта на чистую тестовую машину,
проверьте checksum и установите его командами из
[installation.md](installation.md). После `node setup.mjs` проверьте реальный
production-контур:

```bash
curl --fail http://127.0.0.1:4310/api/health
curl --fail http://127.0.0.1:4310/api/system/metrics
curl --fail http://127.0.0.1:4310/api/playout/status
/opt/fluxio/runtime/node /opt/fluxio/app/launch.mjs       # Linux/macOS
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:4310/api/health
Invoke-RestMethod http://127.0.0.1:4310/api/system/metrics
Invoke-RestMethod http://127.0.0.1:4310/api/playout/status
C:\FluxIO\runtime\node.exe C:\FluxIO\app\launch.mjs
```

Один успешный прогон на macOS не заменяет нативный smoke Windows/Linux: release
блокируется, пока комплект каждой поддерживаемой ОС не был запущен на ней.

## Release procedure

1. Чистое или осознанно dirty worktree.
2. Все migrations и generated contracts актуальны.
3. Изменить root/workspace package versions через npm-aware procedure.
4. Обновить lockfile.
5. Runtime version автоматически читается из root `package.json`.
6. Обновить `docs/versioning.md` и compatibility notes.
7. Выполнить обычные и relevant opt-in tests.
8. Собрать desktop installer/directory.
9. Smoke install на каждой поддерживаемой OS.
10. Tag commit и сохранить checksums/artifacts.

Не выполняйте global replace version string: можно повредить dependency versions
и addresses.

## Критерии блокировки release

- version mismatch;
- failed typecheck/test/build;
- undocumented migration;
- unknown skipped integration test;
- visual regression operator controls;
- dropped frames на target profile;
- continuity/PCR errors;
- secret в diff/artifact;
- recovery не открывает previous workspace;
- output не подтверждён external receiver.

## CI

`.github/workflows/ci.yml` запускает repository check, typecheck, tests и build
на push и pull request под Node.js 24. В настройках GitHub защитите основную
ветку и сделайте job `validate` обязательной: workflow сам по себе не запрещает
merge через интерфейс администратора.
