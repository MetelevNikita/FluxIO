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

При первом создании Electron-окна FluxIO показывает startup splash 1440 × 920 в течение 5 секунд. Media-service и основной renderer в это время продолжают загружаться; повторное открытие окна через macOS Dock не повторяет splash.

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
6. Заполнить только потоковый endpoint UDP, SRT, RTMP или RTMPS.
7. При необходимости включить `Repeat` и/или SCTE-35, затем расставить Event IDs в Playlist. Первая метка должна быть позже `pre-roll + 2 s` от начала программы.
8. Нажать `Start Stream`.
9. Проверить 16:9 HLS-preview, current clip, loop, progress, FPS, bitrate, speed, а при SCTE-35 — injector state, PID и счётчик observed cues.

При включённом SCTE-35 выход доступен только через UDP/SRT MPEG-TS. Внутренний тракт — `FFmpeg → loopback UDP → TSDuck → endpoint`; RTMP preflight отклоняется.

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
```

## Типичные ошибки

- PostgreSQL недоступен — запустить нативный database service и повторить мастер;
- Windows tool не найден автоматически — проверить, что `.exe` существует, и один раз указать полный путь в мастере;
- health `degraded` — media-service не прочитал `DATABASE_URL`;
- отсутствует TSDuck — проверить `tsp --version` и `TSDUCK_PATH` в `.env`;
- отсутствует SRT при включённом SCTE-35 — проверить `tsversion --support srt`; финальный SRT socket открывает TSDuck;
- отсутствует SRT без SCTE-35 — установлен FFmpeg без libsrt;
- cue `too close to playlist start` — перенести marker позже либо уменьшить pre-roll, сохранив достаточный запас для головной станции;
- SRT passphrase — пустая либо 10–79 символов;
- RTMP требует H.264 + AAC;
- 5.1 доступен для AAC/AC-3, но не MP2.
