# Этап 2.12 — platform-owned service paths

Дата завершения: 2026-08-04.

## Проблема

Генераторы systemd и macOS LaunchAgent использовали общий `path.join()`. Во время Windows test run он создавал разделители `\\`, хотя содержимое этих service definitions всегда принадлежит Linux или macOS и требует `/`.

В systemd unit получался некорректный фрагмент:

```text
ExecStart="/usr/local/bin/node" "\\srv\\Gruber Project\\apps\\media-server\\dist\\index.js"
```

## Реализация

Пути к compiled media-service в двух platform-specific generators теперь формируются через `path.posix.join()`:

- systemd unit;
- macOS LaunchAgent plist.

Windows Task Scheduler остаётся без изменений и получает native Windows path в своей Windows-only installation branch.

## Проверка

Systemd test проверяет точный POSIX `ExecStart`. LaunchAgent test дополнительно проверяет полный POSIX program path и отсутствие Windows separators. Благодаря этому все service-definition tests можно безопасно запускать на Windows, macOS и Linux.
