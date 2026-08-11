# FluxIO

Текущая версия: **v6.0.12**.

Desktop-приложение для анализа локальных видеофайлов, сборки эфирного плейлиста, кодирования через FFmpeg и передачи сигнала на головную станцию по UDP, SRT, RTMP или RTMPS.

В v6.0.12 FFmpeg video, GStreamer DVB subtitles и SCTE-35 используют общую
MPEG-TS временную базу. Encoding Monitor измеряет PTS уже после TSDuck merge и
показывает `Aligned` либо фактическое отклонение subtitle clock.

Electron-интерфейс и installers используют бренд FluxIO: единый жёлто-чёрный antenna mark, wordmark с акцентным `IO` и пятисекундный стартовый экран размером с основное окно. Технические имена окружения `GRUBER_*`, PostgreSQL database и service IDs сохранены для обратной совместимости существующих установок.

## Быстрый запуск после клонирования

Нужны Git, Node.js 24+ и npm 11+. FFmpeg, TSDuck, GStreamer и PostgreSQL мастер проверит и при необходимости предложит установить. GStreamer используется для отдельного DVB subtitle PID. Docker не используется.

```bash
git clone <repository-url> GruberProject
cd GruberProject
node setup.mjs
```

Также можно запустить мастер через npm:

```bash
npm run setup
```

Интерактивный мастер спросит:

1. test/development или production;
2. существует ли уже PostgreSQL database/role;
3. port, database, username и скрытый password локального PostgreSQL;
4. PostgreSQL administrator, если базу нужно создать;
5. автоматически найденные пути FFmpeg/ffprobe, TSDuck `tsp`, GStreamer `gst-launch-1.0` и media-service port;
6. запускать ли typecheck/tests;
7. собирать ли Electron installer;
8. создавать ли системный ярлык FluxIO на рабочем столе;
9. устанавливать ли фоновый media-service и запускать ли интерфейс.

После ответов мастер сам создаёт `.env`, генерирует ключ шифрования, устанавливает npm dependencies, применяет Prisma migrations, собирает проект и запускает сервис.

На Windows достаточно нажать Enter в вопросах FFmpeg/ffprobe/TSDuck/GStreamer. Мастер обновляет `PATH` из системных и пользовательских Windows settings, проверяет `where.exe`, WinGet Links/Packages, Chocolatey, Scoop, `Program Files`, стандартные FFmpeg, TSDuck, GStreamer и versioned PostgreSQL directories. В `.env` сохраняются найденные абсолютные пути `.exe`.

Для npm мастер на Windows запускает `npm-cli.js` через `node.exe`, поэтому установка корректно работает и из стандартного каталога `C:\Program Files\nodejs` без ошибки `spawn EINVAL`. Поведение macOS и Linux не меняется: там используется обычная команда `npm`.

Даже в production мастер использует `npm ci --include=dev`: Electron, Vite, TypeScript и Prisma CLI нужны во время сборки. Запущенный media-service при этом работает с `NODE_ENV=production`.

Для изолированной машины с заранее подготовленными platform-native `node_modules` используйте `node setup.mjs --offline`. Мастер автоматически собирает network-free приложение в `apps\desktop\release\win-unpacked`, никогда не запускает NSIS и после установки может сразу открыть интерфейс. Полный Windows installer собирается только обычным online-запуском мастера.

На online-машине мастер после `npm ci` отдельно проверяет Electron runtime и при необходимости запускает `node node_modules/electron/install.js`; это требуется для Electron 43, где наличие npm package ещё не гарантирует наличие platform binary в `dist`.

PostgreSQL всегда подключается по `127.0.0.1`, поэтому SSL и адрес базы не запрашиваются.

Production background service:

- Linux — `systemd`;
- macOS — `LaunchAgent`;
- Windows — Task Scheduler.

Electron installer собирается нативно для текущей ОС: DMG/ZIP на macOS, NSIS EXE на Windows, AppImage/DEB на Linux.

## Git-репозиторий

Весь проект хранится в одном monorepo. В Git добавляются `apps`, `packages`, Prisma schema/migrations, setup-скрипты, документация, `package.json`, `package-lock.json`, web assets и Electron brand icons. Не добавляются dependencies, generated Prisma Client, compiled `dist`, installers в `release`, локальные `.env`, backups, logs и runtime data.

