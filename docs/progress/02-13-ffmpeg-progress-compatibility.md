# Этап 2.13 — FFmpeg progress compatibility

Дата завершения: 2026-08-04.

## Проблема

Некоторые Windows FFmpeg builds не поддерживают global option `-stats_period`. Из-за этого процесс завершался до открытия UDP/SRT/RTMP output:

```text
Unrecognized option 'stats_period'.
Error splitting the argument list: Option not found
```

## Реализация

Optional arguments `-stats_period 0.5` удалены из playout command. Они задавали только частоту обновлений и не участвовали в кодировании или передаче потока.

Приложение продолжает использовать:

```text
-nostats -progress pipe:1
```

`-progress pipe:1` выдаёт machine-readable поля `out_time`, `speed` и `progress`, которые использует Encoding Monitor. `-nostats` отключает только обычную интерактивную строку FFmpeg в stderr.

## Проверка

Regression test подтверждает, что generated command:

- не содержит `-stats_period`;
- содержит `-progress pipe:1`;
- сохраняет UDP и HLS outputs.
