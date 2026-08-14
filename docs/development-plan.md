# План разработки

## Завершённые этапы

### 1. Фундамент

Статус: завершён 2026-08-03. Отчёт: [`progress/01-foundation.md`](progress/01-foundation.md).

- npm workspaces;
- Fastify media-service;
- React и Electron shell;
- общие Zod-контракты;
- build, typecheck и tests.

### 1.1. Figma UI

Статус: завершён 2026-08-03. Отчёт: [`progress/01-1-figma-ui.md`](progress/01-1-figma-ui.md).

- три основных экрана из `Gruber.fig`;
- нативный production scroll и очистка очереди;
- production assets и локальный шрифт;
- responsive desktop layout.

### 2. Одноканальный FFmpeg playout + PostgreSQL

Статус: завершён как MVP 2026-08-03. Отчёт: [`progress/02-playout-postgres.md`](progress/02-playout-postgres.md).

- capability detection;
- реальный ffprobe файлов и папок;
- playlist concat с нормализацией;
- H.264/H.265/MPEG-2 и AAC/MP2/AC-3;
- UDP/SRT/RTMP(S);
- logo overlay;
- HLS program preview;
- Start/Stop/status/logs;
- PostgreSQL/Prisma, миграция и encrypted endpoint secrets;
- Electron packaging и systemd unit;
- development/production runbooks.

### 2.1. Установка одной командой

Статус: завершён 2026-08-04. Отчёт: [`progress/02-1-setup-wizard.md`](progress/02-1-setup-wizard.md).

- root `setup.mjs` на Node.js readline;
- test/production questionnaire;
- обычный PostgreSQL без Docker;
- создание role/database через psql;
- `.env`, Prisma migrations, tests и build;
- systemd, macOS LaunchAgent и Windows Task Scheduler;
- native Electron package для текущей ОС;
- удалён файловый Output из streaming-only UI.

### 2.2. Runtime-метрики, логи и product icon

Статус: завершён 2026-08-04. Отчёт: [`progress/02-2-runtime-metrics-branding.md`](progress/02-2-runtime-metrics-branding.md).

- Fastify access logs отключены;
- terminal logs ограничены событиями playout и критическими ошибками;
- реальные CPU и output NET метрики;
- общий antenna icon для Electron/macOS/Windows/Linux.

### 2.3. Media preview и готовность импорта

Статус: завершён 2026-08-04. Отчёт: [`progress/02-3-media-preview-readiness.md`](progress/02-3-media-preview-readiness.md).

- реальные FFmpeg thumbnails и восьмикадровый filmstrip;
- HLS-preview выбранного исходного ролика с Play/Pause/Stop/Seek;
- безопасный доступ только к уже проанализированным media paths;
- состояния `Analyzing`, `Done` и `Error`;
- вертикальный scroll и sticky header для большой медиатеки;
- PostgreSQL-настройки скрыты из Broadcast UI и остаются внутренней частью media-service.

### 2.4. Надёжный HLS preview и эфирный countdown

Статус: завершён 2026-08-04. Отчёт: [`progress/02-4-live-preview-countdown.md`](progress/02-4-live-preview-countdown.md).

- HLS.js используется приоритетно в Electron/Chromium;
- network retry и media decoder recovery при подготовке/обновлении HLS;
- безопасный muted bootstrap после асинхронного Play с последующим восстановлением громкости;
- адаптивный 16:9 Playlist Preview без фиксированной разрушающей высоты;
- реальный 16:9 program preview во время вещания;
- `Remaining HH:MM:SS` для всей программы в Broadcast monitor.

### 2.5. Repeat, SCTE-35 planner и macOS icon

Статус: завершён 2026-08-04. Отчёт: [`progress/02-5-repeat-scte35-macos-icon.md`](progress/02-5-repeat-scte35-macos-icon.md).

- адаптивный 16:9 Encoding Monitor без обрезки кадра;
- реальный бесконечный repeat supervisor и номер цикла;
- SCTE-35 marker planner на timeline и defaults в Broadcast;
- PostgreSQL/Prisma persistence marker metadata;
- отдельная полноразмерная macOS icon без прозрачных боковых полей;
- документирована граница между планированием и фактическим TS injector.

