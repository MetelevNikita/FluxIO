# Production: clone → setup → service

Целевой сценарий production-развёртывания:

```bash
git clone <repository-url> GruberProject
cd GruberProject
node setup.mjs
```

После ответов media-service должен быть собран, зарегистрирован как фоновый сервис, запущен и проверен через `/api/health`. Docker не используется.

## 1. Минимальные предварительные требования

- Git;
- Node.js 24+;
- npm 11+;
- права `sudo` на Linux для systemd/package installation;
- пользовательская графическая сессия для Electron.

Мастер умеет предложить установку FFmpeg, TSDuck и PostgreSQL:

- macOS — Homebrew;
- Debian/Ubuntu — apt;
- Windows — winget.

Для production лучше заранее установить и проверить эти пакеты согласно политике сервера.

## 2. Ответы production-мастеру

1. `Режим проекта` → `Production`.
2. Для готовой локальной PostgreSQL database → `Пользователь и база уже существуют: да`.
3. Для нового локального PostgreSQL → `нет`, после чего ввести administrator credentials; на Linux локальный `postgres` без password использует peer connection через `sudo -u postgres`.
4. Оставить `GRUBER_HOST=127.0.0.1`, если Electron работает на том же сервере.
5. Подтвердить `npm ci`, typecheck/tests и Electron installer.
6. Подтвердить установку background media-service.
7. На headless-сервере отказаться от запуска Electron; service всё равно будет запущен.

PostgreSQL всегда подключается по `127.0.0.1`. Мастер не запрашивает host и SSL: сетевой доступ к базе для Gruber не требуется.

## 3. Автоматические действия

Мастер выполняет:

```text
prerequisite check
  → optional native PostgreSQL/FFmpeg/TSDuck installation
  → PostgreSQL role/database creation
  → encrypted .env creation
  → npm ci --include=dev
  → Prisma generate
  → Prisma migrate deploy
  → typecheck + tests
  → production build
  → native Electron installer
  → background service installation/start
  → GET /api/health verification
```

Если `.env` уже существует, он сохраняется как `.env.backup-<timestamp>`. `GRUBER_SECRET_KEY` повторно используется, чтобы сохранённые SRT/RTMP secrets продолжили расшифровываться.

`--include=dev` обязателен и в production: Electron, Vite, TypeScript и Prisma CLI являются build-time dependencies. Фоновый service после сборки всё равно запускается с `NODE_ENV=production`.

## 4. Сервис по операционным системам

### Linux

Мастер генерирует unit с фактическим путём клонированного репозитория и устанавливает его как `gruber-media.service`:

```bash
systemctl status gruber-media.service
journalctl -u gruber-media.service -f
sudo systemctl restart gruber-media.service
```

Unit включается в автозапуск и использует отдельный runtime-каталог для HLS-preview. Закрытие Electron или terminal не останавливает эфир.

### macOS

Создаётся пользовательский LaunchAgent `live.gruber.media`:

```bash
launchctl print gui/$(id -u)/live.gruber.media
tail -f "$HOME/Library/Logs/GruberPlayout/media-service.log"
```

LaunchAgent стартует при входе выбранного пользователя в macOS. Для полностью headless boot-before-login deployment потребуется отдельный LaunchDaemon и системный пользователь.

### Windows

Перед вопросами о путях мастер обновляет process PATH из Machine/User settings и ищет `ffmpeg.exe`, `ffprobe.exe`, `tsp.exe`, `psql.exe` и `pg_isready.exe` в PATH, WinGet, Chocolatey, Scoop и стандартных `Program Files` directories. Нажатие Enter принимает найденный абсолютный путь; вручную путь нужен только для portable/custom installation.

Создаётся фоновая задача `Gruber Playout Media Service` в Windows Task Scheduler и запускается сразу:

```powershell
Get-ScheduledTask -TaskName 'Gruber Playout Media Service'
Start-ScheduledTask -TaskName 'Gruber Playout Media Service'
Stop-ScheduledTask -TaskName 'Gruber Playout Media Service'
```

Задача повторно запускает media-service при входе пользователя. Для Windows Server без интерактивного logon следующим этапом следует оформить настоящий Windows Service с отдельной service account.

