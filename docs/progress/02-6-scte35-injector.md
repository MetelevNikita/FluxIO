# Этап 2.6 — SCTE-35 injector для UDP/SRT

Дата завершения: 2026-08-04.

## Результат

Planner подключён к реальному транспортному тракту `FFmpeg → TSDuck → UDP/SRT`.

- clip-relative markers преобразуются в общий program time, округляются до кадра и переводятся в 90 kHz PTS;
- FFmpeg ставит keyframe в cue-time и создаёт MPEG-TS с muxrate/stuffing для безопасной подстановки SCTE packet;
- TSDuck добавляет в PMT registration `CUEI`, cue PID с `stream_type 0x86` и cue identifier descriptor;
- `spliceinject` принимает XML batch и дважды выдаёт `time_signal`/`splice_insert` перед event PTS;
- `splicemonitor` возвращает реально увиденные Event ID в `PlayoutStatus` и Encoding Monitor;
- TSDuck напрямую открывает итоговый UDP или SRT output;
- неожиданное завершение injector останавливает FFmpeg, чтобы эфир без заявленных cue не продолжался скрытно;
- при Repeat cue batch пересоздаётся, а Event ID либо переиспользуется, либо увеличивается на номер цикла.

## Preflight

- SCTE-35 разрешён только для UDP/SRT MPEG-TS;
- TSDuck `tsp` обязателен, а для SRT проверяется `tsversion --support srt`;
- marker должен попадать в активный trim range;
- первая метка должна быть не раньше `pre-roll + 2 seconds` от старта программы;
- UUID UPID должен содержать 32 hexadecimal characters.

## Воспроизводимая проверка

```bash
npm run typecheck
npm test
GRUBER_RUN_SCTE35_TESTS=1 npm test -w @gruber/media-server
npm run build
```

Integration test создаёт реальный клип, запускает supervisor, принимает итоговый UDP MPEG-TS в отдельном TSDuck process и подтверждает через `ffprobe`/`splicemonitor`:

- codec `scte_35`;
- PID `0x1f4` для configured PID `500`;
- Event ID `54321`;
- segmentation type `0x34`.

Отдельный SRT loopback test подтвердил, что тот же TS после передачи TSDuck SRT caller → listener сохраняет `scte_35` PID и обе копии cue.

## Эксплуатационная граница

HLS preview формируется до injector и поэтому показывает program picture, но не является анализатором конечного TS. Для пилота необходим независимый downstream probe или подтверждение головной станции. Текущий тракт однопрограммный SPTS; MPTS, primary/backup injector и splice execution находятся в следующих production milestones.
