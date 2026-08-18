# CLAUDE.md

Ориентир для работы с кодом FluxIO. Подробности предметной области — в `docs/architecture.md`
и runbook-ах `docs/*-engineer-runbook.md`; здесь только то, что нужно, чтобы быстро и безопасно
вносить изменения.

## Что это за приложение

Desktop playout: анализ локальных видеофайлов → сборка эфирного плейлиста → кодирование через
FFmpeg → выдача MPEG-TS на головную станцию по UDP / SRT или FLV по RTMP(S).

Ключевой архитектурный принцип: **эфирный контур отделён от интерфейса**. Долгоживущий
Node.js/Fastify media-service владеет состоянием в PostgreSQL и дочерними процессами
FFmpeg / TSDuck / GStreamer. Electron + React только шлют HTTP-команды и опрашивают статус,
поэтому закрытие окна не обрывает эфир. UI никогда не запускает FFmpeg сам.

## Раскладка репозитория

npm workspaces, `packages/*` и `apps/*`:

| Workspace | Пакет | Роль |
|---|---|---|
| `packages/contracts` | `@gruber/contracts` | Zod-схемы + выведённые типы. **Единственный источник правды** для формы данных между UI и сервером. |
| `apps/media-server` | `@gruber/media-server` | Fastify API, Prisma, supervisor FFmpeg/TSDuck/GStreamer. |
| `apps/web` | `@gruber/web` | React + Vite, интерфейс оператора. |
| `apps/desktop` | `@gruber/desktop` | Electron shell: окно, splash, узкий preload-мост к нативным диалогам. |

В корне: `setup.mjs` (интерактивный мастер установки, ~1800 строк, со своим `setup.test.mjs`),
`launch.mjs` (запуск установленного приложения), `docs/`, `deploy/systemd/`.

`FluxIO.fig` — 36 MB бинарный макет Figma в корне репозитория; к сборке отношения не имеет.

## Команды

```bash
npm run setup            # интерактивный мастер: зависимости, .env, PostgreSQL, сборка, запуск
npm run dev:server       # media-service в watch-режиме (tsx)
npm run dev:web          # Vite на 127.0.0.1:5173
npm run dev:desktop      # Electron поверх dev-сервера
npm run typecheck        # contracts + все workspaces
npm test                 # тесты всех workspaces + setup.test.mjs и launch.test.mjs
npm run db:migrate:dev   # новая миграция Prisma в разработке
npm run package:desktop  # installer под текущую ОС
```

Почти каждый скрипт начинается с `build:contracts` — это не украшение. `@gruber/contracts`
потребляется как скомпилированный `dist`, поэтому после правки схем **сначала** пересобери
contracts, иначе typecheck и dev-сервер увидят старые типы.

## Поток данных

```
Electron main (нативные диалоги) ──preload IPC──> React UI
                                                    │ HTTP + polling
                                                    ▼
                       Fastify media-service (apps/media-server/src/app.ts)
                          ├─ Zod-валидация запроса схемами из @gruber/contracts
                          ├─ DatabaseService (Prisma → PostgreSQL)
                          └─ PlayoutSupervisor
                               ├─ clip renderers (текущий + предзагруженный следующий)
                               ├─ постоянный program encoder
                               ├─ GStreamer dvbsubenc (отдельный subtitle PID)
                               └─ TSDuck transport (PCR, CBR, SCTE-35, merge, зеркало для preview)
```

Rolling playout — самое важное для понимания: недельный плейлист **не** отдаётся FFmpeg целиком.
Один долгоживущий encoder, отдельный renderer на текущий ролик, следующий renderer уже запущен и
блокируется на pipe. Переход между роликами не сбрасывает PID, mux clock и TSDuck output.

Опрос из UI: health каждые 2 с, playout status ~каждые 750 мс (`apps/web/src/App.tsx`).

## Куда вносить изменение

**Новая настройка кодирования / выходного протокола** (сквозной путь, порядок важен):

1. `packages/contracts/src/index.ts` — поле в соответствующую Zod-схему (`videoEncodingSchema`,
   `audioEncodingSchema`, `mpegTsOutputSettingsSchema`, `udpEndpointSchema`, …).
2. `npm run build:contracts`.
3. `apps/web/src/types.ts` (`BroadcastSettings`) + `apps/web/src/default-broadcast-settings.ts`
   (значение по умолчанию).
4. `apps/web/src/screens/BroadcastSettingsScreen.tsx` — контрол.
5. `apps/web/src/App.tsx` → `buildStartRequest()` — перенос значения из UI-состояния в запрос
   (там же живут `normalize*` хелперы для приведения строк UI к литеральным типам контракта).
6. `apps/media-server/src/ffmpeg/command-builder.ts` или `src/tsduck/command-builder.ts` —
   собственно аргумент процесса.
7. Тест в `apps/media-server/src/app.test.ts`.
8. Если настройка сохраняется в профиль `.json` — `apps/web/src/encoding-settings-profile.ts`
   и `encodingSettingsFileSchema` в contracts.

