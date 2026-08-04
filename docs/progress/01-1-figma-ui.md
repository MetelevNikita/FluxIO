# Этап 1.1: перенос Figma-интерфейса

- Статус: завершён
- Дата: 2026-08-03

## Выполнено

- Локально разобран `Gruber.fig`: 788 nodes и 44 image assets.
- Извлечены и проверены три основных frame 1440 × 900.
- Перенесены точные цвета, Geist typography, spacing, borders и component states.
- В проект добавлены только используемые runtime-изображения.
- Старый стартовый dashboard заменён полноценной Live Console.
- Реализованы три экрана и интерактивные controls.
- Кнопка Browse подключена к нативному Electron-диалогу через узкий preload API.
- Production assets используют относительные URL, а health Electron получает через IPC без ослабления web security.
- Production-сборка открывается без тестовых роликов; очистка очереди также очищает плейлист.
- Высота desktop-shell фиксируется по viewport, поэтому внутренний вертикальный scroll работает в production Electron.
- Сохранено server-first разделение: UI не запускает FFmpeg напрямую.

## Проверенные сценарии

- переключение всех трёх вкладок;
- UI получает `Media service 0.1.0 ready`;
- очистка media queue и empty state;
- переход к плейлисту;
- выбор другого клипа обновляет preview и File Properties;
- play запускает движение timecode;
- выбор protocol и отключение Streaming блокирует зависимые поля;
- layout визуально проверен при 1440 × 900;
- ошибки браузерной консоли отсутствуют.

## Автоматические проверки

```bash
npm run typecheck
npm run build
npm test
```

Результат:

- TypeScript typecheck — успешно;
- production build всех workspace — успешно;
- media-service test — 1/1;
- npm audit — 0 известных уязвимостей.

## Исправления desktop production

После проверки собранной версии устранены две проблемы:

- `Clear Queue` теперь атомарно очищает медиатеку, плейлист и выбранный элемент;
- тестовые ролики выключены по умолчанию и доступны только при `VITE_ENABLE_DEMO_DATA=true`;
- для пустого плейлиста добавлен отдельный экран с возвратом в Media Library;
- корневой Electron layout ограничен высотой viewport, поэтому Import, Playlist и Broadcast используют собственный вертикальный scroll.

Воспроизводимая проверка выполнена на production bundle: демофайлы появились с явным флагом, после очистки получены `0 Files` и `Playlist is empty`; чистая повторная сборка запустилась без демофайлов. Нижняя секция Streaming и Log Output доступны прокруткой.

## Основные файлы

- `apps/web/src/App.tsx` — состояние приложения и маршрутизация.
- `apps/web/src/components/AppHeader.tsx` — header и системные метрики.
- `apps/web/src/screens/ImportAnalyzeScreen.tsx` — медиатека.
- `apps/web/src/screens/PlaylistPreviewScreen.tsx` — плейлист и preview.
- `apps/web/src/screens/BroadcastSettingsScreen.tsx` — настройки и монитор.
- `apps/web/src/styles.css` — реализация Figma design system.
- `apps/web/public/media` — media assets из макета.

## Следующий этап

Интеграция FFmpeg capabilities. Демонстрационные системные метрики и codec options будут заменяться реальными возможностями media host.
