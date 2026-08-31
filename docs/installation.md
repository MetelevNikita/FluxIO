# Установка и конфигурация

## Требования

Обязательны:

- Node.js и npm версии, совместимые с `package-lock.json`;
- PostgreSQL;
- FFmpeg и ffprobe;
- TSDuck (`tsp`) для UDP/SRT transport;
- права чтения media/graphics/font файлов и записи runtime-каталогов.

Для режима DVB subtitles дополнительно нужен GStreamer с `dvbsubenc`. Electron
устанавливается как npm dev dependency и должен присутствовать даже в
production-сборке.

## Установка мастером

```bash
npm run setup
```

Флаги:

| Флаг | Назначение |
|---|---|
| `--offline` | не обращаться в сеть; зависимости и Electron уже должны находиться локально |
| `--no-start` | подготовить установку, но не запускать приложение |
| `--skip-gstreamer-check` | пропустить долгий probe `dvbsubenc`; DVB нельзя считать проверенным |

Мастер сначала спрашивает online/offline, затем режим:

- **Test / development** — dev server, Vite и Electron в режиме разработки;
- **Production** — миграции, production build, опциональный installer,
  background service и shortcut.

Повторный запуск безопасен: `.env` обновляется с двумя резервными копиями,
миграции Prisma применяются повторно, service definition заменяется актуальной.

## Переменные окружения

Файл `.env` лежит в корне. Минимальный шаблон — `.env.example`.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `DATABASE_URL` | нет | PostgreSQL connection string; без неё health = degraded |
| `GRUBER_SECRET_KEY` | нет | ключ шифрования SRT/RTMP secrets |
| `GRUBER_HOST` | `127.0.0.1` | адрес Fastify; оставляйте loopback |
| `GRUBER_PORT` | `4310` | порт media-service |
| `GRUBER_MEDIA_API_URL` | `http://127.0.0.1:4310` | URL для Electron/web/launcher |
| `FFMPEG_PATH` | `ffmpeg` | executable FFmpeg |
| `FFPROBE_PATH` | `ffprobe` | executable ffprobe |
| `TSDUCK_PATH` | `tsp` | executable TSDuck |
| `GSTREAMER_LAUNCH_PATH` | `gst-launch-1.0` | GStreamer launcher |
| `GSTREAMER_INSPECT_PATH` | рядом с launcher | probe плагинов |
| `GRUBER_PREVIEW_DIR` | temp | program HLS preview |
| `GRUBER_MEDIA_CACHE_DIR` | temp | clip preview cache |
| `GRUBER_EFFECT_CACHE_DIR` | temp | временные effect assets |
| `GRUBER_LOG_DIR` | Desktop/FluxIO logs или home fallback | каталог журналов |
| `GRUBER_WEB_DEV_URL` | `http://127.0.0.1:5173` | Vite URL для Electron dev |

Ключ:

```bash
openssl rand -base64 32
```

Не меняйте `GRUBER_SECRET_KEY` без плана: уже сохранённые зашифрованные secrets
станут нечитаемыми.

## Development

Первый запуск:

```bash
npm ci --include=dev
npm run db:generate
npm run db:migrate
```

Затем три процесса:

```bash
npm run dev:server
npm run dev:web
npm run dev:desktop
```

`dev:server` и `dev:web` сначала пересобирают contracts: остальные workspaces
потребляют `@gruber/contracts` из `dist`.

## Production

`npm run setup` умеет установить:

- Linux: systemd unit;
- macOS: LaunchAgent;
- Windows: Task Scheduler task;
- desktop shortcut на всех трёх системах.

Обычный запуск установленного приложения:

```bash
npm run launch
```

Launcher проверяет `/api/health`. Если background service уже активен, Electron
подключается к нему и не владеет его жизненным циклом. Если launcher поднял
service сам, он остановит только этот дочерний процесс при завершении.

## Обновление

Перед обновлением:

1. остановить эфир штатно;
2. сохранить workspace и экспортировать критичные расписания/профили;
3. сделать backup PostgreSQL и `.env`;
4. обновить код;
5. выполнить `npm ci --include=dev`, `npm run db:migrate`, `npm run build`;
6. перезапустить background service;
7. проверить совпадение version UI и media-service;
8. провести тест на резервном endpoint.

Мастер выполняет основные шаги автоматически, но не заменяет backup.

## Быстрая проверка

```bash
curl http://127.0.0.1:4310/api/health
curl http://127.0.0.1:4310/api/capabilities
npm run typecheck
npm test
```

Статус `degraded` означает, что HTTP и media-инструменты доступны, но операции
workspace/configurations без PostgreSQL вернут 503.