**Новый HTTP-эндпоинт**: схема запроса/ответа в contracts → маршрут в подходящем модуле
`apps/media-server/src/router/v1/*Route.ts` → функция-обёртка в `apps/web/src/media-api.ts`
(весь клиентский HTTP идёт только через неё). Всё, что маршруту нужно от сервера, приходит одним
`RouteContext` из `src/router/context.ts`; там же общие ответы `badRequest` / `notFound` /
`databaseUnavailable`. Новый модуль маршрутов регистрируется в `registerRoutes()` в `app.ts`.
Для маршрутов, принимающих плейлист, нужен `{ bodyLimit: largePlaylistBodyLimitBytes }` — недельное
расписание не влезает в дефолтный лимит Fastify.

**Новая звуковая дорожка / язык**: сопоставление файлов `{язык} <имя ролика>` живёт в
`apps/media-server/src/audio/tracks.ts` (там же ffprobe длительности каждого найденного файла),
таблица языков → ISO 639-2 — в `audio/languages.ts`.
Набор дорожек программы фиксируется на Start (PMT неизменна): его строит
`apps/web/src/audio-program.ts`, каждая дорожка получает свой PID подряд от `udpAudioPid`.
Ролик без перевода отдаёт тишину, PID из PMT не пропадает.

**Новая операция с БД**: отдельный файл в `apps/media-server/src/database/operations/`, функция
первым аргументом принимает `DatabaseContext` (Prisma-клиент + шифр секретов). Затем тонкий метод
делегата в классе `DatabaseService`, чтобы вызывающий код не менялся. Преобразования строк БД
живут в `database/mappers.ts`, работа с recovery checkpoint — в `database/checkpoint.ts`,
шифрование SRT/RTMP секретов — в `database/secrets.ts`.

**Изменение поведения эфира**: `apps/media-server/src/ffmpeg/playout-supervisor.ts`. Приватные
методы `#prepareLoopCommands`, `#transitionToFutureSchedule`, `#spawnTsdDuck`, `#spawnDvbSubtitles`
— основные точки. Чистые хелперы вынесены в конец файла как экспортируемые функции
(`alignHotChangePlaylist`, `measurePcmS16leDbfs`, `shouldTransitionToFutureSchedule`, …) именно
чтобы их можно было тестировать без запуска процессов — держись этого приёма для новой логики.

**Новый нативный диалог**: канал в `apps/desktop/src/channels.ts` (и в союз `DesktopChannel`) →
та же строка в `preload.ts` с аннотацией `: DesktopChannel` → обработчик в подходящей группе
`apps/desktop/src/ipc.ts` → метод в `contextBridge` → тип в `apps/web/src/electron.d.ts`.
Сама работа с диалогом живёт в `apps/desktop/src/dialogs.ts`, проверка payload из renderer —
в `saveInput.ts`, создание окон и splash — в `windows.ts`.

Строки каналов **намеренно** продублированы в `channels.ts` и `preload.ts`: preload запускается
с `sandbox: true` и не может импортировать локальные модули в рантайме. Спасает `import type`
— он стирается при компиляции, а аннотация `: DesktopChannel` роняет сборку при расхождении.
Проверить, что в preload не появился рантайм-импорт: `grep require apps/desktop/dist/preload.js`
должен показывать только `electron`.

**Схема БД**: `apps/media-server/prisma/schema.prisma` → `npm run db:migrate:dev`.
`apps/media-server/src/generated/prisma/**` — сгенерированный клиент, руками не править.

## Соглашения

**Имена `GRUBER_*` — намеренное легаси.** Продукт переименован в FluxIO, но переменные окружения,
имя пакета `gruber-playout`, PostgreSQL database, service IDs и preload-мост `window.gruberDesktop`
сохранены ради обратной совместимости существующих установок. Не «чинить».

**Contracts-first.** Не описывай форму данных дважды. Тип на клиенте и на сервере должен выводиться
из одной Zod-схемы через `z.infer`.

**TypeScript строгий** (`tsconfig.base.json`): `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`,
`noUnusedParameters`. Неиспользуемый импорт ломает сборку.

**Тесты — node:test поверх скомпилированного вывода**, не ts-раннер: `tsc -p tsconfig.test.json`,
затем `node --test dist-test/*.js`. Юнит-тесты чистых функций, без моков процессов.

**Версия приложения продублирована в 13 местах.** При бампе синхронизируй: корневой `package.json` +
lockfile, `package.json` всех четырёх workspace-ов, `apps/media-server/src/app.ts` (`serviceVersion`),
`apps/media-server/src/app.test.ts`, `apps/web/src/App.tsx`, `apps/web/src/encoding-settings-profile.test.ts`,
`apps/desktop/src/splash.html`, `setup.mjs` (`applicationVersion`), `README.md`, `docs/versioning.md`.
Правила нумерации — `docs/versioning.md`: patch +1 за завершённый этап, а не за каждую правку.

**Документация этапа** — новый файл в `docs/progress/NN-MM-краткое-имя-vX.Y.Z.md`.
Документация на русском.

## Ловушки

