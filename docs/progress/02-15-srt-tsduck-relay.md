# Этап 2.15 — SRT transport через TSDuck

Дата завершения: 2026-08-04.

## Проблема

Некоторые Windows FFmpeg builds не содержат libsrt. При обычном SRT без SCTE-35 supervisor пытался открыть endpoint непосредственно через FFmpeg и завершал preflight сообщением:

```text
FFmpeg does not support SRT output
```

При включённом SCTE-35 эта проблема уже отсутствовала, поскольку финальный SRT socket открывал TSDuck.

## Архитектура

Теперь любой SRT использует единый тракт:

```text
FFmpeg MPEG-TS → loopback UDP → TSDuck → SRT endpoint
```

FFmpeg должен поддерживать только локальный UDP. TSDuck проверяется командами `tsp --version` и `tsversion --support srt`.

### SRT без SCTE-35

TSDuck работает как чистый transport relay. Команда не содержит processors `pmt`, `spliceinject` или `splicemonitor`, поэтому PMT не изменяется, CUEI registration и SCTE PID не добавляются.

### SRT с SCTE-35

Между UDP input и SRT output подключаются существующие processors `pmt`, `spliceinject` и `splicemonitor`. Cue workflow и инженерные настройки остаются прежними.

## Неизменившиеся маршруты

- UDP без SCTE-35: FFmpeg напрямую в UDP endpoint;
- UDP с SCTE-35: FFmpeg → TSDuck injector → UDP;
- RTMP/RTMPS: FFmpeg напрямую в endpoint;
- RTMP с SCTE-35: отклоняется preflight.

## Проверка

Regression test подтверждает, что plain SRT:

- выбирает TSDuck transport;
- создаёт SRT caller output;
- принимает MPEG-TS через локальный UDP;
- не содержит ни одного SCTE-35 processor.

Дополнительно выполнен реальный loopback test: FluxIO сформировал H.264/AAC MPEG-TS, FFmpeg передал его в TSDuck по loopback UDP, TSDuck SRT caller подключился к локальному TSDuck listener, а итоговый capture был проверен через ffprobe. Тест завершился успешно без SRT support в FFmpeg data path.
