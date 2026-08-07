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
6. Подтвердить создание ярлыка FluxIO на рабочем столе.
7. Подтвердить установку background media-service.
8. На headless-сервере отказаться от запуска Electron; service всё равно будет запущен.

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
  → desktop shortcut creation
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

Unit включается в автозапуск и использует отдельный runtime-каталог для HLS-preview. Обычное закрытие окна Electron оставляет service активным. Если Electron запущен самим `setup.mjs`, нажатие `Ctrl+C` в этом terminal завершает Electron и выполняет `systemctl stop gruber-media.service`.

### macOS

Создаётся пользовательский LaunchAgent `live.gruber.media`:

```bash
launchctl print gui/$(id -u)/live.gruber.media
tail -f "$HOME/Library/Logs/GruberPlayout/media-service.log"
```

LaunchAgent стартует при входе выбранного пользователя в macOS. Для полностью headless boot-before-login deployment потребуется отдельный LaunchDaemon и системный пользователь.

При `Ctrl+C` в активном `setup.mjs` мастер выполняет `launchctl bootout` и останавливает LaunchAgent вместе с Electron. Обычное закрытие окна Electron service не выгружает.

### Windows

Перед вопросами о путях мастер обновляет process PATH из Machine/User settings и ищет `ffmpeg.exe`, `ffprobe.exe`, `tsp.exe`, `psql.exe` и `pg_isready.exe` в PATH, WinGet, Chocolatey, Scoop и стандартных `Program Files` directories. Нажатие Enter принимает найденный абсолютный путь; вручную путь нужен только для portable/custom installation.

Создаётся фоновая задача `Gruber Playout Media Service` в Windows Task Scheduler и запускается сразу:

```powershell
Get-ScheduledTask -TaskName 'Gruber Playout Media Service'
Start-ScheduledTask -TaskName 'Gruber Playout Media Service'
Stop-ScheduledTask -TaskName 'Gruber Playout Media Service'
```

Задача повторно запускает media-service при входе пользователя. Для Windows Server без интерактивного logon следующим этапом следует оформить настоящий Windows Service с отдельной service account.

При `Ctrl+C` в активном `setup.mjs` мастер завершает дерево Electron и вызывает `Stop-ScheduledTask`; обычное закрытие окна оставляет задачу активной.

## 5. Electron installer

Один и тот же `setup.mjs` работает на macOS, Windows и Linux. Installer собирается нативно для текущей ОС:

- macOS → `apps/desktop/release/*.dmg` и `*.zip`;
- Windows → `apps/desktop/release/*.exe`;
- Linux → `apps/desktop/release/*.AppImage` и `*.deb`.

Сборка macOS installer выполняется на macOS, Windows installer — на Windows. Это исключает зависимость от нестабильной cross-compilation toolchain и позволяет позже добавить корректную code signing/notarization.

Текущие installers не подписаны. Product name — `FluxIO`. Все installers используют утолщённый antenna mark; macOS использует отдельный full-bleed source без прозрачных/белых боковых полей. При первом запуске приложение показывает пятисекундный startup splash размером с основное окно и параллельно подготавливает основной renderer.

### Ярлык рабочего стола

Production-мастер создаёт нативный ярлык:

- Windows — `FluxIO.lnk` с фирменной ICO;
- macOS — `~/Desktop/FluxIO.app` с фирменной ICNS;
- Linux — `FluxIO.desktop` с фирменной PNG.

Ярлык запускает корневой `launch.mjs`. Launcher читает `.env`, проверяет media-server через `/api/health`, при необходимости запускает собранный `apps/media-server/dist/index.js`, затем открывает production Electron. Если launcher сам поднял media-server, при закрытии Electron он завершает и этот дочерний server. Уже работающий systemd/LaunchAgent/Windows Task launcher не останавливает.

Тот же запуск без ярлыка:

```bash
npm run launch
```

## 6. Проверка после мастера

На всех ОС:

```bash
curl --fail http://127.0.0.1:4310/api/health
curl --fail http://127.0.0.1:4310/api/capabilities
curl --fail http://127.0.0.1:4310/api/playout/status
```

