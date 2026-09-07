# Несколько программ на одном сервере

Одна установка FluxIO может одновременно вести несколько независимых
программ. Для каждой программы запускается свой `media-service`, используется
свой API-порт и своя база PostgreSQL. Бинарные файлы приложения, медиастек и
сам кластер PostgreSQL общие.

```text
один ярлык FluxIO → окно «Программы FluxIO»
                         ├─ Program 1 → API 4310 → БД fluxio
                         ├─ Program 2 → API 4311 → БД fluxio_p2
                         └─ Program 3 → API 4312 → БД fluxio_p3
```

Это отдельные эфирные контуры: плейлисты, настройки, сессии, checkpoint и
процессы FFmpeg/TSDuck/GStreamer одной программы не смешиваются с другой.
Закрытие окна Electron не останавливает ни один эфир — ими владеют фоновые
службы.

## Первая установка после `git pull`

На новой машине с интернетом:

```bash
git clone <repository-url> FluxIO
cd FluxIO
git pull --ff-only
npm ci --include=dev
npm run setup
```

В мастере выберите Production, создайте локальную PostgreSQL, установите
background service и ярлык. Мастер создаст первую программу:

- конфигурация: `.env`;
- реестр программ: `instances.json`;
- служба: `gruber-media.service` на Linux, `live.gruber.media` на macOS или
  `Gruber Playout Media Service` на Windows;
- API по умолчанию: `http://127.0.0.1:4310`.

После установки запускайте FluxIO одним ярлыком или командой:

```bash
npm run launch
```

Название первой программы мастер спрашивает при первоначальной установке.

Откроется обзор всех программ. Кнопка «Открыть программу» создаёт отдельное
операторское окно. Вернуться к обзору можно кнопкой «Программы» в шапке любого
операторского окна или повторным запуском ярлыка.

## Добавление второй или третьей программы

В окне «Программы FluxIO» нажмите **Добавить программу**, укажите название и
подтвердите создание. Следующий свободный API-порт и отдельная база выбираются
автоматически. Там же каждую программу можно переименовать.

У дополнительной программы есть кнопка **Удалить**. После подтверждения она
останавливает службу и необратимо удаляет отдельную базу, `.env` и runtime-файлы
этой программы. Активный эфир сначала нужно остановить. Основная программа
удаляется только вместе со всей установкой.

Команда ниже остаётся вариантом для администрирования без графического
интерфейса. Её можно выполнять, пока другие программы работают:

```bash
node setup.mjs --add-instance
```

Мастер спросит только:

1. название программы;
2. свободный API-порт — автоматически предлагается следующий после 4310;
3. имя отдельной базы PostgreSQL;
4. администратора PostgreSQL, если используется системная, а не комплектная
   база;
5. пользователя службы на Linux.

После этого мастер создаст, например:

```text
.env.program-2
database: fluxio_p2
API: http://127.0.0.1:4311
service: gruber-media-program-2.service
```

Порт проверяется и по реестру, и по реально запущенным процессам. Новая
программа появляется в окне обзора автоматически, без перезапуска Electron.

Для установленного офлайн-комплекта используйте его встроенный Node:

```bash
/opt/fluxio/runtime/node /opt/fluxio/app/setup.mjs --bundle=/opt/fluxio --add-instance
```

Windows:

```powershell
C:\FluxIO\runtime\node.exe C:\FluxIO\app\setup.mjs --bundle=C:\FluxIO --add-instance
```

## Отключение и возврат программы

«Удаление» сделано безопасным: служба отключается, но база и `.env` остаются.
Сначала нажмите Stop playout в нужной программе, затем выполните:

```bash
node setup.mjs --remove-instance=program-2
```

Эквивалентная явная команда:

```bash
node setup.mjs --disable-instance=program-2
```

Мастер откажется отключать программу в состоянии `starting`, `running` или
`stopping`. Вернуть её можно без повторной настройки:

```bash
node setup.mjs --enable-instance=program-2
```

В офлайн-установке к этим командам добавляются те же пути и `--bundle`, что в
примере добавления выше. Физическое удаление базы намеренно не автоматизировано:
оно необратимо и выполняется только после отдельной проверенной резервной копии.

Посмотреть ID, имена и порты без открытия интерфейса:

```bash
node -e "for (const x of require('./instances.json').instances) console.log(x.id, x.name, x.apiUrl, x.enabled ? 'enabled' : 'disabled')"
```

## Окно состояния

Обзор обновляется каждые две секунды и для каждой программы показывает:

- доступность службы и состояние эфира;
- текущий ролик или последнюю ошибку;
- FPS, скорость и bitrate;
- CPU, память и число процессов эфирной цепочки.

Сверху показаны общие значения:

- **CPU системы** — загрузка всей машины всеми процессами ОС;
- **CPU эфирных цепочек** — сумма процессов FFmpeg, TSDuck, GStreamer,
  рендереров и графики всех программ;
- доля машины — эта сумма, делённая на число логических ядер;
- память и количество процессов эфирных цепочек.

Например, `CPU эфирных цепочек = 200%` означает два полностью занятых
логических ядра. В эту цифру не входят Electron, PostgreSQL и сам Node.js;
они входят в общий показатель **CPU системы**.

Те же данные доступны командами:

```bash
curl http://127.0.0.1:4310/api/health
curl http://127.0.0.1:4310/api/playout/status
curl http://127.0.0.1:4310/api/system/metrics

curl http://127.0.0.1:4311/api/health
curl http://127.0.0.1:4311/api/playout/status
curl http://127.0.0.1:4311/api/system/metrics
```

