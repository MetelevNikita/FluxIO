# FluxIO

FluxIO — одноканальная desktop-система эфирного воспроизведения. Она анализирует
локальные видеофайлы, собирает Current/Future playlist, кодирует непрерывную
программу через FFmpeg и отдаёт её:

- MPEG-TS по UDP;
- MPEG-TS по SRT;
- FLV по RTMP или RTMPS.

Текущая версия берётся из корневого `package.json`. Проект находится в статусе
production candidate: основной контур и восстановление реализованы, но перед
круглосуточным вводом обязательны soak-test, резервный тракт и внешний контроль
сигнала.

## Главное об архитектуре

Интерфейс не владеет эфиром. Долгоживущий media-service хранит состояние,
управляет PostgreSQL и запускает FFmpeg, TSDuck и GStreamer. Electron/React
только отправляет команды и опрашивает статус. Закрытие окна не должно
останавливать background service.

```text
Electron main ── preload IPC ──> React UI
                                  │ HTTP
                                  ▼
                         Fastify media-service
                           ├─ PostgreSQL / Prisma
                           ├─ FFmpeg renderers + encoder
                           ├─ scene producers
                           ├─ GStreamer DVB subtitles
                           └─ TSDuck MPEG-TS transport
```

Rolling playout не передаёт недельный список одному процессу FFmpeg. Постоянный
encoder получает текущий клип из pipe, следующий renderer запускается заранее,
а переключение не сбрасывает transport clock, PID и выходной endpoint.

## Быстрый старт

Требуются Node.js/npm, PostgreSQL, FFmpeg/ffprobe и TSDuck. GStreamer с
`dvbsubenc` нужен только для отдельного DVB subtitle PID.

```bash
git clone <repository-url> FluxIO
cd FluxIO
npm run setup
```

Мастер:

1. выбирает online/offline и development/production режим;
2. проверяет или устанавливает внешние инструменты;
3. создаёт `.env` и локальную PostgreSQL;
4. устанавливает зависимости, запускает миграции, проверки и сборку;
5. при необходимости ставит background service и desktop shortcut.

После уже выполненной production-установки:

```bash
npm run launch
```

Разработка в трёх терминалах:

```bash
npm run dev:server
npm run dev:web
npm run dev:desktop
```

## Проверка изменений

```bash
npm run check:repo
npm run typecheck
npm test
npm run build
```

Аппаратно-зависимые FFmpeg/TSDuck/SRT/PostgreSQL сценарии выключены по
умолчанию; порядок их включения описан в
[testing-and-release.md](docs/testing-and-release.md).

## Структура

| Каталог | Назначение |
|---|---|
| `packages/contracts` | Zod-схемы и выведенные типы — единственный контракт UI ↔ server |
| `packages/scene-renderer` | одна реализация отрисовки титров для editor preview и эфира |
| `apps/media-server` | Fastify API, PostgreSQL, supervisor процессов |
| `apps/web` | React-интерфейс оператора |
| `apps/desktop` | Electron shell и узкий preload-мост |
| `assets/titles` | встроенные шаблоны `.fto` |
| `deploy/systemd` | пример Linux service |
| `docs` | актуальная документация |

## Документация

Начните с [индекса документации](docs/README.md).

- [Установка и конфигурация](docs/installation.md)
- [Руководство оператора](docs/operator-guide.md)
- [Архитектура](docs/architecture.md)
- [Расписания и медиатека](docs/schedules-and-media.md)
- [Эфир, кодирование и выходы](docs/playout.md)
- [Графика, эффекты и титры](docs/graphics-and-titles.md)
- [API media-service](docs/api.md)
- [Разработка](docs/development.md)
- [Эксплуатация и восстановление](docs/operations-and-recovery.md)
- [Диагностика](docs/troubleshooting.md)
- [Технический долг](docs/technical-debt.md)

Исторические progress-отчёты и планы удалены из рабочей документации. История
решений доступна в Git; долгоживущие архитектурные решения находятся в
[docs/adr](docs/adr).

## Важные ограничения

- API рассчитан на loopback. Не публикуйте media-service в сеть без отдельной
  аутентификации и фильтрации запросов.
- Абсолютные пути должны быть доступны именно пользователю background service.
- Hardware encoder не имеет тихого fallback на software.
- DVB subtitles работают только в UDP/SRT MPEG-TS.
- RTMP/RTMPS не переносит SCTE-35 и несколько независимых audio PID.
- HOT CHANGE сохраняет encoder и transport, а Take on air является управляемым
  перезапуском и может дать короткий разрыв.
- Green UI не заменяет измерение потока на независимом приёмнике.