Health должен быть `ready`. `degraded` означает, что `DATABASE_URL` не загружен или не настроен.

## 7. Операторский запуск эфира

1. Запустить FluxIO ярлыком рабочего стола или командой `npm run launch`.
2. Убедиться, что в левом нижнем углу показаны зелёные `ACTIVE` и правильный IP:port media-server. Состояние проверяется каждые 2 секунды.
3. Выбрать папку/video files и дождаться зелёного `Done` для каждого материала.
4. При необходимости проверить thumbnails и Play/Seek в `Playlist & Preview`.
5. Собрать Playlist.
6. Настроить video/audio encoder, GOP Structure (I/P/B) и optional logo.
7. Настроить UDP, SRT, RTMP или RTMPS endpoint. Для UDP выбрать конкретный output interface и проверить MPEG-TS service/PID/PCR/Transport bitrate.
8. При необходимости включить `Repeat` до старта — расписание будет повторяться до Stop.
9. Для рекламных врезок выбрать UDP/SRT, включить SCTE-35, задать defaults и расставить Event IDs во вкладке Playlist. Первая метка — не раньше `pre-roll + 2 s`.
10. Подготовить головную станцию.
11. Нажать `Start Stream`.
12. Контролировать живой 16:9 HLS-preview, `Remaining HH:MM:SS`, номер loop, FFmpeg metrics, строки `Transmitted frames` в Log Output, `[PLAYOUT] Encoding clip ...` в журнале media-service и карточку SCTE-35 Injector: state, PID, observed/total, last/next Event ID.

Media-service не пишет HTTP access logs. Во время активного кодирования он
выдаёт одну console-строку каждые 5 секунд и немедленно при смене ролика:

```text
[PLAYOUT] Encoding clip 2/20 "News.mp4" | frame: 125 | FPS: 25.00 | bitrate: 2628 kbps | speed: 1.00x | time: 00:00:05
```

На Linux эти строки видны через `journalctl -u gruber-media.service -f`, на
macOS — в `media-service.log`; при foreground-запуске — прямо в terminal.

Для нового UDP-профиля используются безопасные начальные значения: service
`FluxIO`, service ID `1`, provider `FluxIO`, video PID `256`, audio PID `257`,
service type `digital_tv`, PCR `20 ms`, Field Order `progressive`. `Upper` — TFF,
`Lower` — BFF. Приложение получает интерфейсы с того компьютера, где запущен
media-server; выбирать нужно IP адаптера, подключённого к сети головной станции.
При `Automatic routing` исходящий интерфейс определяет таблица маршрутизации ОС.
Для multicast FluxIO принудительно назначает выбранный интерфейс в TSDuck.
Каждый UDP поток проходит финальные `pcradjust` и `regulate`, даже если SCTE-35
выключен; SRT использует финальный `regulate`. UI target `26 ms` использует
безопасный внутренний порог `24 ms`, чтобы следующий null packet не вынес PCR
за допустимые `40 ms`;
Video Target/Max Bitrate меняются с шагом `500 kbps`.

Начальная GOP structure: `48` кадров, `2` последовательных B-frame и Closed
GOP. При 23.976 fps это примерно две секунды: `I B B P …`. GOP length задаёт
интервал I-frame; P-frame формируются между группами B-frame. Closed GOP
рекомендуется для предсказуемого переключения, HLS/головной станции и SCTE-35.
Увеличение B-frame повышает эффективность кодирования, но добавляет reorder
latency. Для минимальной задержки установите `B=0`.

`Target Bitrate` — bitrate видеопотока, а не всего транспортного потока.
`Max Bitrate` активен только для VBR, `VBV Buffer` указывается в kbit.
`Transport bitrate` задаёт постоянную итоговую скорость MPEG-TS вместе с audio,
таблицами и служебными пакетами. Значение `0` включает безопасный Auto-расчёт;
свободная полоса заполняется null packets PID `0x1FFF`. Для точного требования
головной станции введите её TS bitrate вручную. Если он ниже необходимого для
video/audio peak, Start будет остановлен preflight-проверкой.