## Посмотреть все службы и процессы FluxIO

Команды ниже ничего не останавливают: они показывают фоновые media-service,
Electron, PostgreSQL и дочерние FFmpeg/TSDuck/GStreamer-процессы вместе с PID,
родительским PID, CPU, памятью и временем работы.

Linux:

```bash
systemctl list-units --type=service --all 'gruber-media*.service'
ps -eo pid,ppid,%cpu,%mem,rss,etime,command --sort=-%cpu \
  | grep -E '[F]luxIO|[g]ruber|[m]edia-server/dist/index.js|[f]fmpeg|[t]sp|[g]st-launch-1.0|[p]ostgres'
```

macOS:

```bash
launchctl list | grep 'live.gruber.media'
ps -axo pid,ppid,%cpu,%mem,rss,etime,command \
  | grep -E '[F]luxIO|[g]ruber|[m]edia-server/dist/index.js|[f]fmpeg|[t]sp|[g]st-launch-1.0|[p]ostgres'
```

Windows PowerShell:

```powershell
Get-ScheduledTask -TaskName 'Gruber Playout Media Service*' |
  Format-Table TaskName, State

Get-Process node, ffmpeg, tsp, gst-launch-1.0, postgres, FluxIO -ErrorAction SilentlyContinue |
  Sort-Object CPU -Descending |
  Format-Table Id, ProcessName, CPU, @{Name='RAM_MB'; Expression={[math]::Round($_.WorkingSet64 / 1MB, 1)}}, StartTime

Get-CimInstance Win32_Process |
  Where-Object { $_.Name -match '^(node|ffmpeg|tsp|gst-launch-1\.0|postgres|FluxIO)\.exe$' -or $_.CommandLine -match 'FluxIO|gruber' } |
  Select-Object ProcessId, ParentProcessId, Name, CommandLine
```

Для просмотра только состояния, которое знает сам FluxIO, выполните из корня
установки. Команда обходит все включённые программы из `instances.json`:

```bash
node -e "for (const x of require('./instances.json').instances.filter(x => x.enabled)) console.log(x.apiUrl)" \
  | while read -r url; do echo "=== $url ==="; curl --fail --silent "$url/api/playout/status"; echo; done
```

В офлайн-установке замените `node` на `/opt/fluxio/runtime/node` и запускайте
команду из `/opt/fluxio/app`. В Windows используйте обзор «Программы FluxIO»
или вызовите `/api/playout/status` для адресов, напечатанных командой просмотра
реестра выше.

Не завершайте найденные процессы по имени через `kill`, `taskkill` или диспетчер
задач: так можно оставить сессию в неопределённом состоянии. Для остановки
используйте Stop playout в интерфейсе, а затем штатную команду службы ниже.

## Управление службами вручную

Linux/systemd:

```bash
sudo systemctl status gruber-media.service
sudo systemctl status gruber-media-program-2.service
sudo systemctl restart gruber-media-program-2.service
sudo systemctl stop gruber-media-program-2.service
sudo systemctl start gruber-media-program-2.service
journalctl -u gruber-media-program-2.service -f
```

macOS/LaunchAgent:

```bash
launchctl print gui/$(id -u)/live.gruber.media.program-2
launchctl kickstart -k gui/$(id -u)/live.gruber.media.program-2
tail -f "$HOME/Library/Logs/GruberPlayout/media-service.program-2.log"
```

Windows/Task Scheduler:

```powershell
Get-ScheduledTask -TaskName 'Gruber Playout Media Service program-2'
Start-ScheduledTask -TaskName 'Gruber Playout Media Service program-2'
Stop-ScheduledTask -TaskName 'Gruber Playout Media Service program-2'
```

## Обновление после следующего `git pull`

Перед обновлением остановите эфир во всех программах, сделайте backup и
остановите их фоновые службы. Например, на Linux:

```bash
sudo systemctl stop gruber-media.service gruber-media-program-2.service gruber-media-program-3.service
```

На macOS и Windows используйте команды из раздела управления службами выше.
Затем:

```bash
git status --short
git pull --ff-only
npm ci --include=dev
npm run setup
```

При повторном setup выберите существующую PostgreSQL. Мастер применит миграции
к основной и всем дополнительным базам, соберёт приложение и перезапустит
включённые дополнительные службы. Основная служба обновляется обычным шагом
production-установки.

При обновлении офлайн-комплекта сохраняются `.env`, `.env.program-*`,
`instances.json` и весь каталог `data/`; миграции также применяются ко всем
зарегистрированным базам.

## Резервная копия

К обычному backup добавьте реестр и конфигурацию каждой программы:

```bash
install -m 600 .env /backup/fluxio/.env
install -m 600 .env.program-2 /backup/fluxio/.env.program-2
install -m 600 instances.json /backup/fluxio/instances.json
```

PostgreSQL сохраняется отдельно для каждой базы. Чтобы пароль не попадал в
историю shell, загрузите сгенерированный `.env`:

```bash
set -a
. ./.env
set +a
pg_dump --format=custom --file=/backup/fluxio/program-1.dump "$DATABASE_URL"

set -a
. ./.env.program-2
set +a
pg_dump --format=custom --file=/backup/fluxio/program-2.dump "$DATABASE_URL"
```

Если сервер используется без интернета, заранее проверьте, что резервная копия
читается и что на носителе есть офлайн-комплект той же версии. Наличие нескольких
программ не создаёт аппаратную мощность: до эфира одновременно запустите их
тестовые выходы и убедитесь в окне обзора, что хватает CPU, RAM, пропускной
способности диска и доступных hardware-encoder sessions.
