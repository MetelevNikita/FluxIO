# 04.08 — GStreamer textrender compatibility v6.0.7

Дата завершения: 2026-08-10.

## Симптом

При DVB Subtitles GStreamer завершался до первого кадра:

```text
erroneous pipeline: no property "draw-outline" in element "textrender"
```

Supervisor после отказа subtitle injector штатно останавливал FFmpeg, поэтому
UDP/SRT program output также прекращался.

## Причина и исправление

`draw-outline` и `draw-shadow` относятся не к `textrender` и отсутствуют в его
официальном наборе свойств. Эти параметры удалены. Pipeline продолжает применять
`font-desc`, horizontal/line/vertical alignment, `ypad`, AYUV canvas, palette и
PTS offset перед `dvbsubenc`.

Неактивная настройка outline удалена из DVB Broadcast UI. Поле сохранено в
контрактах и переносимых профилях для обратной совместимости.

## Проверка

- command test требует отсутствия `draw-outline` и `draw-shadow`;
- typecheck, полный test suite и production build выполняются из корня проекта.
