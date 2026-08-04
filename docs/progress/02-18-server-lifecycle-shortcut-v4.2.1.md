# 02.18 — Server lifecycle, desktop shortcut и v4.2.1

## Результат

FluxIO показывает реальное состояние media-server, корректно завершает весь
запущенный из setup runtime по `Ctrl+C` и создаёт production-ярлык рабочего
стола. Версия всех компонентов синхронизирована как `v4.2.1`.

## Индикатор media-server

В левом нижнем углу на всех трёх вкладках отображаются:

- server icon;
- зелёный `ACTIVE` или красный `NOT ACTIVE`;
- фактический адрес из `GRUBER_MEDIA_API_URL`, например `127.0.0.1:4310`.

Electron запрашивает `/api/health` каждые 2 секунды с таймаутом 1.5 секунды.
Поэтому остановка и восстановление server отражаются без перезапуска UI.

## Завершение по Ctrl+C

Для development-процессов setup завершает process groups media-server, Vite и
Electron. Для production background service используются штатные команды ОС:

- `systemctl stop gruber-media.service`;
- `launchctl bootout ... live.gruber.media.plist`;
- `Stop-ScheduledTask -TaskName 'Gruber Playout Media Service'`.

Обычное закрытие Electron-кнопкой не останавливает заранее установленный
background service. Совместная остановка выполняется именно при `Ctrl+C` в
terminal, где продолжает работать `node setup.mjs`.

## Ярлык и launcher

Production setup предлагает создать desktop shortcut с ответом по умолчанию
`Yes`. Ярлык вызывает `launch.mjs`, который:

1. загружает корневой `.env`;
2. проверяет `/api/health`;
3. при необходимости запускает production media-server;
4. запускает production Electron;
5. при закрытии Electron завершает media-server только если сам его создал.

Форматы ярлыка: Windows `.lnk`, macOS `.app`, Linux `.desktop`. Все варианты
используют фирменную antenna icon из `apps/desktop/build`.

## Проверки

- TypeScript typecheck всех workspaces;
- unit tests Windows/macOS/Linux shortcut definitions;
- tests platform service stop commands;
- tests launcher paths, health probe и Windows process-tree termination;
- полный существующий media-server и setup test suite.

Дополнительно выполнен реальный production-запуск на временном порту `44310`:
health вернул media-server `4.2.1`, Electron открылся, после `Ctrl+C` Electron
получил `SIGTERM`, media-server выполнил graceful shutdown, а порт перестал
принимать соединения.
