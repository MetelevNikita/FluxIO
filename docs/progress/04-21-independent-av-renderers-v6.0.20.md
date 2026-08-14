# 04.21 — Независимые video/audio renderers для UDP playout v6.0.20

Дата: 2026-08-14.

## Симптом

UDP playout доходил до запуска FFmpeg и prefetched clip, но через 30 секунд
останавливался:

```text
Clip 1 renderer failed: no audio data received within 30 seconds
```

TSDuck и post-TSDuck Preview были запущены корректно, однако program encoder не
получал синхронную пару raw video/audio и поэтому не создавал MPEG-TS payload.

## Причина

Один clip renderer имел два независимых выхода: несжатый YUV420P и PCM. При
включённом EBU R128 `loudnorm` audio filter сначала накапливал материал. За это
время renderer заполнял системный pipe кадрами 1920×1080 и блокировался до
появления первого audio chunk. Простое увеличение RAM-буфера не является
решением: для 4K оно потребовало бы сотни мегабайт на текущий и prefetched клип.

Попытка перенести динамический `loudnorm` в persistent encoder также неверна:
его latency останавливает общий FFmpeg video/audio scheduler после первых
кадров.

## Реализация

1. Для каждого текущего и prefetched ролика запускаются две независимые ветки:
   video renderer и лёгкий audio renderer.
2. Video renderer формирует итоговый кадр ролика с AGE, LOGO, FX и Burn-in SRT,
   после чего отдаёт raw YUV420P.
3. Audio renderer отдельно читает audio stream, применяет trim/resample и, если
   включено, `loudnorm` с выбранными Target LUFS, True Peak и LRA. На выходе —
   PCM требуемой channel layout и 48 kHz.
4. Persistent encoder принимает готовые video/audio inputs, измеряет live dBFS,
   кодирует program и передаёт единый MPEG-TS в TSDuck.
5. Переход к следующему ролику происходит только после успешного завершения и
   полного drain обеих веток. Stop и HOT CHANGE завершают оба процесса.

Новый диагностический лог имеет вид:

```text
Clip renderer 1/257 started with video PID 1234, audio PID 1235: "name.mp4"
Clip renderer 1/257 pipe ready: video + audio
Transmitted frames: ...
```

## Проверка

- `npm test -w @gruber/media-server` — успешно;
- реальный output 1920×1080, MP2 48 kHz, активная нормализация -23 LUFS;
- два последовательных ролика и Repeat прошли через один persistent encoder;
- подтверждены UDP CBR, PID 0x1FFF stuffing, отсутствие video/audio continuity
  errors, PCR interval менее 40 ms и финальный post-TSDuck HLS Preview;
- реальный regression завершился штатно без зависших child processes.

## Обновление и проверка оператора

После `git pull` выполнить `node setup.mjs`. При Start Broadcast проверить, что
после двух PID renderer появляются `pipe ready` и затем `Transmitted frames`.
Если отдельная ветка не отдаёт данные за 30 секунд, Log Output укажет `video`
либо `audio` и сохранит stderr соответствующего процесса.
