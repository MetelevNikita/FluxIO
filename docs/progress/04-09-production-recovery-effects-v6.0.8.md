# 04.09 — Production recovery, Effects preview и platform polish v6.0.8

Статус: завершено 2026-08-10.

## Production launcher и восстановление

Ярлык FluxIO, создаваемый production-мастером, запускает корневой `launch.mjs`.
После перезагрузки launcher читает `.env`, проверяет `/api/health`, при
необходимости поднимает собранный media-server и только затем открывает Electron.
Прямой запуск packaged Electron executable остаётся UI-only режимом.

Playlist автоматически сохраняется в PostgreSQL через 2,5 секунды после
последнего изменения. Запросы сериализованы, поэтому более старый save не может
затереть новое состояние. При запуске восстанавливаются последний snapshot и
runtime checkpoint. Автоматический `Start Stream` намеренно не выполняется:
оператор выбирает Resume либо запуск сначала.

## Effects

- compact preview имеет профили SD 720×576, FHD 1920×1080 и UHD 3840×2160;
- Start/Stop запускает и приостанавливает DotLottie preview на текущем кадре;
- `Render changes` обновляет rendered preview и показывает подтверждение об
  успешном добавлении результата в текущий проект;
- Scale X/Y имеет linked/unlinked режим, sliders, numeric inputs и reset;
- исходные значения Lottie Property сохраняются в contract как `originalValue`,
  поэтому reset действительно снимает override;
- draft values отделены от rendered preview и не перезапускают анимацию на
  каждое движение slider.

## Устранение зависаний

- health и playout status polling больше не создают перекрывающиеся requests;
- session restore привязан к фактическому health state и не отменяется каждым
  двухсекундным обновлением нового объекта connection;
- клиентские API requests имеют timeout;
- server-side Lottie renderer отдаёт управление event loop между RGBA frames,
  поэтому health/status/workspace endpoints остаются отзывчивыми во время UHD
  render.

## Windows и macOS

Нативный FX selector принудительно использует dark color scheme и читаемые
option colors на Windows. Windows `icon.ico` содержит прозрачные PNG entries
16, 24, 32, 48, 64, 128 и 256 px без белой QuickLook-подложки. macOS `icon.icns`
собран из отдельного SVG со скруглённой фирменной плиткой и прозрачными углами.

## Проверка

- TypeScript typecheck всех workspaces;
- unit/integration tests для contracts, web, media-server, launcher и setup;
- production build Electron main/preload, web и media-server;
- проверка alpha channel PNG и multi-size ICO metadata.