### 2.6. SCTE-35 injector для UDP/SRT

Статус: завершён 2026-08-04. Отчёт: [`progress/02-6-scte35-injector.md`](progress/02-6-scte35-injector.md).

- Node.js cue planner переводит marker time в 90 kHz PTS;
- FFmpeg формирует CBR MPEG-TS и IDR в cue-time;
- TSDuck добавляет PMT `CUEI`, PID `stream_type 0x86` и `splice_info_section`;
- UDP/SRT output и runtime injector monitor;
- fail-closed lifecycle и requeue/increment Event ID при Repeat;
- реальный UDP capture integration test и SRT loopback verification.

### 2.7. FluxIO branding и startup splash

Статус: завершён 2026-08-04. Отчёт: [`progress/02-7-fluxio-brand-splash.md`](progress/02-7-fluxio-brand-splash.md).

- единый FluxIO antenna mark в header, favicon и Electron assets;
- `FluxIO` wordmark с акцентным `IO`;
- PNG/ICNS/ICO пересобираются из версионируемых SVG sources;
- frameless startup splash 1440 × 920 с пятисекундным progress;
- main window загружается параллельно и открывается только после готовности renderer.

### 2.8. Windows automatic tool discovery

Статус: завершён 2026-08-04. Отчёт: [`progress/02-8-windows-tool-discovery.md`](progress/02-8-windows-tool-discovery.md).

- refresh Machine/User PATH без перезапуска PowerShell;
- абсолютные пути FFmpeg, ffprobe, TSDuck и PostgreSQL tools;
- WinGet, Chocolatey, Scoop и стандартные install locations;
- повторный поиск после автоматической установки;
- TCP fallback для проверки локального PostgreSQL.

### 2.9. Git repository hygiene

Статус: завершён 2026-08-04. Отчёт: [`progress/02-9-git-repository.md`](progress/02-9-git-repository.md).

- один npm monorepo для desktop, web, media-service и contracts;
- root `.gitignore` для secrets, dependencies, build/runtime output;
- Prisma migrations tracked, generated Prisma Client ignored;
- Electron cross-platform icons tracked;
- `.gitattributes` для LF/CRLF и binary assets.

### 2.10. Надёжный запуск npm на Windows

Статус: завершён 2026-08-04. Отчёт: [`progress/02-10-windows-npm-spawn.md`](progress/02-10-windows-npm-spawn.md).

- стандартная Windows installation запускает `npm-cli.js` через `node.exe`;
- `npm.cmd` больше не передаётся напрямую в `spawn()`;
- shell fallback используется только если `npm-cli.js` отсутствует;
- macOS и Linux продолжают запускать обычную команду `npm`;
- одинаковый механизм применяется к install, Prisma, checks, build и Electron launch.

### 2.11. Cross-platform FFmpeg command tests

Статус: завершён 2026-08-04. Отчёт: [`progress/02-11-cross-platform-ffmpeg-tests.md`](progress/02-11-cross-platform-ffmpeg-tests.md).

- HLS manifest и segment paths проверяются как отдельные FFmpeg arguments;
- expected paths формируются через `node:path`;
- тест одинаково работает с `/` на Unix и `\\` на Windows;
- production FFmpeg command builder не изменён.

### 2.12. Platform-owned service paths

Статус: завершён 2026-08-04. Отчёт: [`progress/02-12-platform-service-paths.md`](progress/02-12-platform-service-paths.md).

- systemd `ExecStart` всегда использует POSIX path;
- macOS LaunchAgent program path всегда использует POSIX path;
- Windows не влияет на generated Linux/macOS service definitions;
- Windows Task Scheduler продолжает получать native Windows path.

### 2.13. FFmpeg progress compatibility

Статус: завершён 2026-08-04. Отчёт: [`progress/02-13-ffmpeg-progress-compatibility.md`](progress/02-13-ffmpeg-progress-compatibility.md).

- optional `-stats_period` удалён из playout command;
- machine-readable progress продолжает поступать через `-progress pipe:1`;
- `-nostats` по-прежнему скрывает ненужный interactive status output;
- Windows FFmpeg builds без `-stats_period` больше не завершаются при старте.

### 2.14. Windows service update restart

