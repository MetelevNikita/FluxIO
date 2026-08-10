# Дизайн-система интерфейса

## Источник

Основные операторские экраны реализованы по локальному файлу `Gruber.fig`. Актуальная FluxIO-ветка в Figma задаёт новый brand mark, wordmark, Electron application icon и `fluxio-splash`.

- SHA-256: `fc25e6de6688980bbebe793ac6362ea74754893fed10c4bdd19b1b29c49168fe`
- Размер основных frames: 1440 × 900.
- Frames: `import-analyze`, `playlist-preview`, `broadcast-settings`.
- Файл был разобран локально и не загружался в Figma Cloud или другие внешние сервисы.

Из архива использованы оригинальные preview, thumbnails и filmstrip-изображения. Копии для runtime находятся в `apps/web/public/media`.

## Токены

| Назначение | Значение |
|---|---|
| Основной фон | `#0A0B0D` |
| Основная поверхность | `#111316` |
| Глубокая поверхность | `#0D0F12` |
| Поднятая поверхность | `#181B1F` |
| Граница | `#262B32` |
| Акцент | `#F5D565` |
| Основной текст | `#F8FAFC` |
| Вторичный текст | `#94A3B8` |
| Приглушённый текст | `#64748B` |
| Ошибка | `#EF4444` |
| Предупреждение | `#F59E0B` |

Основной шрифт — Geist Variable. Он включён в сборку локально через `@fontsource-variable/geist`, поэтому серверу не нужен доступ к Google Fonts или другому CDN.

## FluxIO branding

- знак: акцентный rounded square и чёрная утолщённая antenna grid;
- wordmark: `Flux` основным цветом текста и `IO` цветом `#F5D565`;
- header и Electron splash используют одну геометрию знака;
- `icon.svg` и `icon-mac.svg` являются исходниками для PNG, ICNS и ICO;
- macOS source имеет full-bleed акцентный фон без белых полей, а Windows/Linux source сохраняет прозрачные внешние углы;
- при первом запуске Electron показывает frameless splash 1440 × 920, совпадающий со стартовым размером основного окна, на 5 секунд. Основной renderer загружается параллельно и появляется только после `ready-to-show`.

## Базовая геометрия

- Header: 64 px.
- Нижний encoding status bar: 48 px.
- Основные отступы экранов: 24 px.
- Основной gap: 20–24 px.
- Радиус карточек: 8–12 px.
- Ширина плейлиста: 48% рабочей области, минимум 560 px.
- Максимальная ширина Playlist preview: 620 px, соотношение строго 16:9.
- Ширина Encoding Monitor: до 576 px.
- Минимальное Electron-окно: 960 × 640; целевой размер: 1440 × 900.

## Экраны

### Import & Analyze

- добавление standalone-файлов;
- drag-and-drop видеофайлов;
- таблица metadata;
- состояния `Analyzing`, зелёный `Done` и `Error`;
- счётчик готовых материалов;
- вертикальный scroll таблицы и sticky header для больших подборок;
- очистка очереди;
- переход к плейлисту.

В Electron выбор файлов или папки передаёт абсолютные пути media-service. Таблица заполняется реальными duration, codec, profile, resolution, FPS, bitrate, audio и size из ffprobe. Browser-only drag-and-drop остаётся визуальным fallback без доступа к абсолютному пути.

Production-сборка стартует с пустой медиатекой. Макетные ролики можно включить только явно через `VITE_ENABLE_DEMO_DATA=true`; `Clear Queue` очищает одновременно медиатеку и плейлист.

### Playlist & Preview

- расширенная левая колонка для недельного расписания и уменьшенная правая
  preview-область;
- sticky-разделитель дня с русским названием дня недели и датой;
- отдельная моноширинная колонка точного времени старта каждого материала;
- раскрытая строка ролика имеет один горизонтальный ряд высотой 58 px: имя
  занимает гибкую колонку, уменьшается вместе с шириной контейнера и не
  перекрывает AGE/LOGO/type/start/delete controls;
