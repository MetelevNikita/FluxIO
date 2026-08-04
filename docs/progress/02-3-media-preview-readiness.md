# Этап 2.3 — Media preview и готовность импорта

Дата завершения: 2026-08-04.

## Результат

Импорт и локальная проверка материалов больше не используют макетные картинки и таймер. После выбора файлов интерфейс сразу показывает строки со статусом `Analyzing`, затем меняет каждую успешно прочитанную строку на зелёный `Done`. Переход к плейлисту разрешён только когда все материалы готовы.

Таблица медиатеки занимает доступную высоту экрана, прокручивается по вертикали и сохраняет заголовок колонок сверху. Это позволяет загружать большой каталог, не увеличивая окно Electron за пределы viewport.

## Реализовано

- `MediaPreviewService` на стороне Node.js;
- реальные JPEG thumbnails через FFmpeg;
- восьмикадровый filmstrip по длительности выбранного ролика;
- cache thumbnails по canonical path, file size, mtime, frame time и размеру;
- один локальный realtime HLS clip-preview с Play, Pause, Stop и Seek;
- native HLS или `hls.js` в renderer;
- drag-and-drop в Electron с безопасным получением абсолютного пути через `webUtils.getPathForFile`;
- разрешение thumbnail/preview только для файлов, успешно проанализированных media-service;
- остановка preview-процесса при смене клипа, паузе и закрытии service;
- удаление операторской карточки PostgreSQL из Broadcast Settings.

PostgreSQL и Prisma не удалены из архитектуры: база остаётся внутренним хранилищем media-service и настраивается мастером установки, но больше не занимает место в эфирном интерфейсе.

## API

- `GET /api/media/thumbnail?path=...&at=...`;
- `POST /api/media/clip-preview/start`;
- `POST /api/media/clip-preview/stop`;
- `GET /api/media/clip-preview/:sessionId/:file`.

## Проверка

- TypeScript typecheck всех workspaces;
- unit/API tests;
- настоящий FFmpeg integration test: генерация JPEG, запуск HLS, чтение manifest/segment и последовательный UDP playout двух клипов;
- browser-проверка: `overflow-y: auto`, фактическое переполнение таблицы, статусы импорта и отсутствие PostgreSQL-карточки в Broadcast.

Первый Play может потребовать около одной–двух секунд: FFmpeg должен подготовить начальный HLS segment. Это нормальная задержка локального preview, а не зависание кнопки.
