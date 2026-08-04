# Этап 2.9 — подготовка Git-репозитория

Дата завершения: 2026-08-04.

## Структура

FluxIO хранится одним monorepo:

- `apps/desktop` — Electron shell и platform icons;
- `apps/web` — React operator console и media assets;
- `apps/media-server` — Node.js/FFmpeg/TSDuck/PostgreSQL service;
- `packages/contracts` — общие runtime/TypeScript contracts;
- `docs` — архитектура, runbooks и progress reports;
- root setup/package/TypeScript files.

## Что исключено

Корневой `.gitignore` исключает:

- `node_modules`;
- `dist`, `dist-test`, Electron `release` и coverage;
- generated Prisma Client;
- `.env` и его backups, но сохраняет `.env.example`;
- signing keys/certificates с private key;
- logs, caches, runtime data и локальные database backups;
- IDE, macOS и Windows metadata.

На момент настройки только `node_modules` и Electron `release` занимали примерно 1.6 GB; они полностью воспроизводимы через `npm ci`, Prisma generation и Electron Builder.

## Что хранится

- `package-lock.json` для воспроизводимых dependencies;
- Prisma schema и все migrations;
- исходники и тесты;
- документация;
- web media assets;
- Electron `icon.svg/png/icns/ico`: готовые platform assets нужны при сборке на Windows/Linux.

`.gitattributes` фиксирует LF для исходников, CRLF для `.bat/.cmd` и binary treatment для изображений, шрифтов и Electron icons.