- **Новый тест в `apps/web` регистрируется вручную в двух файлах.** `apps/web/tsconfig.test.json`
  перечисляет `include` пофайлово (нужен и сам модуль, и его `*.test.ts`), а `apps/web/package.json`
  перечисляет пути `dist-test/...` в скрипте `test`. Забудешь первое — файл не скомпилируется;
  забудешь второе — `node --test` молча не запустит его. В обоих случаях сборка зелёная.
  В этом сборочном контуре (`NodeNext`) относительные импорты обязаны быть с расширением `.js`,
  хотя Vite принимает и без него.
- **Сгенерированный Prisma-клиент одновременно в `.gitignore` и в индексе git** (15 файлов
  закоммичены до появления правила). `npm run db:generate` даёт diff-шум в файлах, которые правилом
  считаются игнорируемыми. Либо `git rm --cached` их, либо убрать правило — сейчас состояние
  противоречиво.
- **Номер 6.0.23 пропущен.** Коммит `3e8d7df` назван 6.0.23, но строки версии тогда не подняли;
  в v6.0.24 дерево синхронизировано целиком, минуя 6.0.23. Не пытайся «восстановить» пропуск.
- **Цепочка TSDuck для DVB-субтитров чувствительна к двум вещам** (обе стоили целого
  расследования, см. `buildTsdDuckCommand`): `-P merge` обязан идти **до** обеих стадий `-P pmt`
  — PID, уже объявленный в PMT основного потока, merge считает конфликтующим и молча
  выбрасывает, причём `--ignore-conflicts` не помогает. И `--max-queue` должен быть небольшим
  (сейчас 256): merge начинает вставку только после наполнения очереди, а subtitle PID отдаёт
  ~60 kbps, поэтому 4096 пакетов копятся полторы минуты и короткий ролик заканчивается раньше.
- **Рендерер аудиодорожки обязан отдать ровно `durationSeconds` ролика.** Program encoder читает
  видео со stdin и по одному raw-PCM pipe на дорожку; мультиплексор чередует все элементарные
  потоки, поэтому один молчащий вход останавливает выдачу целиком, а не только свою дорожку.
  Длину закрепляет хвост `apad=whole_len=N,atrim=end_sample=N` в
  `buildFfmpegClipAudioProducerCommand` (короткое добивается тишиной, длинное режется по сэмплу),
  а `#padClipAudio` в supervisor страхует это на уровне байт. Любой новый фильтр в этой цепочке
  ставь **до** хвоста — `loudnorm` и `aresample` меняют число сэмплов.
- **DVB subtitle PID и SCTE-35 cue plan фиксируются на старте транспортной сессии.** Их изменение
  требует Stop/Start; AGE / LOGO / FX / burn-in SRT будущих роликов, наоборот, применяются на лету
  через `PUT /api/playout/playlist`. Не перепутай эти два класса изменений.
- **Одновременно разрешена одна эфирная сессия**; повторный Start отдаёт `PlayoutConflictError`.
- **`GRUBER_SECRET_KEY` обязателен** для сохранения SRT/RTMP секретов (AES-256-GCM в
  `DatabaseService`). Без него сохранение конфигурации с секретом падает.
- **media-service читает `.env` по относительному пути** `../../../.env` от собственного модуля
  (`apps/media-server/src/index.ts`), то есть от корня репозитория. Изменение раскладки сборки
  ломает загрузку конфигурации.
- **Крупные файлы, где легко потеряться**: `apps/web/src/App.tsx` (~2400 строк, всё состояние
  приложения), `apps/media-server/src/ffmpeg/playout-supervisor.ts` (~2300),
  `apps/media-server/src/app.test.ts` (~2800).
- **Burn-in субтитры требуют FFmpeg с libass.** Обычная Homebrew-формула `ffmpeg` собрана без
  него, фильтра `subtitles` нет, и любой граф с burn-in падает как `AVFilterGraph: No such filter`.
  Это ловится в `capabilities.supports.burnInSubtitles`, preflight и превью отдают внятный текст.
  Лечится `brew install ffmpeg-full` либо переключением Subtitle output в DVB.
- **Превью считаются пулом на 4 задачи** (`thumbnailConcurrency` в `ffmpeg/media-preview.ts`).
  Раньше была одна общая очередь, и последняя картинка ждала все предыдущие — при импорте
  сотен файлов превью просто не догружались. Фильтр `thumbnail=n=8` вместо дефолтных 100 кадров:
  на 4K ProRes это 0.14 с против 0.64 с.
- **Два интеграционных теста падают на FFmpeg 9.x** — `filter script opens embedded ...`
  (`Unrecognized option 'filter_complex_script'`) и `SCTE-35 into captured UDP MPEG-TS`
  (нет IDR рядом с cue). Оба под флагами `GRUBER_RUN_FFMPEG_TESTS` / `GRUBER_RUN_SCTE35_TESTS`
  и в обычный `npm test` не входят. Это окружение, а не регрессия кода — проверено на чистом дереве.
- **`gst-inspect-1.0` при первом запуске строит реестр плагинов несколько минут.** `setup.mjs`
  это учитывает (таймаут 300 с, повтор, флаг `--skip-gstreamer-check`); любой новый код, дёргающий
  gst-инструменты, должен закладываться на то же самое.
