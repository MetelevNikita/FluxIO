# Этап 2.8 — автоматический поиск инструментов на Windows

Дата завершения: 2026-08-04.

## Проблема

Прежний `setup.mjs` проверял только команды из PATH текущего terminal. На Windows установщик или winget может обновить пользовательский/системный PATH уже после запуска PowerShell. Кроме того, PostgreSQL устанавливается в versioned directory, а portable FFmpeg может находиться вне PATH.

## Реализация

При старте мастер объединяет текущий PATH с Machine/User PATH, полученным через PowerShell. Для каждого инструмента выполняется последовательный поиск:

1. существующий абсолютный путь из `.env`;
2. команда через PATH и `where.exe`;
3. WinGet Links и WindowsApps aliases;
4. Chocolatey `bin/lib` и Scoop `shims/apps`;
5. standard install locations;
6. ограниченный рекурсивный поиск внутри WinGet Packages и tool-specific roots.

Поддерживаются:

- `ffmpeg.exe` и `ffprobe.exe`;
- `tsp.exe` TSDuck;
- `psql.exe` и `pg_isready.exe` PostgreSQL;
- `npm.cmd` рядом с запущенным `node.exe`.

Найденные пути проверяются реальным вызовом `-version` или `--version`, после чего сохраняются в `.env` как абсолютные. После winget installation Windows PATH перечитывается повторно. Для проверки локального PostgreSQL добавлен TCP fallback, поэтому отсутствие `pg_isready.exe` в PATH больше не блокирует уже работающий сервер.

TSDuck запускается по абсолютному пути к `tsp.exe`; его plugins остаются доступны, поскольку штатная Windows-сборка располагает их рядом с executable.

## Проверка

Добавлены тесты:

- построение WinGet/FFmpeg/TSDuck/PostgreSQL candidates;
- case-insensitive объединение Windows PATH без дубликатов;
- существующие тесты `.env`, database URL и background services.

Команды:

```bash
node --check setup.mjs
node --test setup.test.mjs
npm test
```
