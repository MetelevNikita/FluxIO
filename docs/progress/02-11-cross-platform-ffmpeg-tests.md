# Этап 2.11 — cross-platform FFmpeg command tests

Дата завершения: 2026-08-04.

## Проблема

Тест HLS preview ожидал строку `/tmp/gruber-test-preview/index.m3u8`. На Windows `node:path` корректно преобразует этот output path в `\\tmp\\gruber-test-preview\\index.m3u8`, поэтому FFmpeg command был правильным, но Unix-only regular expression завершала установку с ошибкой.

## Реализация

Проверка больше не ищет полный путь в склеенной строке command line. Вместо этого тест проверяет отдельные элементы массива FFmpeg arguments:

- значение после `-hls_segment_filename`;
- последний argument с путём HLS manifest.

Expected values формируются через `path.join()`, поэтому используются нативные разделители текущей операционной системы. Это также надёжнее для путей с пробелами: приложение передаёт их FFmpeg отдельными arguments, а не разбирает из текстовой command line.

Сам FFmpeg command builder не менялся.
