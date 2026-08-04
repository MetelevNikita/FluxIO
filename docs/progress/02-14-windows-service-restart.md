# Этап 2.14 — Windows service update restart

Дата завершения: 2026-08-04.

## Проблема

Production build обновлял `apps/media-server/dist`, после чего мастер повторно регистрировал Windows Scheduled Task. Если предыдущий task instance всё ещё работал, `Start-ScheduledTask` мог не создать новый процесс, и media-service продолжал использовать уже загруженный старый JavaScript.

Из-за этого исправленная FFmpeg command могла находиться на диске, но запущенный процесс продолжал передавать устаревший `-stats_period`.

## Реализация

Windows installation command теперь выполняет операции в строгом порядке:

1. `Stop-ScheduledTask` для существующего media-service;
2. короткое ожидание завершения процесса;
3. `Register-ScheduledTask -Force` с актуальными путями;
4. `Start-ScheduledTask`, если в мастере выбран запуск сервиса.

Regression test проверяет, что остановка находится раньше регистрации новой задачи.

## Проверка обновления

После production build строка `stats_period` должна отсутствовать и в source, и в compiled file:

```powershell
Select-String -Path .\apps\media-server\src\ffmpeg\command-builder.ts -Pattern stats_period
Select-String -Path .\apps\media-server\dist\ffmpeg\command-builder.js -Pattern stats_period
```

Обе команды не должны возвращать совпадений.
