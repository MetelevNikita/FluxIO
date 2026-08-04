# Development: установка одной командой

## Требования до клонирования

- Git;
- Node.js 24+;
- npm 11+.

PostgreSQL, FFmpeg и TSDuck могут быть уже установлены. Если их нет, мастер предложит установку через Homebrew на macOS, `apt` на Debian/Ubuntu или `winget` на Windows. Docker не используется.

## 1. Клонирование и запуск мастера

```bash
git clone <repository-url> GruberProject
cd GruberProject
node setup.mjs
```

`setup.mjs` использует только встроенные модули Node.js, поэтому предварительный `npm install` не нужен.

### Что отправлять в Git

Проект рассчитан на один monorepo. Перед первым push из корня:

```bash
git init
git add .
git status --short
```

В `git status` не должны появляться `.env`, `.env.backup-*`, `node_modules`, `dist`, `dist-test`, `apps/desktop/release`, generated Prisma Client, logs и локальные database dumps. Должны появляться `package-lock.json`, Prisma migrations, исходники, документация, `apps/web/public` и `apps/desktop/build` с платформенными иконками.

Иконки PNG/ICNS/ICO намеренно хранятся в Git: Windows/Linux packaging использует уже подготовленные assets, поскольку их генератор запускается на macOS. Для текущих web media assets Git LFS не требуется.

## 2. Рекомендуемые ответы для test/development

1. `Режим проекта` → `Тест / разработка`.
2. Если роль и база уже есть → ответить `да` и ввести подключение.
3. Если базы нет → ответить `нет`; мастер запросит PostgreSQL administrator и создаст роль/базу через `psql`.
4. Port → обычно `5432`.
5. Database/user → обычно `gruber`.
6. Password вводится скрыто. Для новой базы пустой password заменяется автоматически сгенерированным.
7. Media-service → `127.0.0.1:4310`.
8. FFmpeg/ffprobe/TSDuck → нажать Enter и принять автоматически найденные абсолютные пути.
9. `npm ci`, typecheck/tests и запуск → `да`.

PostgreSQL фиксирован на `127.0.0.1`. SSL отключён и не показывается в вопросах мастера, поскольку база и приложение работают на одном сервере.

### Автоматический поиск на Windows

При запуске `node setup.mjs` мастер:

1. перечитывает Machine/User `PATH` через PowerShell и объединяет его с PATH текущего terminal;
2. проверяет программы через `where.exe`;
3. проверяет WinGet `Links` и `Packages`, Chocolatey и Scoop;
4. ищет FFmpeg в `C:\ffmpeg\bin`, `C:\Tools\ffmpeg\bin` и `Program Files\FFmpeg\bin`;
5. ищет TSDuck в `Program Files\TSDuck\bin`;
6. ищет `psql.exe` и `pg_isready.exe` в `Program Files\PostgreSQL\<version>\bin`;
7. сохраняет найденные абсолютные пути в `.env`.

Если FFmpeg был установлен в нестандартный каталог и не добавлен в PATH, в вопросе можно один раз вставить полный путь, например `D:\MediaTools\ffmpeg\bin\ffmpeg.exe`. Для `ffprobe` используется отдельный путь; обычно он находится рядом с `ffmpeg.exe`. После автоматической установки через winget мастер повторно перечитывает PATH, поэтому новый PowerShell открывать не требуется.

Команды npm на Windows запускаются через установленный `node.exe` и `node_modules\npm\bin\npm-cli.js`. Это позволяет корректно работать с путём `C:\Program Files\nodejs` и не передавать `npm.cmd` напрямую в Node.js `spawn()`. Если `npm-cli.js` отсутствует, мастер использует совместимый запасной запуск `npm.cmd` через Windows command shell. На macOS и Linux остаётся обычная команда `npm`.

## 3. Что делает мастер

