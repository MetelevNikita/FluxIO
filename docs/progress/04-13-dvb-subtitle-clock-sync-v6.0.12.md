# 04.13 — Общая PTS-база DVB subtitles v6.0.12

Дата завершения: 2026-08-11.

## Причина

В финальном MPEG-TS subtitle PID мог содержать корректные PES, но его PTS
начинался около `01:00:00`, тогда как FFmpeg video начинался около
`00:00:01.400`. TSDuck `merge` объединяет пакеты, но не преобразует DTS/PTS
elementary streams. В результате PMT и язык были видны в VLC, однако decoder
не показывал bitmap subtitles в ожидаемое время.

## Реализация

- для program MPEG-TS FFmpeg сохранены `muxdelay=0.7` и `muxpreload=0.5`, а
  `output_ts_offset=3598.6` задаёт первому video PTS точку `01:00:00.000`;
- GStreamer `mpegtsmux` и DVB subtitle PES остаются на своей штатной часовой
  шкале, теперь совпадающей с video;
- SCTE-35 planner добавляет общий clock origin к raw 90-кГц PTS, поэтому метки
  остаются синхронны с программой после изменения video epoch;
- TSDuck после subtitle merge запускает `pcrextract` для video и subtitle PID;
- media-service вычисляет ожидаемый первый subtitle PTS как
  `video origin + first cue start + configured offset`, корректно учитывает
  wrap 33-битной PTS и допускает отклонение `±250 ms`;
- Encoding Monitor показывает video origin, статус `Aligned/Mismatch` и
  измеренную ошибку в миллисекундах.

Mismatch сигнализируется оператору, но не останавливает эфир: video/audio
продолжают передаваться, а инженер получает точное измерение для диагностики.

## Проверка

Synthetic FFmpeg MPEG-TS с production mux options показал:

```text
video PTS     3600.000000
audio PTS     3599.978667
subtitle PTS  3600.720000  (SRT cue start 00:00:00.720)
```

Отдельный GStreamer `dvbsubenc → mpegtsmux` test использовал тот же pipeline,
что production, и подтвердил точное добавление cue time к общей часовой базе.

Добавлены regression tests для FFmpeg output offset, общей SCTE-35 PTS-базы,
video/subtitle `pcrextract`, расчёта alignment, legacy one-hour mismatch и
33-битного PTS wrap.

Полный набор проверок этапа:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```