Статус: завершён 2026-08-04. Отчёт: [`progress/02-14-windows-service-restart.md`](progress/02-14-windows-service-restart.md).

- существующий Scheduled Task останавливается перед перерегистрацией;
- старый Node.js media-service больше не остаётся в памяти после build;
- новая задача запускается только с актуальным `dist`;
- Windows restart order защищён regression-тестом.

### 2.15. SRT transport through TSDuck

Статус: завершён 2026-08-04. Отчёт: [`progress/02-15-srt-tsduck-relay.md`](progress/02-15-srt-tsduck-relay.md).

- весь SRT output идёт через `FFmpeg → loopback UDP → TSDuck → SRT`;
- FFmpeg build больше не обязан содержать libsrt;
- plain SRT relay не добавляет SCTE-35 signaling или PID;
- SRT preflight проверяет поддержку через `tsversion --support srt`;
- RTMP остаётся прямым FFmpeg output; начиная с v4.2.8 любой UDP также идёт
  через TSDuck для финального PCR adjustment и transport regulation.

### 2.16. Offline Electron packaging

Статус: завершён 2026-08-04. Отчёт: [`progress/02-16-offline-electron-packaging.md`](progress/02-16-offline-electron-packaging.md).

- Electron runtime берётся из local `node_modules/electron/dist`;
- `node setup.mjs --offline` отключает npm/system downloads;
- offline preflight проверяет TypeScript, Vite, Prisma, Electron и electron-builder;
- без toolset cache доступна network-free unpacked application;
- стандартный offline-мастер всегда собирает unpacked application и никогда не запускает NSIS; полный installer собирается online.

### 2.25. UDP PCR enforcement

Статус: завершён 2026-08-06. Отчёт: [`progress/02-25-pcr-enforcement-v4.2.8.md`](progress/02-25-pcr-enforcement-v4.2.8.md).

- любой UDP output проходит через финальный TSDuck `pcradjust` и `regulate`;
- UI PCR target применяется независимо от SCTE-35;
- явный PCR PID и запас 2 ms удерживают фактический интервал ниже 40 ms;
- реальный тест проверяет PCR в захваченном UDP MPEG-TS на профиле 1080p25.

### 2.26. Transport bitrate verification after TSDuck

Статус: завершён 2026-08-06. Отчёт: [`progress/02-26-transport-bitrate-v4.2.9.md`](progress/02-26-transport-bitrate-v4.2.9.md).

- ручное значение передаётся в FFmpeg muxrate/pacing и TSDuck regulate;
- реальный capture проверяет wall-clock и PCR-derived bitrate с допуском 2%;
- сервер возвращает применённые bitrate и режим manual/auto в status;
- Encoding Monitor отделяет applied TS bitrate от FFmpeg progress bitrate.

### 2.27. UDP continuity hardening

Статус: завершён 2026-08-06. Отчёт: [`progress/02-27-continuity-hardening-v4.2.10.md`](progress/02-27-continuity-hardening-v4.2.10.md).

- loopback receive и endpoint send buffers увеличены до 4 MiB;
- UDP output использует фиксированный burst 7 × 188 bytes;
- TSDuck пассивно контролирует CC video/audio PID без маскирующего `--fix`;
- UI показывает internal CC error counter;
- реальный capture подтверждает ноль CC errors на конечном output.

### 3.1. Недельные расписания v5.0.0

Статус: завершён 2026-08-07. Отчёт: [`progress/03-01-weekly-schedule-v5.0.0.md`](progress/03-01-weekly-schedule-v5.0.0.md).

- импорт `.air` / `.txt`, UTF-8 и Windows-1251;
- Current/Future Playlist с окном 168 часов;
- Overrun/Underrun и типы movie/chop/clip;
- per-item AGE/LOGO с управлением после импорта;
- реальные AGE/LOGO overlays в FFmpeg program и preview;
- PostgreSQL/Prisma persistence per-item metadata.

### 3.2. Round-trip расписания v5.0.1

Статус: завершён 2026-08-07. Отчёт: [`progress/03-02-schedule-roundtrip-v5.0.1.md`](progress/03-02-schedule-roundtrip-v5.0.1.md).

