# Этап 2.16 — offline Electron packaging

Дата завершения: 2026-08-04.

## Проблема

На изолированной Windows-машине electron-builder доходил до packaging и пытался скачать Electron с GitHub:

```text
packaging platform=win32 arch=x64 electron=43.2.0
connect ETIMEDOUT 140.82.121.3:443
```

Dependency `electron` была установлена и позволяла определить версию 43.2.0, но распакованный Windows runtime в `node_modules\electron\dist` отсутствовал. Без явного local runtime electron-builder использовал отдельный download/cache workflow.

В Electron 43.2.0 npm package не объявляет `postinstall`: `npm ci` устанавливает package metadata и `install.js`, но platform runtime может отсутствовать. Online setup теперь явно запускает `node node_modules/electron/install.js`, если native executable не найден, и проверяет результат до electron-builder.

## Local Electron runtime

В desktop build configuration добавлено:

```json
"electronDist": "../../node_modules/electron/dist"
```

Теперь builder копирует уже установленный platform-native Electron и не загружает Electron release archive повторно.

## Offline setup mode

Команда:

```text
node setup.mjs --offline
```

отключает `npm ci` и автоматическую установку системных инструментов. До изменения `.env` и сборки мастер проверяет наличие:

- TypeScript;
- Vite;
- Prisma CLI и Prisma Client;
- Electron и platform-native executable;
- electron-builder.

Dependencies должны быть подготовлены на такой же ОС и архитектуре. Windows `node_modules` нельзя заменять каталогом, созданным на macOS или Linux.

Для ручного восстановления runtime на машине с интернетом:

```powershell
node .\node_modules\electron\install.js
```

После команды должен существовать `node_modules\electron\dist\electron.exe`.

## Два варианта Windows output

### Network-free unpacked application

```text
npm run package:desktop:offline-dir
```

Создаёт `apps\desktop\release\win-unpacked`. В этом режиме выключено редактирование Windows executable через загружаемый WinCodeSign/rcedit toolset; NSIS не запускается.

### Полный NSIS installer

Полный установщик использует NSIS, WinCodeSign/rcedit и сопутствующие electron-builder toolsets. Для первой полностью offline-сборки необходимо один раз выполнить Windows build на машине с интернетом и перенести весь каталог:

```text
%LOCALAPPDATA%\electron-builder\Cache
```

После переноса мастер в offline mode может собрать обычный installer без обращения к сети.

## Проверка

Offline directory packaging выполнен реально. electron-builder подтвердил:

```text
using custom unpacked Electron distribution
electronDist=.../node_modules/electron/dist
```

Typecheck, setup tests и полная application build завершились успешно.
