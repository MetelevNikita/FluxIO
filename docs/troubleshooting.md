# Диагностика

Начинайте с симптома, затем проверяйте слой за слоем: UI → API → preflight →
child process → transport → receiver. Не меняйте несколько параметров
одновременно.

## Установка: EPERM при `npm ci` на Windows

```text
npm error code EPERM
npm error syscall unlink
npm error path R:\FluxIO\node_modules\@napi-rs\canvas-win32-x64-msvc\skia.win32-x64-msvc.node
```

`npm ci` сносит `node_modules` целиком, а Windows не отдаёт `.node`, загруженный работающим
процессом: `skia` держит media-service (он рисует сцены) или открытое окно FluxIO.

С версии 8.0.3 мастер проверяет это **до** сноса дерева и называет занятые файлы вместо
дампа npm. Порядок действий:

1. если по машине идёт эфир — выведите его из линии, остановка службы обрывает выдачу;
2. закройте окно FluxIO;
3. остановите фоновую службу:
   - Windows: `Stop-ScheduledTask -TaskName 'Gruber Playout Media Service'`
   - Linux: `sudo systemctl stop fluxio`
   - macOS: `launchctl bootout` по пути plist из вывода мастера;
4. убедитесь, что не осталось `node.exe` с путём установки в командной строке;
5. повторите `node setup.mjs`.

Если процессов нет, а файл всё ещё занят, его держит антивирус — повторите через минуту.
Мастер ничего не останавливает сам: на эфирной машине это означало бы разрыв выдачи ради
установки зависимостей.

## SRT: линия падает сразу после старта

```text
TSDuck: * Error: srt: error during srt_connect: Connection setup failure: connection timed out
TSDuck SRT relay exited with 1
FFmpeg stopped after injector failure (SIGTERM)
```

Это отказ **подключения**, а не кодирования: FluxIO в режиме caller не достучался до
приёмника. Проверять надо принимающую сторону:

1. приёмник поднят и слушает тот же порт (`srt://…?mode=listener`);
2. порт открыт наружу — SRT ходит по UDP, и правило для TCP его не пропустит;
3. совпадают парольная фраза (`passphrase`) и `stream id`;
4. адрес не занят другим отправителем: listener принимает одно подключение.

Со стороны FluxIO проверять нечего — кодировщик к этому моменту уже работал, о чём
говорят строки `Transmitted frames`. Причина и подсказка выводятся в статус эфира целиком,
читать журнал ради них не нужно.

Восстановить связь сама служба не пытается намеренно: FFmpeg пишет в трубу TSDuck, и
перезапуск транспортной стадии означает перезапуск всей цепочки — то есть разрыв эфира.
Поднимите приёмник и запустите эфир заново.

## Service NOT ACTIVE

```bash
curl -v http://127.0.0.1:4310/api/health
npm run start:server
```

Проверьте `GRUBER_MEDIA_API_URL`, host/port, background service, firewall и log.
Если service отвечает, но UI нет — проверьте version mismatch и Electron preload.

## Health degraded

Нет `DATABASE_URL` или database не подключилась. Проверьте PostgreSQL:

```bash
pg_isready -h 127.0.0.1 -p 5432
npm run db:migrate
```

Media analysis может работать, но workspace/configuration routes вернут 503.

## FFmpeg/ffprobe/TSDuck не найден

```bash
"$FFMPEG_PATH" -version
"$FFPROBE_PATH" -version
"$TSDUCK_PATH" --version
```

Если variable содержит path с spaces, храните значение в `.env` без shell
интерпретации. Повторите setup для platform discovery.

## Нет burn-in subtitles

```bash
ffmpeg -hide_banner -filters
```

Найдите filter `subtitles`. Нужна сборка с libass. Альтернатива — DVB output
для UDP/SRT.

## DVB subtitles не стартуют

```bash
gst-inspect-1.0 --exists dvbsubenc
gst-launch-1.0 --version
```

Проверьте plugin cache, executable paths, font, PID collision, language и
endpoint protocol. Первый GStreamer probe может строить cache несколько минут.

## Media file Error

- path абсолютный;
- service user читает file и parent directories;
- UNC share доступен без interactive login;
- extension поддержан picker;
- ffprobe открывает file;
- declared duration не нулевая.

```bash
ffprobe -v error -show_format -show_streams "/absolute/path/file.mov"
```

## Missing graphics после recovery

Workspace хранит paths, не files. Укажите replacement, верните mount/share или
удалите unresolved layer. Проверьте также font paths и `.fto` library.

## Preview пустой или завис

- остановите старую clip preview;
- проверьте HLS manifest/segments;
- убедитесь, что browser запрашивает актуальный session ID;
- прочитайте preview process logs;
- проверьте codec support;
- для composite preview проверьте все overlays/subtitles.

Programme output может быть исправен при падении только monitor preview.

## Start отклонён по bitrate

Manual transport bitrate ниже payload peak. Увеличьте TS bitrate или уменьшите
video/audio peaks. Учитывайте все audio tracks, DVB, SCTE и overhead.

## Hardware encoder unavailable

```bash
ffmpeg -hide_banner -encoders
```

Проверьте expected encoder (`h264_nvenc`, `h264_qsv`, `h264_vaapi` и т. п.),
driver/device permissions и VAAPI device. Тихого software fallback нет.

## Низкий fps/speed

1. отключите preview только для диагностики;
2. проверьте CPU/GPU utilization и thermal throttling;
3. измерьте scene region size;
4. проверьте UHD/full-frame graphics;
5. проверьте storage/network read latency;
6. убедитесь, что hardware profile реально применён.

Не лечите пропуски кадров снижением transport bitrate: это разные части тракта.

## Audio silence или короткая дорожка

Проверьте naming `{lang} basename`, ffprobe duration, programme language list,
codec/channels и PID. Короткий file намеренно дополняется silence; UI показывает
partial lane.

## Continuity/PCR errors

Сравните:

- direct loopback MPEG-TS до TSDuck;
- final endpoint после TSDuck;
- receiver capture.

Проверьте stable transport bitrate, packet loss, NIC local address, UDP buffer,
PCR period и отсутствие второго sender на том же endpoint.

## SCTE-35 не виден

- UDP/SRT, не RTMP;
- SCTE enabled;
- marker внутри clip duration;
- PID объявлен в PMT;
- pre-roll достаточен;
- command/segmentation type поддержан receiver;
- analyzer слушает final transport.

## Title неправильного размера/позиции

- target layout объявлен;
- override относится к нужной layout;
- Y/font нормализованы по frame height;
- fit-to-text target измерен;
- group parent/anchor корректны;
- editor и air используют один template version/font file.

## JSON task даёт ноль совпадений

Смотрите values каждого candidate key. `name` может быть именем гостя, а clip
name лежать в `title`. Используйте preview summary. Duplicate match values
сначала устраните.

## Log «service не отвечал»

Это event-loop lag. Ищите рядом операцию: большой synchronous parse, font scan,
image processing или renderer preparation. Повторяемый lag во время running
session — высокий приоритет.

## Что приложить к инциденту

- exact commit/version UI/service;
- OS и versions external tools;
- redacted `.env` без secrets;
- relevant daily log interval;
- Start request без secrets;
- receiver/analyzer output;
- minimal media/graphics reproduction;
- шаги и expected/actual;
- был ли активен Current/Future/Repeat/HOT CHANGE.