- экспорт изменённого Current/Future в `.air` или `.txt`;
- выбор LOGO-файла/папки и AGE-папки;
- AGE по суффиксу `[0+]`…`[18+]`;
- графическая AGE-плашка в FFmpeg и текстовый fallback;
- Ctrl/Cmd+A, множественное выделение и массовые AGE/LOGO операции;
- Figma-макет и документация v5.0.1.

### 3.3. Восстановление Playlist-сессии v5.0.2

Статус: завершён 2026-08-07. Отчёт: [`progress/03-03-session-recovery-v5.0.2.md`](progress/03-03-session-recovery-v5.0.2.md).

- PostgreSQL snapshot Current/Future и encoder settings;
- server-side checkpoint текущего ролика и позиции каждые 5 секунд;
- автоматическое восстановление Electron после закрытия или reboot;
- ручной Resume с checkpoint либо запуск с начала;
- `Save session list` и безопасный `New playlist`;
- AES-256-GCM защита SRT/RTMP secrets.

### 3.4. Стартовый ролик и hot take v5.0.3

Статус: завершён 2026-08-07. Отчёт: [`progress/03-04-schedule-start-marker-v5.0.3.md`](progress/03-04-schedule-start-marker-v5.0.3.md).

- runtime-маркер стартового ролика Current Playlist;
- сохранение маркера в PostgreSQL workspace session;
- `Start from Marker` и явный `Start from beginning`;
- `Take on air` с предварительной проверкой и последовательным restart FFmpeg/TSDuck;
- приоритет аварийного Resume над ручным маркером;
- визуальная индикация точки старта в строке Playlist.

### 3.5. Перенос encoding settings v5.0.4

Статус: завершён 2026-08-07. Отчёт: [`progress/03-05-encoding-settings-profile-v5.0.4.md`](progress/03-05-encoding-settings-profile-v5.0.4.md).

- versioned `.txt` profile для encoder/output/SCTE-35 settings;
- строгая contract-валидация файла и ограничение размера 1 MB;
- Electron open/save dialogs и browser development fallback;
- исключение SRT passphrase и RTMP stream keys из переносимого файла;
- блокировка импорта во время активного playout;
- исправление переполнения текста карточки Schedule resources.

### 3.6. AGE duration и перенос LOGO в Playlist v5.0.5

Статус: завершён 2026-08-07. Отчёт: [`progress/03-06-age-logo-playlist-v5.0.5.md`](progress/03-06-age-logo-playlist-v5.0.5.md).

- автоматическое сопоставление `[0+]`…`[18+]` с файлами AGE-папки;
- длительность AGE от 10 до 60 секунд для Current/Future;
- обратимо совместимая разметка `insertAgeTitle {rating} duration {seconds}`;
- position/width/margin/opacity логотипа перенесены из Broadcast в Playlist;
- исключено двойное наложение channel logo в FFmpeg program output.

### 3.7. Полноэкранный AGE canvas v5.0.6

Статус: завершён 2026-08-07. Отчёт: [`progress/03-07-full-frame-age-v5.0.6.md`](progress/03-07-full-frame-age-v5.0.6.md).

- AGE-файлы трактуются как готовый RGBA-холст 1920×1080 или 3840×2160;
- FFmpeg масштабирует холст в output resolution и накладывает в `0:0`;
- позиция и размер плашки задаются внутри PNG/WebP дизайнером;
- JPEG/JPG исключены из AGE-сопоставления и preflight;
- текстовый fallback сохраняется, если графика рейтинга не найдена.

### 3.8. Календарная шкала и эфирная позиция v5.0.7

Статус: завершён 2026-08-08. Отчёт: [`progress/03-08-playlist-timeline-on-air-v5.0.7.md`](progress/03-08-playlist-timeline-on-air-v5.0.7.md).

- Current/Future получили устойчивую календарную привязку к понедельнику;
- Playlist показывает день, дату и точное плановое время каждого материала;
- текущая строка `ON AIR` синхронизируется с media-server и показывает прогресс;
- recovery checkpoint сохраняет ID и позицию внутри ролика и подсвечивает
  строку `STOPPED HERE` после перезапуска;
- Playlist расширен до 48%, а preview ограничен 620 px без нарушения 16:9;
- обновлён соответствующий макет Playlist в Figma.

### 3.9. Компактные раскрываемые строки Playlist v5.0.8