- свёрнутая строка высотой 38 px оставляет время, название, AGE и LOGO;
- над расписанием расположены общие действия `Expand all` и `Collapse all`;
- FX selector создаёт голубые chips слева направо; последний chip соответствует верхнему слою композиции;
- активный `SRT` отображается зелёным, отсутствующий matching subtitle блокирует control;
- над 16:9 preview размещён компактный multi-track timeline: FX — голубой, SRT — зелёный, base VIDEO — фирменный жёлтый;
- In/Out handles должны оставаться заметными при любой длине FX и не перекрывать timecode;
- зелёное состояние `ON AIR` с полосой прогресса и оранжевое состояние
  `STOPPED HERE` для recovery checkpoint;
- выбор клипа и синхронное обновление preview/properties;
- Shift-range selection и drag-and-drop одной или нескольких строк с сохранением внутреннего порядка;
- добавление клипов;
- play/pause, stop, previous/next и repeat;
- seek и volume;
- полноэкранный preview;
- IN/OUT trimming;
- filmstrip и текущий playhead;
- encoding status bar.

Playlist preview — реальный локальный HLS-поток выбранного материала. Media-service запускает отдельный realtime FFmpeg-процесс с нормализацией в H.264/AAC; Play/Pause/Stop/Seek управляют этим процессом. Окно сохраняет соотношение 16:9, ограничивается доступной шириной и высотой viewport и не растягивает соседние панели. Filmstrip состоит из восьми JPEG-кадров, извлечённых FFmpeg и кэшированных по пути, размеру и времени изменения файла.

HLS.js используется раньше нативной HLS-ветки Chromium, повторяет загрузку ещё не готового manifest и восстанавливает media decoder после recoverable ошибок. Во время реального эфира Broadcast Monitor показывает 16:9 program preview после нормализации/logo, elapsed, total и `Remaining HH:MM:SS` всей программы из `-progress` FFmpeg.

Под filmstrip расположен SCTE-35 Marker Planner. Он привязывает Event ID, OUT/IN, duration и UPID к текущему playhead и отображает метки поверх timeline. Planner блокируется, пока оператор не включит его в Broadcast.

### Broadcast Settings

- video codec/profile/level/preset;
- resolution, frame rate и aspect lock;
- deinterlace;
- CBR/VBR/CRF и bitrate-параметры;
- audio codec/sample rate/channels/bitrate;
- UDP/SRT/RTMP/RTMPS;
- protocol-specific host/port/mode/latency/TTL/stream settings;
- logo overlay: file, position, width, margin и opacity;
- streaming enable/disable;
- скрытый stream key;
- Start/Stop, realtime HLS program preview, stats и FFmpeg log monitor.
- Repeat — отдельная фиксируемая кнопка рядом со Start; во время эфира она заблокирована;
- Encoding Monitor всегда сохраняет 16:9 и использует `object-fit: contain`, чтобы источник не обрезался;
- SCTE-35 card содержит injector defaults и marker count; Encoding Monitor показывает injector state, TS PID, observed/total cues, last/next Event ID и время до следующей метки.

Controls являются управляемыми React-полями. Codec options фильтруются capability matrix установленного FFmpeg. Start отправляет типизированную конфигурацию media-service, который выполняет preflight и безопасно собирает аргументы FFmpeg.

## Разделение реальных и демонстрационных данных

Уже реальные:

- health media service;
- соединение UI с Node.js;
- capability detection FFmpeg;
- ffprobe-анализ файлов и папок;
- FFmpeg thumbnails и filmstrip импортированных роликов;
- Playlist-screen HLS preview выбранного исходника;
- пользовательская навигация;
- добавление файлов в локальную очередь;
- изменение порядка и выбор элементов;
- transport/trimming controls;
- редактирование broadcast settings;
- logo overlay settings;
- UDP/SRT/RTMP(S) endpoint settings;
- Start/Stop и фактический FFmpeg status;
- HLS preview program output;
- encoding metrics и logs;
- загрузка UI и media assets из production-сборки через `file://`;

Пока демонстрационные или упрощённые:

- GPU-показатель и аппаратные encoder controls;