После клонирования отсутствующие dependencies/generated files восстанавливает:

```bash
node setup.mjs
```

Корневой `.gitignore` действует на все npm workspaces. `.env.example` нужно хранить в Git, а реальный `.env` с PostgreSQL password и `GRUBER_SECRET_KEY` — никогда.

## Что работает

- анализ duration/codecs/resolution/FPS/bitrate/audio через ffprobe;
- реальные JPEG thumbnails и filmstrip выбранного ролика через FFmpeg;
- локальный HLS-preview выбранного ролика с Play/Pause/Stop/Seek;
- устойчивое HLS-воспроизведение с повторным подключением при подготовке первых сегментов;
- явные статусы импорта `Analyzing`, `Done` и `Error`;
- прокручиваемая медиатека для большого количества файлов;
- последовательный realtime FFmpeg playout;
- H.264, H.265, MPEG-2, AAC, MP2 и AC-3;
- опциональная realtime-нормализация всей финальной программы по EBU R128 с
  эфирным target `-23 LUFS`, ограничением `-1 dBTP` и отключаемым bypass;
- CBR, VBR, CRF, deinterlace, progressive/TFF/BFF field order, управляемая I/P/B GOP structure и mono/stereo/5.1;
- CBR MPEG-TS по UDP/SRT с фиксированным muxrate, PID `0x1FFF` stuffing и регулируемой TSDuck-выдачей; UDP дополнительно получает финальную PCR-коррекцию; FLV по RTMP/RTMPS;
- выбор реального сетевого адаптера для UDP и настройка MPEG-TS service name/ID/provider, video/audio PID, service type, PCR interval и итогового Transport bitrate (`0` — Auto);
- автоматический AGE по суффиксам `[0+]`…`[18+]`: полноэкранный PNG/WebP 1920×1080 или 3840×2160 с готовой позицией и alpha масштабируется в выходной кадр, длительность 10–60 секунд;
- per-item logo overlay с выбором файла/папки и настройками позиции, размера, отступа и прозрачности прямо в Playlist;
- устойчивый независимый HLS-preview финальной скомпонованной программы с
  atomic playlist update, который продолжает работать при выдаче через TSDuck;
- Start/Stop, current clip, progress, FPS, bitrate, speed и счётчик transmitted frames в UI и console logs; во время кодирования media-server печатает activity каждые 5 секунд и при смене ролика;
- подтверждённый сервером `Applied TS bitrate` и режим `manual/auto` в Encoding Monitor;
- `Internal CC errors`, пассивный TSDuck continuity monitor и увеличенные UDP socket buffers для диагностики packet loss;
- живой 16:9 program preview и оставшееся время всего плейлиста в Broadcast;
- компактный `ON AIR` таймер до конца текущего ролика и selector `MOVIE/CHOP/CLIP`
  рядом с хронометражем, без сдвига управляющих кнопок Playlist;
- адаптивный 16:9 preview в Encoding Monitor;
- бесконечный Repeat расписания с номером текущего цикла;
- автоматическое повышение Future в Current после завершения Current и очистка
  Future под следующую неделю; редактирование Future синхронизируется во время
  активного Current, а включённый Repeat имеет приоритет и отключает переход;
- SCTE-35 marker planner: Event ID, break start/end, duration, segmentation type и UPID;
- удаление любого ролика непосредственно из списка Playlist;
- фактический SCTE-35 injector для UDP/SRT MPEG-TS через TSDuck: `CUEI` в PMT, `stream_type 0x86`, настраиваемый PID, двойная выдача cue и runtime monitor;
- принудительный multicast output через выбранный адаптер и финальная PCR-нормализация каждого UDP-потока, независимо от SCTE-35;
- реальные CPU и NET-метрики сервера без Fastify access-log шума;
- PostgreSQL/Prisma для внутреннего состояния и AES-256-GCM endpoint secrets;
- сохранение Current/Future через `Save session list`, server-side checkpoint каждые 5 секунд и ручное Resume после сбоя;
- календарная шкала Current/Future от понедельника: дата, день недели и точное плановое время старта каждого ролика;
- зелёная строка `ON AIR` с прогрессом текущего ролика и оранжевая точка `STOPPED HERE` после аварийного восстановления;
- расширенная колонка Playlist и уменьшенный 16:9 preview для более удобной работы с недельным расписанием;
- однострочные компактные элементы Playlist без переноса controls вниз;
- индивидуальное и массовое раскрытие/сворачивание роликов расписания;
- отдельная вкладка `Effects` с project library PNG/WebP/MOV/MP4 и Lottie JSON из After Effects: live preview, всегда открытый редактор Text Layers/Essential Graphics text slots, остальные operator Properties, transparent render cache и назначение всему проекту/выбранному ролику;
- per-clip FX stack: эффекты добавляются слева направо, отображаются слоями над
  video, удаляются отдельной корзиной у каждого chip, имеют редактируемые In/Out
  handles и перетаскиваются целиком по шкале времени ролика без изменения длительности;
