# 02.20 — SCTE-35 UDP delivery, PCR и Playlist в v4.2.3

## Результат

SCTE-35 UDP-тракт проверен реальным downstream capture и усилен для multicast.
PCR interval применяется к конечному потоку после injector. В Playlist можно
удалить каждый ролик, а video bitrate меняется с шагом 500 kbps.

## Исправления transport

- destination из UDP fields остаётся конечным output TSDuck;
- выбранный local interface передаётся как `--local-address`;
- для multicast добавлен `--force-local-multicast-outgoing`;
- после PMT/SCTE injection включён `pcradjust` с фактическим CBR muxrate и
  выбранным `PCR interval`;
- Log Output показывает итоговый UDP destination, interface, service ID,
  video/audio PID и PCR;
- unit test проверяет новые аргументы TSDuck.

## Проверка доставки

End-to-end тест создаёт пятисекундную H.264/AAC программу, запускает FFmpeg,
передаёт внутренний CBR MPEG-TS в TSDuck, добавляет `CUEI` и SCTE-35 Event ID,
отправляет multicast UDP через явно выбранный loopback interface и записывает
поток независимым TSDuck receiver.

В capture подтверждены:

- video и audio;
- SCTE-35 PID `500` и Event ID `54321`;
- IDR рядом с cue time;
- фактический PCR interval `10 ms`, заданный через UI-контракт теста.

Команда проверки:

```bash
GRUBER_RUN_SCTE35_TESTS=1 npm run test -w @gruber/media-server
```

## UI

- у каждой строки Playlist есть отдельная кнопка удаления;
- при удалении выбранного ролика selection переходит на соседний;
- Target Bitrate slider и Max Bitrate number input используют шаг `0.5 Mbps`.

Версия всех компонентов: `v4.2.3`.