Статус: завершён 2026-08-08. Отчёт: [`progress/03-09-compact-collapsible-playlist-v5.0.8.md`](progress/03-09-compact-collapsible-playlist-v5.0.8.md).

- controls, thumbnail, название, время и codec собраны в один горизонтальный ряд;
- название получает адаптивный размер шрифта и ellipsis без перекрытия controls;
- каждый материал раскрывается и сворачивается независимо;
- свёрнутый материал оставляет время, название, AGE и LOGO;
- добавлены общие кнопки `Expand all` и `Collapse all`;
- новый вариант Playlist синхронизирован с Figma.

## Следующая очередь

### 4.1. Графика и титры v6.0.0

Статус: завершён 2026-08-10. Отчёт: [`progress/04-01-graphics-titles-v6.0.0.md`](progress/04-01-graphics-titles-v6.0.0.md).

- Effects library PNG/WebP/MOV с анализом длительности;
- per-clip FX stack и time-range handles;
- SRT SubRip burn-in по совпадающему имени ролика;
- Shift selection, group drag и group controls;
- нативный Add Clip для активного расписания.

### 4.2. Составные FX BG + per-clip title v6.0.1

Статус: завершён 2026-08-10. Отчёт: [`progress/04-02-paired-effects-v6.0.1.md`](progress/04-02-paired-effects-v6.0.1.md).

- общий PNG/video BG на все ролики;
- отдельная папка alpha-титров на каждый эффект;
- точное сопоставление имени title-файла и ролика без расширения;
- одновременная FFmpeg-композиция BG и TITLE;
- сохранение разрешённых путей в `.air/.txt` и workspace session;
- визуальные состояния `BG+TITLE` и `TITLE MISSING`.

### 4.3. Иерархия controls и Timeline Trimming v6.0.2

Статус: завершён 2026-08-10. Отчёт: [`progress/04-03-playlist-secondary-controls-v6.0.2.md`](progress/04-03-playlist-secondary-controls-v6.0.2.md).

- основные эфирные controls и полностью видимая кнопка `Start here` находятся в верхнем ряду ролика;
- вторичные функции вынесены вниз в порядке `SRT → FX → назначенные эффекты`;
- временная шкала FX/SRT/VIDEO перенесена из верхней части preview внутрь `Timeline Trimming`;
- строки стали двухуровневыми без изменения компактного свёрнутого состояния;
- обновлён соответствующий макет Playlist в Figma.

### 4.4. Универсальный Lottie Effects project v6.0.3

Статус: завершён 2026-08-10. Отчёт: [`progress/04-04-lottie-universal-effects-v6.0.3.md`](progress/04-04-lottie-universal-effects-v6.0.3.md).

- импорт Bodymovin/Lottie JSON из After Effects в project Effects library;
- извлечение operator-safe Properties: visibility, text, colors и transforms;
- live DotLottie preview с локальным WASM через media-service;
- server-side RGBA render в прозрачный MOV/QTRLE cache через FFmpeg;
- `Add to entire project` и `Add to clip` с защитой от повторных назначений;
- автоматическая замена cache path в существующих FX layers без сброса Timeline IN/OUT;
- восстановление Lottie cache из сохранённой PostgreSQL workspace session;
- отдельный Effects inspector синхронизирован с Figma.

### 4.5. DVB subtitles и draggable FX layers v6.0.4

Статус: завершён 2026-08-10. Отчёт: [`progress/04-05-dvb-subtitles-v6.0.4.md`](progress/04-05-dvb-subtitles-v6.0.4.md).

- два режима SRT: совместимый burn-in и отдельный DVB bitmap subtitle PID;
- общая временная шкала cue с учётом trim и позиции каждого ролика;
- GStreamer DVB encoder и TSDuck merge в CBR UDP/SRT MPEG-TS;
- PMT `stream_type 0x06`, ISO 639 language и `subtitling_descriptor`;
- параметры PID, языка, типа, шрифта, palette, bitrate и PTS offset в Broadcast;
- runtime-карточка DVB Subtitles в Encoding Monitor;
- перетаскивание FX-слоя целиком по Timeline Trimming с сохранением длительности.

### 4.6. Editable Lottie titles v6.0.5

