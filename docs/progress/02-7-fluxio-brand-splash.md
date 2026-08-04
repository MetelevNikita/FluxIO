# Этап 2.7 — FluxIO branding и startup splash

Дата завершения: 2026-08-04.

## Результат

- header использует собственный FluxIO antenna mark вместо иконки из Lucide;
- wordmark отображается как `Flux` + акцентный `IO`;
- favicon, Electron window, Dock/Finder, Windows и Linux assets приведены к новому знаку;
- antenna strokes увеличены с `2.2` до `2.8` в системе координат 24 × 24;
- Electron product name изменён на `FluxIO`, а стабильный `appId` и `GRUBER_*` environment names сохранены для совместимости;
- добавлено отдельное frameless splash-окно 1440 × 920, совпадающее со стартовым размером основного окна;
- progress и проценты анимируются 5 секунд, статусы последовательно показывают загрузку модулей, media-service и operator workspace;
- основной BrowserWindow создаётся скрытым и загружается параллельно; переход происходит после истечения 5 секунд и события `ready-to-show`;
- при повторном создании окна через macOS Dock splash не показывается повторно.

## Brand assets

Исходники Electron находятся в `apps/desktop/build`:

- `icon.svg` — Windows/Linux иконка с прозрачными внешними углами;
- `icon-mac.svg` — full-bleed macOS source;
- `icon.png`, `icon-mac.png`, `icon.icns`, `icon.ico` — готовые assets для packaging.

Web favicon находится в `apps/web/public/brand/fluxio-app-icon.svg`. Header использует компонент `apps/web/src/components/FluxIoLogo.tsx`, чтобы знак оставался резким при любом масштабе интерфейса.

## Пересборка и проверка

На macOS platform assets пересобираются из SVG одной командой:

```bash
npm run icons -w @gruber/desktop
```

Полная проверка:

```bash
npm run typecheck
npm test
npm run build
npm run package:desktop:dir
```

Фактически выполнены `typecheck`, 23 автоматических теста, production build и unpacked macOS packaging. В `FluxIO.app` подтверждены `CFBundleDisplayName=FluxIO`, новый `icon.icns` и `/dist/splash.html` внутри ASAR. Headless render отдельно проверил splash при 50% и header production-сборки при 1440 × 900.
