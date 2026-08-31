# Графика, эффекты и титры

## Два уровня

Level 1 связан с clip: channel logo и AGE. Level 2 — broadcast effect с
поведением, временем и данными. Decoration Level 2 бывает:

- scene — встроенное дерево nodes;
- file — готовое alpha media.

Animation in/out и Stinger всегда file-only. Остальные эффекты обычно scene.

## Виды broadcast effects

| Вид | Назначение | Источник данных |
|---|---|---|
| Animation in/out | intro/outro поверх clip | manual timing или JSON task |
| Dynamic title | произвольная плашка | manual fields или JSON task |
| Next program | анонс следующего movie | playlist name или task |
| Ticker crawl | строка постоянной скорости | manual, JSON/TXT file, RSS/Atom |
| Clock/countdown | эфирные часы или отсчёт | frame-derived air time |
| Stinger transition | закрытие стыка clips | video/PNG sequence + optional audio |

Эффект сначала планируется чистой функцией, затем plan применяется к playlist.
Порядок library и assigned layers — порядок наложения; автоматической сортировки
нет.

## File effects

Импортируются PNG/WebP и MOV/MP4/M4V/WebM. ffprobe определяет dimensions,
duration, pixel format и alpha. Статика занимает заданное окно, video
ограничивается source duration.

Stinger:

- alpha blend — source с alpha;
- luma blend — чёрный фон вырезается threshold;
- PNG sequence определяется по numbering соседних files;
- optional source audio подмешивается во все programme languages;
- cut point задаёт место перехода внутри animation.

## Сцена

Template содержит:

- metadata и target layouts;
- director `in/hold/out`;
- объявленные fields;
- nodes: group, rect, ellipse, text, image, video;
- transform tracks и keyframes;
- per-layout overrides;
- bindings, fit-to-text, gradient, shadow, reveal, text animator.

### Геометрия

- `x/width` — доля ширины frame;
- `y/height/font/radius/blur` — доля высоты;
- group transform складывается с children;
- group container может брать bounds из `fitToNodeId` и clipping;
- hit test использует тот же text measurement, что renderer;
- safe-area warning выдаётся только text.

### Время

Оператор задаёт moment и total duration. Director сохраняет длины in/out, hold
растягивается. Если total короче суммы in+out, обе части пропорционально
сжимаются.

Keyframe time локально к in или out. Hold не содержит keys. Easing принадлежит
key, к которому идёт interpolation. Bezier X ограничен 0..1, Y может
overshoot.

Renderer получает time из frame index. Wall clock запрещён: preloaded producer
может стартовать до своего выхода в эфир.

### Область рендера

Сначала измеряется text и fit-to-text, затем вычисляется box/region. На весь
show берётся union region, чтобы FFmpeg overlay имел фиксированное offset. UHD
full-frame RGBA слишком дорог, поэтому рисуется только region.

## Редактор титров

Editor открывается поверх Effects и возвращает в исходный effect.

- Scene tree отражает stacking order.
- Ctrl/Cmd-click создаёт multiselect.
- Group встаёт на место верхнего выбранного layer.
- Drag считается от snapshot node в pointer down.
- Anchor меняет reference point, не экранное положение.
- Snap threshold измеряется в screen pixels.
- Timeline показывает все layers, tracks раскрывает только там, где нужны.
- Text редактируется double click; field-bound node меняет sample.
- Undo/redo хранит scene history.
- Preview использует `drawScene`.

После изменения template обновите уже назначенные shows отдельным действием:
definition library и copies в clips — разные состояния.

## Fields и JSON Parser

Scene сама объявляет keys. JSON Parser:

1. читает object array, включая одну произвольную wrapper property;
2. показывает реальные keys/samples;
3. выбирает match source key по максимальному числу совпавших clip names;
4. связывает source keys с scene field keys;
5. показывает match summary до применения.

Сопоставление идёт по basename без path/extension и без учёта регистра.
Несколько records с одинаковым match value неоднозначны. Clip без найденной
record не должен получить чужие fallback данные при batch apply.

## Title file `.fto`

FluxIO Title Object — versioned JSON с marker, metadata и complete scene
template. Собственное расширение отделяет title от task/profile JSON.

Встроенные templates лежат в `assets/titles`. При import template получает
новые IDs, а internal bindings переписываются вместе с ними.

Перед сохранением проверьте:

- все field bindings существуют;
- fit/reveal target существует;
- font file доступен и содержит нужные glyphs;
- target layouts объявлены;
- text не выходит из safe area;
- node IDs уникальны;
- in/out не дают visual jump.

## Media nodes

Image/video в scene не декодирует rasterizer. Планировщик разрешает их в
обычный FFmpeg FX layer. Иначе однопоточный scene process не успеет одновременно
декодировать video и рисовать text. Duration show расширяется до media source,
чтобы decoration не обрывалась на середине.

## Fonts

Media-service сканирует system fonts, читает SFNT name/cmap и сообщает поддержку
Cyrillic. В scene хранится font file path; эфир регистрирует конкретный file,
а не надеется на совпадение family name.

## Диагностика

- Text без plate — проверьте общий director и reveal/group clip.
- Plate режет длинную строку — проверьте fit-to-text и measurement target.
- Preview/air расходятся — найдите вторую реализацию draw или wall clock.
- Node «улетает» при drag — delta считается не от pointer-down snapshot.
- JSON task даёт 0 matches — выбирайте key по значениям, не по знакомому имени.
- Cyrillic squares — выбран font без glyphs или file недоступен сервису.
- Stinger не закрывает cut — проверьте source duration, cut point и alpha/luma.