- per-clip `SRT` captions: точное сопоставление имени ролика и `.srt`, автоматический OFF при отсутствии файла, выбор между FFmpeg burn-in и отдельным receiver-selectable DVB bitmap PID в UDP/SRT MPEG-TS;
- отдельный DVB subtitle encoder через GStreamer `subparse → textrender → dvbsubenc → mpegtsmux`; TSDuck добавляет `stream_type 0x06`, `subtitling_descriptor`, выбранный PID и сохраняет CBR transport stuffing;
- runtime-проверка DVB subtitle PES/PTS уже после merge TSDuck, чтобы отличить
  пустую PMT-сигнализацию от фактических bitmap subtitles и от потери на головной станции;
- Shift-range selection и перенос группы выбранных клипов мышью с сохранением их порядка; одинаковые controls применяются ко всей выбранной группе;
- `Add Clip` в Electron использует нативный диалог и анализирует новые файлы в активном Current/Future расписании;
- выбор стартового ролика в Current Playlist и безопасный `Take on air` на выбранный ролик во время активного эфира;
- экспорт и импорт полного переносимого encoding profile в `.txt` с проверкой формата и без записи SRT/RTMP secrets;
- независимый от Electron media-service;
- постоянный индикатор `ACTIVE / NOT ACTIVE` и адрес media-server в левом нижнем углу;
- единый production launcher и ярлык рабочего стола для Windows, macOS и Linux;
- production launcher после перезагрузки проверяет media-server, при
  необходимости запускает его и восстанавливает последнюю Playlist-сессию;
- автосохранение последней Playlist-сессии в PostgreSQL после изменений;
- Effects preview SD/FHD/UHD, Start/Stop animation, linked Scale X/Y с точным
  вводом и reset исходных Lottie values;
- русифицированный пятисекундный splash с текущим годом/версией и контактами
  BroflovskiTeam / `@MetelevNikita`;
- прозрачная multi-size Windows ICO без белого квадрата и скруглённая macOS ICNS;
- совместное завершение Electron и media-server по `Ctrl+C` в окне `setup.mjs`;
- FluxIO splash 1440 × 920 с пятисекундным progress и безопасным ожиданием готовности основного Electron-окна.

Каждый UDP/SRT поток проходит через `FFmpeg → loopback UDP → TSDuck`, где перед
endpoint выполняется CBR regulation, а для UDP также PCR-коррекция. SCTE-35
метки сохраняются в PostgreSQL вместе с элементами плейлиста; при включении injector TSDuck также
добавляет сигнализацию и cue-секции. RTMP/FLV не переносит SCTE-35 PID, поэтому
такой запуск отклоняется preflight-проверкой.

Настройки файлового экспорта удалены: приложение формирует только поток на выбранный endpoint.

## Документация

- [Development](docs/development-runbook.md)
- [Production](docs/production-runbook.md)
- [SCTE-35 для эфирного инженера](docs/scte35-engineer-runbook.md)
- [Импорт недельного расписания .AIR/.TXT](docs/schedule-import-engineer-runbook.md)
- [Восстановление Playlist-сессии](docs/session-recovery-engineer-runbook.md)
- [Перенос encoding settings через .TXT](docs/encoding-settings-engineer-runbook.md)
- [Графика, FX-слои и SRT-субтитры](docs/graphics-titles-engineer-runbook.md)
- [DVB-субтитры для эфирного инженера](docs/dvb-subtitles-engineer-runbook.md)
- [Архитектура](docs/architecture.md)
- [Версионирование](docs/versioning.md)

Проект является одноканальным production-candidate. Перед 24/7 вводом требуются soak-test, резервирование и независимый мониторинг сигнала на приёмной стороне.
