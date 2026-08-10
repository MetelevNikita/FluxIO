# 04.04 — универсальный Lottie Effects project v6.0.3

Дата завершения: 2026-08-10.

## Результат

- вкладка Effects принимает `.json`, экспортированный Bodymovin/Lottie из After Effects;
- media-service валидирует composition metadata и извлекает настраиваемые свойства слоёв;
- live preview воспроизводится официальным DotLottie renderer без CDN;
- Lottie кадры передаются в FFmpeg как RGBA и сохраняются в прозрачный `QTRLE/ARGB MOV`;
- оператор может назначить эффект сразу Current + Future либо одному выбранному ролику;
- после назначения эффект доступен в обычном FX stack и получает точный IN/OUT через Timeline Trimming;
- сохранённая session содержит source path, overrides и назначения, а временный render cache восстанавливается автоматически;
- версия приложения увеличена до `6.0.3`.

## Проверка

- unit tests проверяют извлечение visibility/text/fill/transform properties;
- unit tests проверяют применение overrides и сохранение исходной анимации без override;
- реальный fixture отрендерен как 25 кадров `qtrle`, `argb`, 25 fps, 1.0 s;
- выполнены typecheck, общий test suite, production build и `git diff --check`.

## Ограничения первой реализации

- композиция ограничена 60 секундами и 4096×4096;
- поддерживаются возможности Lottie renderer, а не произвольные After Effects plug-ins/expressions;
- внутренние технические параметры JSON не выдаются оператору, если их редактирование может разрушить композицию;
- изменения графики активного FFmpeg filter graph применяются при следующем Start/Take.