## 5. Electron installer

Один и тот же `setup.mjs` работает на macOS, Windows и Linux. Installer собирается нативно для текущей ОС:

- macOS → `apps/desktop/release/*.dmg` и `*.zip`;
- Windows → `apps/desktop/release/*.exe`;
- Linux → `apps/desktop/release/*.AppImage` и `*.deb`.

Сборка macOS installer выполняется на macOS, Windows installer — на Windows. Это исключает зависимость от нестабильной cross-compilation toolchain и позволяет позже добавить корректную code signing/notarization.

Текущие installers не подписаны. Product name — `FluxIO`. Все installers используют утолщённый antenna mark; macOS использует отдельный full-bleed source без прозрачных/белых боковых полей. При первом запуске приложение показывает пятисекундный startup splash размером с основное окно и параллельно подготавливает основной renderer.

## 6. Проверка после мастера

На всех ОС:

```bash
curl --fail http://127.0.0.1:4310/api/health
curl --fail http://127.0.0.1:4310/api/capabilities
curl --fail http://127.0.0.1:4310/api/playout/status
```

Health должен быть `ready`. `degraded` означает, что `DATABASE_URL` не загружен или не настроен.

## 7. Операторский запуск эфира

1. Запустить установленный Electron client.
2. Убедиться, что header показывает media-service `ready`.
3. Выбрать папку/video files и дождаться зелёного `Done` для каждого материала.
4. При необходимости проверить thumbnails и Play/Seek в `Playlist & Preview`.
5. Собрать Playlist.
6. Настроить video/audio encoder и optional logo.
7. Настроить UDP, SRT, RTMP или RTMPS endpoint.
8. При необходимости включить `Repeat` до старта — расписание будет повторяться до Stop.
9. Для рекламных врезок выбрать UDP/SRT, включить SCTE-35, задать defaults и расставить Event IDs во вкладке Playlist. Первая метка — не раньше `pre-roll + 2 s`.
10. Подготовить головную станцию.
11. Нажать `Start Stream`.
12. Контролировать живой 16:9 HLS-preview, `Remaining HH:MM:SS`, номер loop, FFmpeg metrics и карточку SCTE-35 Injector: state, PID, observed/total, last/next Event ID.

SCTE-35 cue-секции реально внедряются TSDuck в UDP/SRT MPEG-TS. До пилота головная станция должна подтвердить PMT registration `CUEI`, выбранный `stream_type 0x86` PID, Event ID, segmentation type, UPID, pre-roll и соответствие IDR. RTMP/FLV для SCTE-35 не используется.

Проверка UDP на отдельном приёмнике с TSDuck:

```bash
tsp -I ip 239.10.10.10:5000 -P splicemonitor --all-commands -O drop
```

Проверка доступности SRT в TSDuck:

```bash
tsversion --support srt
```

PostgreSQL не показывается в Broadcast Settings: база обслуживается media-service и настраивается через `.env`/`setup.mjs`, а не оператором во время эфира.

В Encoder Settings отсутствует файловый Output: program отправляется только на выбранный streaming endpoint.

## 8. Обновление

```bash
git pull
node setup.mjs
```

Мастер повторно применит только новые Prisma migrations, пересоберёт приложение и перезапустит background service. Перед production update необходимо штатно остановить эфир и сделать PostgreSQL backup.

## 9. Backup

```bash
pg_dump --format=custom --file gruber-$(date +%F).dump 'postgresql://gruber:password@127.0.0.1:5432/gruber'
```

Отдельно храните `.env`/`GRUBER_SECRET_KEY`: без ключа зашифрованные SRT passphrase и RTMP stream key восстановить нельзя.

## 10. Граница 24/7

Автоматический setup упрощает установку, но не заменяет:

- 72-hour soak-test;
- return-feed monitoring;
- проверку cue на независимом downstream analyzer/головной станции;
- primary/backup playout;
- authentication/TLS удалённого управления;
- UPS, NTP и recovery procedure;
- signed installers;
- отдельную Windows service account или macOS LaunchDaemon для truly headless режима.