```text
Проверка Node.js
  → проверка/установка FFmpeg, TSDuck и PostgreSQL
  → создание PostgreSQL role/database при необходимости
  → резервная копия старого .env
  → новый .env с mode 0600
  → npm ci --include=dev
  → Prisma Client generation
  → Prisma migrate deploy
  → typecheck + tests
  → media-service + Vite + Electron
```

Все три development-процесса запускаются из одного terminal. `Ctrl+C` завершает media-service, Vite и Electron. Нативный PostgreSQL service продолжает работать отдельно.

Production-ярлык рабочего стола создаётся только при выборе режима `Production`, поскольку он запускает собранные `dist`-версии интерфейса и media-server. В development используется общий terminal и Vite HMR.

При первом создании Electron-окна FluxIO показывает startup splash 1440 × 920 в течение 5 секунд. Media-service и основной renderer в это время продолжают загружаться; повторное открытие окна через macOS Dock не повторяет splash.

### Offline-сборка

Если repository уже содержит подготовленные для текущей ОС и архитектуры `node_modules`, запустите:

```bash
node setup.mjs --offline
```

Мастер не выполняет `npm ci`, Homebrew/apt/winget installation и другие сетевые установки. Он проверяет локальные TypeScript, Vite, Prisma, Electron runtime и electron-builder. При выборе unpacked application Electron берётся напрямую из `node_modules/electron/dist`, а результат на Windows создаётся в `apps/desktop/release/win-unpacked`.

Полный NSIS installer требует заранее заполненный `%LOCALAPPDATA%\electron-builder\Cache`. Этот cache нужно создать однократной успешной сборкой на Windows-машине с интернетом той же архитектуры, затем перенести целиком на offline-машину. `node_modules` с macOS/Linux нельзя использовать для Windows.

Electron 43 runtime при online setup проверяется отдельно после `npm ci`. Если `node_modules\electron\dist\electron.exe` отсутствует, мастер автоматически запускает `node node_modules\electron\install.js`. В offline mode отсутствие этого файла является ошибкой подготовленного bundle и download не выполняется.

## 4. Повторный запуск

Повторный `node setup.mjs` подставляет текущие значения из `.env`. PostgreSQL password не печатается. Перед перезаписью создаётся файл `.env.backup-<timestamp>`.

Чтобы только настроить, мигрировать и собрать без запуска:

```bash
node setup.mjs --no-start
```

## 5. Проверка эфира

1. Добавить папку или video files в `Media Library`.
2. Дождаться зелёного `Done` для каждого файла; `Proceed` доступен только после успешного анализа.
3. Проверить thumbnails, Play/Pause/Seek и порядок в `Playlist`.
4. В `Broadcast` выбрать video/audio encoder settings.
5. При необходимости включить logo overlay.
6. Заполнить только потоковый endpoint UDP, SRT, RTMP или RTMPS. Для UDP выбрать сетевой интерфейс и проверить параметры MPEG-TS service.
7. При необходимости включить `Repeat` и/или SCTE-35, затем расставить Event IDs в Playlist. Первая метка должна быть позже `pre-roll + 2 s` от начала программы.
8. Нажать `Start Stream`.
9. Проверить 16:9 HLS-preview, current clip, loop, progress, FPS, bitrate, speed, а при SCTE-35 — injector state, PID и счётчик observed cues.

### UDP и MPEG-TS

При открытии приложения media-server читает сетевые адаптеры через `node:os` и
возвращает их из `GET /api/system/network-interfaces`. Если UDP interface ещё не
задан, UI выбирает первый внешний IPv4. `Automatic routing` оставляет выбор
маршрута операционной системе. Выбранный адрес передаётся FFmpeg как UDP
`localaddr`, а при SCTE-35 — TSDuck как `--local-address`.

Значения UDP MPEG-TS по умолчанию:

- Service name: `FluxIO`;
- Service number / ID: `1`;
- Provider: `FluxIO`;
- Video PID: `256` (`0x0100`);
- Audio PID: `257` (`0x0101`);
- Input stream type: `digital_tv`;
- PCR interval: `20 ms`;
- Field Order: `progressive`.

