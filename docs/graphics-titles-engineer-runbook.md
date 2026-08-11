# Графика, FX-слои и SRT-субтитры

Применимо к FluxIO **v6.0.12**.

В раскрытой строке ролика вторичные функции расположены отдельным нижним рядом:
сначала `SRT`, затем селектор `FX`, затем уже назначенные эффекты слева направо.
Точная временная разметка слоёв находится в блоке `Timeline Trimming`.

## 1. Библиотека Effects

1. Откройте вкладку `Effects`.
2. Нажмите `Add effects` для выбора файлов или `Add folder` для рекурсивного импорта папки.
3. Поддерживаются `Lottie JSON`, `PNG`, `WebP` (статика с alpha) и `MOV`, `MP4`, `M4V`, `WebM` (анимация).
4. Media-service через `ffprobe` получает разрешение и длительность. Статика при назначении растягивается на весь ролик.
5. В карточке эффекта нажмите `Select folder` в блоке **Per-clip alpha titles**, если эффект состоит из общей подложки и индивидуального титра.

Основной файл эффекта является общей подложкой `BG` и используется для всех
роликов. В выбранной title-папке FluxIO рекурсивно ищет индивидуальный alpha-файл
по точному совпадению имени ролика без расширения:

```text
Видео:  /media/Programme 01 [16+].mp4
Титр:   /graphics/titles/Programme 01 [16+].png
```

Расширения могут отличаться. Для титров поддерживаются PNG, WebP, MOV, MP4,
M4V и WebM. Для настоящего alpha следует использовать PNG/WebP либо MOV с
alpha codec, например ProRes 4444.

Библиотека входит в `Save session list` и сохраняется в PostgreSQL вместе с назначениями. Сами media files не копируются в базу: сохраняются абсолютные пути на сервере.

### 1.1. Универсальный Lottie-проект из After Effects

1. В After Effects экспортируйте композицию через Bodymovin/Lottie в `.json`.
2. В `Effects` нажмите `Import Lottie / media` и выберите JSON.
3. Media-service проверит композицию, встроит локальные image assets и один раз отрендерит прозрачный cache-файл `MOV/QTRLE` через FFmpeg.
4. В правом инспекторе запустится live preview. В `Properties` доступны:
   - видимость каждого слоя;
   - text и text keyframes;
   - solid, fill и stroke colors;
   - position, scale, rotation и opacity;
   - прозрачный либо выбранный background color.
   Текстовые поля вынесены в всегда открытый блок `Editable text`. Он поддерживает обычные AE Text Layers, text keyframes и Essential Graphics text slots.
5. Измените значения и нажмите `Render changes`. После успешного server render
   появится уведомление о добавлении результата в текущий проект, а правый
   preview переключится на новый cache. Анимированное свойство сохраняет
   исходные keyframes, пока оператор не изменит его; после изменения оно
   становится явным статическим override.
6. `Add to entire project` назначает эффект всем роликам Current и Future без дублирования. Для одного материала выберите его в selector и нажмите `Add to clip`.
7. Точный момент выхода и ухода эффекта задайте в `Playlist → Timeline Trimming`: перетащите середину слоя для переноса анимации целиком либо используйте handles для изменения In/Out.

Внутренний Lottie JSON не отправляется в эфир напрямую. Схема исполнения:

```text
After Effects → Bodymovin JSON → DotLottie RGBA renderer → FFmpeg QTRLE/ARGB cache → Playlist FX overlay → encoder
```

Исходный JSON и связанные локальные assets должны оставаться доступными по тем же абсолютным путям. После восстановления сохранённой сессии FluxIO автоматически проверяет и при необходимости пересоздаёт render cache.

### 1.2. Preview и управление Properties

- selector над preview переключает форму кадра между `SD 720×576`,
  `FHD 1920×1080` и `UHD 3840×2160`; окно остаётся компактным и меняет aspect
  ratio, но этот selector не меняет разрешение эфирного encoder;
- `Start animation` и `Stop animation` запускают и приостанавливают только
  предпросмотр, сохраняя текущий кадр;
- поля Scale X/Y имеют slider и точный числовой ввод в процентах;
- включённая иконка цепочки меняет X и Y синхронно, отключённая — независимо;
- reset возвращает исходное значение из Lottie JSON, а не предыдущее значение
  текущего сеанса;
- незавершённые правки остаются draft и становятся видимыми в rendered preview
  только после успешного `Render changes`.

## 2. Назначение FX ролику

В раскрытой строке Playlist выберите эффект в selector `FX`. Каждый выбор создаёт новый слой. Порядок chips слева направо соответствует порядку наложения снизу вверх: последний добавленный эффект расположен выше предыдущих.

У каждого назначенного chip есть собственная корзина. Она удаляет только этот
слой у данного ролика и тем самым исключает его из следующего Start/Take. Сам
эффект остаётся в общей библиотеке проекта и доступен для повторного назначения.