Статус: завершён 2026-08-10. Отчёт: [`progress/04-06-editable-lottie-titles-v6.0.5.md`](progress/04-06-editable-lottie-titles-v6.0.5.md).

- отдельный всегда открытый блок `Editable text` в Effects inspector;
- редактирование обычных Lottie Text Layers и каждого text keyframe;
- поддержка Essential Graphics/Skottie text slots через `t.d.sid → slots[slotId].p`;
- multiline input с корректной Lottie-разметкой переноса строк через `\r`;
- явная диагностика title, преобразованных в shapes/outlines, и ограниченного embedded glyph set;
- серверный test подтверждает, что override меняет slot, реально используемый рендерером, а не inline fallback.

### 4.7. Windows GStreamer discovery v6.0.6

Статус: завершён 2026-08-10. Отчёт: [`progress/04-07-windows-gstreamer-discovery-v6.0.6.md`](progress/04-07-windows-gstreamer-discovery-v6.0.6.md).

- автоматический поиск GStreamer в user-only, system-wide и legacy Windows-каталогах;
- поддержка стандартных root environment variables GStreamer;
- отдельная setup-проверка `gst-inspect-1.0 --exists dvbsubenc`;
- понятная диагностика неполного Runtime без смешивания ошибки executable и plugin;
- Windows regression tests для абсолютных путей, содержащих пробелы.

### 4.8. GStreamer textrender compatibility v6.0.7

Статус: завершён 2026-08-10. Отчёт: [`progress/04-08-gstreamer-textrender-v6.0.7.md`](progress/04-08-gstreamer-textrender-v6.0.7.md).

- удалены неподдерживаемые параметры `draw-outline` и `draw-shadow` из DVB pipeline;
- сохранены документированные font, alignment, padding и AYUV параметры;
- DVB outline control удалён из Broadcast, чтобы UI не обещал несуществующую возможность;
- добавлен regression test на совместимость команды с Windows `textrender`.

### 4.9. Production recovery, Effects preview и platform polish v6.0.8

Статус: завершён 2026-08-10. Отчёт: [`progress/04-09-production-recovery-effects-v6.0.8.md`](progress/04-09-production-recovery-effects-v6.0.8.md).

- production launcher после перезагрузки проверяет media-service и запускает
  Electron только после готовности API;
- последняя Playlist-сессия автоматически сохраняется в PostgreSQL с debounce,
  а аварийный checkpoint восстанавливается без самовольного выхода в эфир;
- Effects preview поддерживает SD/FHD/UHD aspect, Start/Stop animation и
  обновляется после успешного `Render changes`;
- Scale X/Y поддерживает linked-режим, slider, числовой ввод и сброс к исходному
  Lottie value;
- устранены перекрывающиеся health/status requests, отмена session restore и
  длительная блокировка Node event loop при UHD Lottie render;
- Windows FX selector получил принудительную dark palette;
- Windows ICO пересобран как прозрачный multi-size icon, macOS ICNS — со
  скруглённой системной формой.

### 4.10. Windows DVB subtitle filesrc path v6.0.9

Статус: завершён 2026-08-10. Отчёт: [`progress/04-10-windows-dvb-filesrc-path-v6.0.9.md`](progress/04-10-windows-dvb-filesrc-path-v6.0.9.md).

- Windows drive-letter и UNC paths нормализуются в формат GLib с `/`;
- GStreamer больше не удаляет `\\` как escape-символы из временного SRT path;
- regression test воспроизводит путь `C:\\Users\\iptv\\AppData\\Local\\Temp`;
- POSIX paths остаются без изменений.

### 4.11. Broadcast loudness, resilient monitor и schedule handover v6.0.10

Статус: завершён 2026-08-11. Отчёт:
[`progress/04-11-broadcast-loudness-preview-schedule-v6.0.10.md`](progress/04-11-broadcast-loudness-preview-schedule-v6.0.10.md).

- опциональная realtime-нормализация финального audio до `-23 LUFS`;
- независимый HLS program monitor с atomic manifest и уникальными segment numbers;
- таймер оставшегося времени текущего ролика в Playlist;
- автоматический переход Current → Future с приоритетом Repeat;
- DVB subtitle PES/PTS monitor после merge TSDuck и исправленный default offset `0 ms`;
- русифицированный splash с версией, годом и контактами разработчика.

