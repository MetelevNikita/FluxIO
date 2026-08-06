# 02.24 — Гарантированная offline-сборка Electron в v4.2.7

## Причина ошибки

Electron runtime уже находился в `node_modules\electron\dist`, поэтому этап
`win-unpacked` завершался успешно. После него `electron-builder` переходил к
target `nsis` и пытался скачать NSIS/WinCodeSign с GitHub. На изолированной
машине это завершалось `connect ETIMEDOUT ...:443`.

Такое происходило, если оператор в offline-мастере выбирал полный installer.

## Новое поведение

Команда:

```powershell
node setup.mjs --offline
```

в режиме Production теперь без дополнительного вопроса запускает только:

```text
npm run package:desktop:offline-dir
```

Этот script выполняет application build и `electron-builder --dir` с
отключённым редактированием Windows executable. NSIS не запускается, сетевые
загрузки не выполняются. Результат:

```text
apps\desktop\release\win-unpacked\FluxIO.exe
```

После сборки мастер продолжает установку background media-service, создаёт
ярлык и запускает Electron, если оператор подтвердил соответствующие вопросы.

## Защита от регрессии

Pure function выбора packaging script протестирована для online/offline и
test/production. При `offlineMode=true` она возвращает только
`package:desktop:offline-dir`, даже если installer flag ошибочно равен `true`.

## Активность media-server

В этом же обновлении добавлен лаконичный console progress активного encoder.
Media-service сообщает текущий ролик, frame, FPS, bitrate, speed и program time
раз в 5 секунд, а также сразу при переходе к следующему элементу Playlist.
Fastify access logs остаются отключёнными.

Версия всех компонентов: `v4.2.7`.