При назначении составного эффекта слой получает общий `BG` и найденный для
ролика `TITLE`. Зелёный chip `BG+TITLE` означает успешное совпадение. Жёлтый
`TITLE MISSING` означает, что индивидуальный файл не найден: FluxIO оставляет
в эфире только BG и не останавливает плейлист.

Над video preview находится `Graphics timeline`:

- `VIDEO` — базовый нижний слой;
- `SRT` — слой прожигаемых субтитров;
- `FX 1`, `FX 2` и далее — графические слои;
- перетаскивание цветного тела слоя меняет момент срабатывания без изменения его длительности;
- жёлтые handles задают In/Out и изменяют длительность слоя.

Для MOV начальная длина берётся из `ffprobe` и ограничивается длиной ролика. PNG/WebP занимают весь ролик. Handles сокращают слой с обеих сторон с точностью `0.04 s`.

## 3. Групповая работа

- `Shift + click` выделяет непрерывный диапазон.
- `Ctrl/Cmd + click` добавляет или удаляет отдельный ролик.
- Перетаскивание элемента выбранной группы переносит всю группу с сохранением порядка.
- `MOVIE/CHOP/CLIP`, `AGE`, `LOGO`, `FX` и `SRT` применяются ко всей выбранной группе.

## 4. SRT-субтитры

Здесь `SRT` означает формат SubRip, а не транспортный протокол Secure Reliable Transport.

1. В Playlist нажмите `SRT subtitles folder` → `Select folder`.
2. FluxIO рекурсивно считывает `.srt`.
3. Имя должно совпадать с video без расширения:

```text
Программа 01.mp4
Программа 01.srt
```

4. Нажмите `SRT` в строке. Без совпадения кнопка остаётся OFF.
5. Перед стартом media-service проверяет абсолютный путь. Недоступный файл игнорируется без остановки playout.

В `Broadcast → Subtitle Output` доступны два режима:

- `Burn-in` — фильтр FFmpeg `subtitles`; текст всегда виден в UDP, SRT и RTMP/RTMPS;
- `DVB Subtitles` — отдельный bitmap elementary stream в MPEG-TS; абонент включает и выключает его на приёмнике. Работает только для UDP/SRT.

Для Burn-in FFmpeg на сервере должен иметь libass:

```bash
ffmpeg -hide_banner -filters | grep subtitles
```

Windows:

```powershell
ffmpeg -hide_banner -filters | findstr subtitles
```

Подробная настройка PID, языка и проверка головной станцией: [dvb-subtitles-engineer-runbook.md](dvb-subtitles-engineer-runbook.md).

## 5. Порядок композиции

```text
Burn-in: VIDEO → SRT captions → AGE → Channel LOGO → FX 1 BG → FX 1 TITLE → ... → encoder

DVB: VIDEO → AGE → Channel LOGO → FX → video PID
     SRT file → DVB bitmap encoder → separate subtitle PID
```

Последний FX находится сверху. Результат идёт одновременно в program output и HLS monitoring preview.

## 6. Ограничения v6.0.12

- изменения FX активного filter graph применяются при следующем Start/Take;
- BG и title-файлы должны оставаться доступными по сохранённым абсолютным путям;
- для прозрачной анимации рекомендуется MOV с alpha codec, поддерживаемым установленным FFmpeg;
- DVB subtitles доступны только в UDP/SRT MPEG-TS; RTMP/RTMPS использует Burn-in;
- первая реализация Lottie принимает композиции длительностью до 60 секунд и размером до 4096×4096;
- JavaScript expressions и сторонние After Effects plug-ins не выполняются: в JSON должны быть экспортированы поддерживаемые Lottie layers/keyframes;
- operator Properties намеренно ограничены безопасными эфирными параметрами; служебные shape paths, masks и expression internals не показываются как обычные поля;
- текст, преобразованный в After Effects командой `Create Shapes from Text`/outlines, уже не является Text Layer и не может редактироваться как строка; экспортируйте исходный Text Layer или Essential Graphics text slot;
- если JSON содержит встроенный массив `chars`, новый текст ограничен экспортированным набором glyphs; для произвольного текста экспортируйте нужный алфавит либо используйте доступный на сервере font;
- после `Render changes` уже назначенные FX-слои получают новый cache-файл автоматически, а их Timeline IN/OUT сохраняются.

## 7. Импорт и экспорт вместе с расписанием

`Save schedule` сохраняет FX-слои и SRT текущего Playlist. При повторном
импорте FluxIO восстанавливает порядок слоёв, `startOn`, длительность и явный
путь к субтитрам:

```text
insertGraphicElement_{Lower Third} backgroundPath {/media/fx/lower.mov} titlePath {/media/fx/titles/Programme.png} duration {00:00:05.00} startOn {00:00:12.50}
insertSRT {/media/subtitles/Programme.srt}
movie 00:25:15.00 /media/Programme.mp4
```

Полная спецификация и диагностика формата: [schedule-import-engineer-runbook.md](schedule-import-engineer-runbook.md).