`Upper` означает top-field-first (TFF), `Lower` — bottom-field-first (BFF).
Настройка включает соответствующее encoder signaling для H.264/H.265/MPEG-2.
YADIF нельзя включать без необходимости: после деинтерлейса исходная полевая
структура уже удалена. Video PID и Audio PID должны отличаться; SCTE-35 PID при
включённом injector также не может совпадать с ними.

В `Encoding Monitor → Log Output` каждая запись FFmpeg progress показывает
переданное число кадров, FPS, bitrate и program time. Это подтверждает работу
локального encoder/muxer, но доставку до головной станции нужно проверять на
приёмной стороне.

При включённом SCTE-35 выход доступен только через UDP/SRT MPEG-TS. Внутренний тракт — `FFmpeg → loopback UDP → TSDuck → endpoint`; RTMP preflight отклоняется.

Для любого SRT, в том числе без SCTE-35, transport открывает TSDuck: `FFmpeg → loopback UDP → TSDuck → SRT`. Поэтому наличие `srt` в `ffmpeg -protocols` не требуется. При выключенном SCTE-35 relay не добавляет CUEI registration, SCTE PID или cue sections.

Файлового Output в UI нет: FFmpeg формирует program stream и внутренний HLS-preview, но не сохраняет закодированный файл.

## 6. Ручная диагностика

```bash
npm run typecheck
npm test
npm run build
```

Реальный FFmpeg integration test:

```bash
GRUBER_RUN_FFMPEG_TESTS=1 npm test
```

Реальный SCTE-35 integration test с локальным UDP capture:

```bash
GRUBER_RUN_SCTE35_TESTS=1 npm test -w @gruber/media-server
```

Проверки API:

```bash
curl http://127.0.0.1:4310/api/health
curl http://127.0.0.1:4310/api/capabilities
curl http://127.0.0.1:4310/api/playout/status
curl http://127.0.0.1:4310/api/system/network-interfaces
```

## Типичные ошибки

- PostgreSQL недоступен — запустить нативный database service и повторить мастер;
- `spawn EINVAL` сразу после строки `npm.cmd ci` — использовалась старая версия `setup.mjs`; обновить файл из repository и повторить `node setup.mjs`;
- FFmpeg test ожидает `/tmp/...`, но получает `\\tmp\\...` — обновить repository: cross-platform проверка HLS paths добавлена на этапе 2.11;
- systemd test получает `\\srv\\...` вместо `/srv/...` — обновить repository: Linux/macOS service paths зафиксированы как POSIX на этапе 2.12;
- FFmpeg пишет `Unrecognized option 'stats_period'` — обновить repository: optional argument удалён на этапе 2.13, progress работает через `-progress pipe:1`;
- после rebuild FFmpeg всё ещё получает старые arguments — повторно установить Windows background service через мастер; начиная с этапа 2.14 мастер сначала останавливает старый Scheduled Task;
- electron-builder завершается `connect ETIMEDOUT ...:443` — использовать `node setup.mjs --offline`; для unpacked build достаточно local Electron runtime, для NSIS перенести `%LOCALAPPDATA%\electron-builder\Cache`;
- Windows tool не найден автоматически — проверить, что `.exe` существует, и один раз указать полный путь в мастере;
- health `degraded` — media-service не прочитал `DATABASE_URL`;
- отсутствует TSDuck — проверить `tsp --version` и `TSDUCK_PATH` в `.env`;
- SRT недоступен — проверить `tsversion --support srt`; весь финальный SRT transport открывает TSDuck, поддержка libsrt в FFmpeg не требуется;
- cue `too close to playlist start` — перенести marker позже либо уменьшить pre-roll, сохранив достаточный запас для головной станции;
- SRT passphrase — пустая либо 10–79 символов;
- RTMP требует H.264 + AAC;
- 5.1 доступен для AAC/AC-3, но не MP2.
