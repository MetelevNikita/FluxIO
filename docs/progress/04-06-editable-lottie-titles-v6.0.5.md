# 04.06 — Editable Lottie titles v6.0.5

Дата завершения: 2026-08-10.

Исправлена ситуация, когда импортированный Lottie title не показывал доступного
оператору текстового поля либо изменение не отражалось в preview/render cache.

Реализовано:

- text Properties вынесены из сворачиваемых layer groups в всегда открытый блок `Editable text`;
- обычные `t.d.k[].s.t` Text Layers и keyframes продолжают поддерживаться;
- добавлено разрешение Essential Graphics text slot по ссылке `t.d.sid`;
- override записывается в `slots[slotId].p.k[].s.t`, поэтому не перекрывается slot-механизмом проигрывателя;
- JSON Pointer экранирует `/` и `~` внутри slot ID;
- повторное использование одного slot несколькими layers не создаёт дубликаты полей;
- multiline editor преобразует UI `\n` в Lottie `\r`;
- при embedded `chars` показывается предупреждение об ограниченном наборе glyphs;
- если Text Layer отсутствует, UI объясняет необходимость повторного экспорта без `Create Shapes from Text`.

Проверка:

- TypeScript typecheck media-server и web;
- unit test обычного Text Layer;
- unit test Essential Graphics text slot с символом `/` в ID;
- unit test применения slot override к документу, используемому renderer;
- web unit test применения slot override в live Lottie preview;
- unit test предупреждения для embedded glyph set.