### 4.12. Компактный эфирный таймер и удаление FX v6.0.11

Статус: завершён 2026-08-11. Отчёт:
[`progress/04-12-playlist-air-timer-fx-removal-v6.0.11.md`](progress/04-12-playlist-air-timer-fx-removal-v6.0.11.md).

- selector `MOVIE/CHOP/CLIP` перенесён к хронометражу ролика;
- эфирный countdown отображается в той же компактной строке метаданных;
- правая зона controls больше не меняет компоновку во время проигрывания;
- каждый назначенный FX chip получил отдельную корзину;
- удаление FX снимает назначение только с выбранного ролика и не меняет
  библиотеку Effects проекта.

### 4.13. Общая PTS-база DVB subtitles v6.0.12

Статус: завершён 2026-08-11. Отчёт:
[`progress/04-13-dvb-subtitle-clock-sync-v6.0.12.md`](progress/04-13-dvb-subtitle-clock-sync-v6.0.12.md).

- FFmpeg program MPEG-TS и GStreamer DVB subtitles переведены на общую часовую
  точку MPEG-TS clock;
- SCTE-35 raw PTS формируется в той же 90-кГц шкале;
- TSDuck `pcrextract` наблюдает одновременно video PID и subtitle PID после
  merge;
- media-service сравнивает первый subtitle PTS с video origin и временем cue;
- Encoding Monitor показывает `Video PTS origin`, `Aligned/Mismatch` и ошибку
  синхронизации в миллисекундах.

### 4.14. Большие Playlist и recovery payload v6.0.13

Статус: завершён 2026-08-11. Отчёт:
[`progress/04-14-large-playlist-recovery-v6.0.13.md`](progress/04-14-large-playlist-recovery-v6.0.13.md).

- FFmpeg filter graph записывается в runtime script вместо Windows command line;
- playout log показывает размер graph и оставшуюся длину команды;
- Windows preflight выдаёт понятную ошибку, если одни media paths всё ещё
  превышают безопасный предел;
- workspace/start/take/next-playlist принимают JSON до 32 MiB;
- failed start без переданного кадра больше не становится recovery interruption;
- regression test моделирует 216 роликов и payload больше стандартного лимита
  Fastify.

### 4.15. Длинные FFmpeg input paths v6.0.14

Статус: завершён 2026-08-11. Отчёт:
[`progress/04-15-embedded-ffmpeg-inputs-v6.0.14.md`](progress/04-15-embedded-ffmpeg-inputs-v6.0.14.md).

- media-service оценивает длину scripted FFmpeg command до `spawn`;
- если media/AGE/logo/FX paths превышают безопасный порог, source inputs
  автоматически описываются `movie` source filters внутри filter script;
- прямые `-i` сохраняются для небольших Playlist, чтобы не менять обычный путь
  запуска без необходимости;
- regression test подтверждает, что 216 длинных Windows paths сокращаются с
  более чем 38 000 до менее чем 30 000 command characters;
- Log Output явно показывает `media paths embedded`.

### 4.16. Запуск недельного Playlist v6.0.15

Статус: завершён 2026-08-11. Отчёт:
[`progress/04-16-weekly-playlist-start-v6.0.15.md`](progress/04-16-weekly-playlist-start-v6.0.15.md).

- start/take API больше не наследуют общий 10-секундный timeout Electron;
- уже проанализированные duration/audio metadata передаются в playout request и
  исключают повторный `ffprobe` при старте;
- legacy sessions без metadata проверяются не более чем восемью параллельными
  workers с сохранением порядка роликов;
- Log Output сообщает начало подготовки и progress каждые 50 элементов;
- Current, Future, workspace и media scan поддерживают до 1000 элементов;
- regression scenario моделирует ровно 168 часов: 504 ролика по 20 минут.

### 4.17. Future import, адаптивный Broadcast и transport preview v6.0.16

Статус: завершён 2026-08-11. Отчёт:
[`progress/04-17-future-import-layout-transport-preview-v6.0.16.md`](progress/04-17-future-import-layout-transport-preview-v6.0.16.md).

