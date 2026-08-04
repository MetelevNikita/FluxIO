# Этап 2.10 — надёжный запуск npm на Windows

Дата завершения: 2026-08-04.

## Проблема

На Windows мастер находил `C:\Program Files\nodejs\npm.cmd`, но передавал этот command script напрямую в `child_process.spawn()` с отключённым shell. В таком режиме Windows не может создать процесс для `.cmd` и Node.js возвращает `spawn EINVAL` до запуска `npm ci`.

## Реализация

Для стандартной Windows installation мастер теперь находит `node_modules\npm\bin\npm-cli.js` рядом с текущим `node.exe` и запускает:

```text
node.exe npm-cli.js ci --include=dev
```

Аргументы передаются отдельно, поэтому пробелы в `C:\Program Files\nodejs` не требуют ручного quoting. Если CLI-файл отсутствует, используется fallback `npm.cmd` с включённым Windows command shell.

Этот механизм применяется ко всем npm operations мастера:

- `npm ci --include=dev`;
- Prisma generate и migrate;
- typecheck и tests;
- application build и Electron packaging;
- запуск media-service, Vite и Electron.

На macOS и Linux кодовая ветка не менялась: команда остаётся `npm`, а shell отключён.

## Проверка

Добавлены unit tests для:

- Windows invocation через `node.exe + npm-cli.js`;
- Windows fallback через `npm.cmd`;
- неизменного native npm invocation на macOS и Linux.
