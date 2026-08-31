# Расписания и медиатека

## Поддерживаемые входы

Media picker принимает AVI, M2TS, M4V, MKV, MOV, MP4, MPEG/MPG, MXF, TS и
WebM. Фактическую поддержку codec определяет установленный FFmpeg.

Schedule:

- input: `.air` и `.txt`;
- output: только `.txt`;
- encoding: UTF-8/BOM или Windows-1251;
- максимум: 5 MiB;
- paths: абсолютные POSIX, drive-letter или UNC.

## Заголовок

```text
start on 12:00:00.00 - delay 5
```

`start on` задаёт временную сетку, `delay` входит до первого clip. Current
привязывается к текущей эфирной неделе, Future — к следующей; anchor date
сохраняется в workspace.

## Media rows

```text
movie 00:25:15.00 /media/Programme.mp4
chop 00:00:10.00 /media/Ident.mov
clip 00:01:00.00 /media/Promo.mp4
```

Заявленная duration — плановая и может стать trim out. ffprobe отдельно
определяет физическую duration. Несоответствие типа времени создаёт warning.

## Директивы следующего clip

Директивы накапливаются до media row и после неё сбрасываются.

AGE:

```text
insertAgeTitle {16+} duration {15}
```

Допустимо 10–60 секунд. Если graphic для рейтинга не найден, применяется
текстовый fallback.

Logo:

```text
insertLogoTitle {/media/branding/channel.png}
```

Logo может быть статическим или готовым video animation. JSON project не
является эфирным logo и должен быть заранее отрендерен.

File graphic layer:

```text
insertGraphicElement_{Lower Third} backgroundPath {/media/fx/lower.mov} titlePath {/media/fx/Programme.png} duration {00:00:05.00} startOn {00:00:12.50} endOn {00:00:17.50}
```

Хотя бы один из `backgroundPath/titlePath` обязателен. Несколько директив
сохраняют порядок слоёв. Старые numbered `titlePath#N` читаются для
совместимости и сохраняются при round-trip, но новые титры создаются scene
effects и `.fto`.

Broadcast effect show:

```text
insertBroadcastEffect {effect-id} startOn {00:00:02.00} endOn {00:00:07.00} fields {title=Новости}
```

Определение effect хранится в заголовочной части export, show ссылается на его
ID и значения scene fields.

SubRip:

```text
insertSRT {/media/subtitles/Programme.srt} state {on}
```

## AGE и logo library

AGE folder ищется по маркерам `0+`, `6+`, `12+`, `16+`, `18+`. Рекомендуются
full-frame PNG/WebP с alpha; весь холст масштабируется к output и накладывается
в 0:0.

Logo folder предпочитает имя `logo`, `channel` или `brand`, иначе первый
поддерживаемый file. Положение, ширина, margin, opacity и loop задаются в
Playlist.

## SRT subtitles

Имя SRT должно совпадать с video basename:

```text
Programme 01.mp4
Programme 01.srt
```

Folder сканируется рекурсивно. Режимы:

- Burn-in — FFmpeg `subtitles` filter, нужен libass;
- DVB — GStreamer создаёт отдельный bitmap PID, только UDP/SRT.

## Дополнительные audio tracks

Формат имени:

```text
{eng} Programme 01.m4a
{spa} Programme 01.wav
```

Token приводится к ISO 639-2/B. Поиск идёт в выбранной папке и рядом с video.
На один язык выбирается первый найденный file; максимум programme tracks
задаётся contracts. Длительность проверяет ffprobe, короткий track дополняется
тишиной.

Набор языков фиксируется на Start. Добавление нового языка посреди running
session потребовало бы изменить PMT и поэтому не выполняется.

## Current и Future

- Current — текущая очередь.
- Future — следующая очередь.
- Repeat блокирует автоматическое повышение Future.
- Start marker относится только к Current и не экспортируется в schedule.
- SCTE-35 markers хранятся в project/workspace, а не в текстовом расписании.

## Сохранение

Export в UTF-8/CRLF сохраняет текущий порядок, типы, durations, AGE, logo, file
graphics, broadcast effects и SRT. Абсолютные пути записываются буквально.

После save рекомендуется выполнить round-trip:

1. импортировать export в пустую тестовую сессию;
2. сравнить count/order;
3. проверить warnings и missing files;
4. открыть несколько complex clips в composite preview.

`.air` остаётся только legacy input, чтобы не создавать новый вариант формата.