- отдельные Current/Future Import queues и прямой переход на пустой Future;
- независимая прокрутка encoder settings и нижней части Encoding Monitor;
- растущие Playlist rows и двухколоночный FX layout;
- локальный post-TSDuck MPEG-TS mirror для UDP/SRT preview;
- реальная localhost transport-to-HLS проверка и адаптивный Browser QA.

### 4.18. Повторные FX и тёмные selectors v6.0.17

Статус: завершён 2026-08-11. Отчёт:
[`progress/04-18-repeat-fx-dark-selects-v6.0.17.md`](progress/04-18-repeat-fx-dark-selects-v6.0.17.md).

- один effect asset назначается одному ролику многократно;
- каждое назначение имеет отдельный layer ID и Timeline IN/OUT;
- `Add to clip`, `Add to entire project` и Playlist FX используют одну логику;
- все selectors Effects принудительно используют читаемую dark color scheme;
- добавлен regression test повторного назначения.

### 4.19. Rolling playout и transport hardening v6.0.18

Статус: завершён 2026-08-14. Отчёт:
[`progress/04-19-rolling-playout-hot-change-v6.0.18.md`](progress/04-19-rolling-playout-hot-change-v6.0.18.md).

- один persistent encoder заменил недельный FFmpeg concat graph;
- текущий и следующий clip-renderer подают raw video/audio через local pipes;
- HOT CHANGE пересобирает изменённый будущий renderer без рестарта transport;
- TSDuck исправляет CC, снимает ошибочный PCR с DVB subtitle PID и выдаёт
  subtitle PES с двухсекундным pre-roll;
- Broadcast показывает Playlist/Clip progress и live RMS dBFS;
- Playlist preview строит полную композицию ролика;
- `.txt` export хранит Lottie `titlePath#N`, `startOn`, `endOn`; `.air` удалён
  из вариантов сохранения;
- реальный UDP regression проходит два ролика и Repeat без зависшего FFmpeg.

### 4.20. Исправление старта rolling playout и Preview v6.0.19

Статус: завершён 2026-08-14. Отчёт:
[`progress/04-20-playout-startup-preview-v6.0.19.md`](progress/04-20-playout-startup-preview-v6.0.19.md).

- video/audio выхода clip renderer разгружаются в ограниченные startup buffers;
- следующий renderer подключается только после полного drain обоих потоков;
- Log Output подтверждает `pipe ready: video + audio`, а 30-секундный watchdog
  вместо бесконечного ожидания сообщает, какой raw stream не появился;
- composite Playlist Preview закрывает неиспользуемые program branches через
  sink и не блокируется заполненным FFmpeg progress pipe;
- ролик из восстановленной сессии может стартовать в composite preview по
  сохранённым duration metadata без повторного анализа всего расписания;
- реальный 1080p тест проверяет восстановленный Preview, rolling стык, CBR UDP,
  continuity, PCR и финальный post-TSDuck HLS.

### 3. Надёжность playlist engine

- rolling scheduler вместо одного большого filter graph;
- бесшовные skip/next и planned transitions без restart gap;
- black/slate fallback при ошибке файла;
- watchdog FFmpeg и политика restart;
- watchdog и автоматическая политика restart поверх ручного recovery v5.0.2;
- бесшовное переключение repeat без restart gap;

### 4. Media preparation

- checksum и повторный анализ только изменённых файлов;
- очередь ffprobe с ограниченной параллельностью;
- compatibility warnings до старта;
- optional pre-transcode/cache для проблемных материалов.

### 5. Production security и operations

- authentication/roles/TLS;
- remote operator deployment;
- structured metrics и alerting;
- log rotation policy;
- backup/restore command и recovery test;
- signed installers;
- automatic update/rollback procedure.

### 6. 24/7 и резервирование

- длительный soak-test;
- hardware encoder profiles;
- primary/backup channel;
- return-feed monitoring;
- GPIO/API controlled failover;
- MPTS и резервированный SCTE-35 injector как отдельные production-модули.

## Критерий следующего production milestone

Система считается готовой к пилотному постоянному каналу после 72-часового теста на целевом сервере без underrun/overrun, подтверждения всех форматов на головной станции, проверки восстановления PostgreSQL и измеренного запаса CPU не менее 30% на выбранном профиле.
