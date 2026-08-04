# Этап 2.1 — setup wizard и streaming-only UI

Дата: 2026-08-04.

## Результат

Основной installation flow сокращён до:

```bash
git clone <repository-url> GruberProject
cd GruberProject
node setup.mjs
```

Мастер без сторонних npm packages:

- спрашивает test/production;
- работает только с обычным PostgreSQL, без Docker;
- скрывает passwords;
- подключается к готовой DB либо создаёт role/database через psql;
- создаёт `.env` и сохраняет старую копию;
- сохраняет/генерирует `GRUBER_SECRET_KEY`;
- запускает `npm ci --include=dev`, Prisma generate/migrate, typecheck/tests и build;
- собирает installer для текущей macOS/Windows/Linux;
- устанавливает и запускает background media-service;
- проверяет health endpoint;
- при необходимости запускает Electron.

Background mode:

- Linux — systemd;
- macOS — LaunchAgent;
- Windows — Task Scheduler.

Из Broadcast Settings удалён блок файлового Output и связанный Electron IPC. Encoder формирует только program stream до UDP/SRT/RTMP(S) endpoint и внутренний HLS-preview.

## Проверки

```bash
node --check setup.mjs
node --test setup.test.mjs
npm run typecheck
npm test
npm run build
```