Перед Start приложение отклонит одинаковые video/audio PID и совпадение SCTE-35
PID с elementary-stream PID. После Start `Transmitted frames` означает, что
FFmpeg передаёт кадры в output socket; это не является return-feed и не
доказывает приём потока головной станцией.

SCTE-35 cue-секции реально внедряются TSDuck в UDP/SRT MPEG-TS. До пилота головная станция должна подтвердить PMT registration `CUEI`, выбранный `stream_type 0x86` PID, Event ID, segmentation type, UPID, pre-roll и соответствие IDR. RTMP/FLV для SCTE-35 не используется.

Проверка UDP на отдельном приёмнике с TSDuck:

```bash
tsp -I ip --local-address <IP-приёмного-интерфейса> 239.10.10.10:5000 \
  -P splicemonitor --all-commands \
  -O drop
```

После Start в Log Output должны появиться строки `TSDuck UDP PCR relay started`
и `UDP transport output` с
фактическим destination, интерфейсом, service ID, video/audio PID и PCR. Она
подтверждает конфигурацию конечного TSDuck output; сетевую доставку подтверждает
только приёмник или capture на головной станции.

Дополнительно проверить `Applied TS bitrate` в Encoding Monitor и строку
`transport target ... (manual|Auto)`. Для настроенных `12 Mbps` ожидаются
`12.000 Mbps (manual)`. Значение `12.900 Mbps (auto)` означает, что сервер
получил Auto (`0`), либо продолжает работать старая сессия/сборка. Значение
относится к 188-byte MPEG-TS payload; UDP/IP/Ethernet line rate может быть выше
из-за сетевых заголовков.

При рассыпании изображения проверить `Internal CC errors`. Если счётчик FluxIO
равен `0`, а DVBControl показывает `Continuity_count_error`, дефект возник после
TSDuck. Проверить выбранный NIC, кабель/switch port counters, MTU 1500, IGMP
snooping/querier, multicast VLAN и UDP receive buffer анализатора. Если
внутренний счётчик растёт, сохранить строки `TSDuck continuity warning`: они
содержат PID и пропущенные packets.

Проверка доступности SRT в TSDuck:

```bash
tsversion --support srt
```

Весь UDP/SRT output, независимо от SCTE-35, открывает TSDuck по схеме
`FFmpeg → loopback UDP → TSDuck → endpoint`. Поэтому отсутствие `srt` в
`ffmpeg -protocols` допустимо. Если SCTE-35 выключен, TSDuck работает как
transport relay (для UDP также PCR relay), не изменяет PMT и не добавляет cue
PID.

PostgreSQL не показывается в Broadcast Settings: база обслуживается media-service и настраивается через `.env`/`setup.mjs`, а не оператором во время эфира.

В Encoder Settings отсутствует файловый Output: program отправляется только на выбранный streaming endpoint.

## 8. Обновление

```bash
git pull
node setup.mjs
```

Мастер повторно применит только новые Prisma migrations, пересоберёт приложение и перезапустит background service. Перед production update необходимо штатно остановить эфир и сделать PostgreSQL backup.

Версия текущего этапа — `v5.0.3`. Каждый следующий завершённый update увеличивает patch на единицу; подробности — в `docs/versioning.md`.

### Обновление без доступа к интернету

Для заранее подготовленного offline bundle:

```powershell
node setup.mjs --offline
```

В режиме offline мастер не выполняет npm/system downloads и всегда создаёт
запускаемое приложение без NSIS: `apps\desktop\release\win-unpacked\FluxIO.exe`.
Вопрос о полном installer не задаётся, поэтому `electron-builder` не пытается
получить NSIS/WinCodeSign с GitHub. Полный `FluxIO Setup *.exe` следует собирать
обычным `node setup.mjs` на машине с интернетом.

Electron runtime читается из `node_modules\electron\dist`. Если этот каталог,
Prisma CLI, Vite, TypeScript или electron-builder отсутствуют, мастер
останавливается до сборки с перечнем недостающих компонентов.

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
