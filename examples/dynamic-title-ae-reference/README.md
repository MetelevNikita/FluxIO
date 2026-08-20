# FluxIO Dynamic Title — референс After Effects

Генератор создаёт полноценный проект After Effects для эффекта **Dynamic title**.
В нём уже настроены прозрачная композиция, адаптивная подложка и анимация появления.

Для быстрого теста без After Effects используйте готовый
`FluxIO_Dynamic_Title_Test.json`: его можно сразу импортировать в FluxIO как Lottie.

В этой же папке находятся варианты для других динамических эффектов:

- `FluxIO_Next_Program_Test.json` — `next_title`, `next_subtitle`, `fit:next_title`;
- `FluxIO_Clock_Countdown_Test.json` — `clock`, `clock_caption`, `fit:clock`.

## Быстрый тест в FluxIO

1. Откройте **Effects → Dynamic title**.
2. В поле **Декор и подложка Lottie** загрузите `FluxIO_Dynamic_Title_Test.json`.
3. Выберите **Поле для текста → status**.
4. Введите текст, выберите шрифт и длительность.
5. Назначьте эффект проекту или ролику и сохраните изменения.

Готовый JSON содержит прозрачный фон, адаптивную подложку `fit:status`, красный
индикатор и анимацию появления продолжительностью около 0,7 секунды.

Для **Next program** выберите `Поле названия → next_title` и при необходимости
`Поле подзаголовка → next_subtitle`. Для **Clock / countdown** выберите
`Поле для значения → clock`; постоянную подпись можно направить в `clock_caption`.

## Как получить `.aep`

1. Сохраните текущий открытый проект After Effects.
2. Откройте After Effects.
3. Выберите **File → Scripts → Run Script File…**.
4. Запустите `create-fluxio-dynamic-title.jsx` из этой папки.
5. Рядом со скриптом появится `FluxIO_Dynamic_Title_Reference.aep`.

Если After Effects запрещает запись файла, включите:

**Settings → Scripting & Expressions → Allow Scripts to Write Files and Access Network**.

## Что находится в проекте

- `FluxIO Dynamic Title - EXPORT` — прозрачная композиция 1920×1080, 25 fps, 5 секунд.
- `FluxIO Dynamic Title - PREVIEW` — композиция для просмотра на тёмном фоне.
- `status` — Text Layer, который выбирается в FluxIO как **Поле для текста**.
- `fit:status` — Shape Layer адаптивной подложки.
- `decor:live-dot` — декоративный красный индикатор.

Анимация появления занимает примерно 0,7 секунды:

- подложка въезжает слева, проявляется и немного увеличивается;
- текст появляется с задержкой и коротким смещением;
- красный индикатор появляется с небольшим overshoot.

## Экспорт Bodymovin

Экспортируйте только композицию `FluxIO Dynamic Title - EXPORT`:

1. **Window → Extensions → Bodymovin**.
2. Выберите экспортную композицию.
3. Оставьте фон прозрачным.
4. Экспортируйте JSON.
5. В FluxIO откройте **Effects → Dynamic title** и загрузите JSON как Lottie-пресет.
6. Выберите **Поле для текста → status**.

## Главное правило адаптивной подложки

Имена связаны между собой:

```text
Text Layer:  status
Shape Layer: fit:status
```

Не анимируйте `Rectangle Path → Size` слоя `fit:status`. FluxIO изменяет именно это
значение для подгонки ширины. Для анимации используйте `Layer → Transform` — как сделано
в референсном проекте.

Если переименуете Text Layer, например в `title`, подложку также переименуйте в
`fit:title` и заново выберите поле в настройках FluxIO.
