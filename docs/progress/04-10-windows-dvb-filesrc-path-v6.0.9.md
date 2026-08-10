# 04.10 — Windows DVB subtitle filesrc path v6.0.9

Статус: завершено 2026-08-10.

## Ошибка

GStreamer `gst-launch-1.0` повторно разбирает значения properties как pipeline
syntax. В Windows-пути временного subtitle project обратные слэши становились
escape-символами:

```text
C:\Users\iptv\AppData\Local\Temp\gruber-playout-preview\dvb-subtitles-loop-0.srt
→ C:UsersiptvAppDataLocalTempgruber-playout-previewdvb-subtitles-loop-0.srt
```

`filesrc` не находил файл, pipeline не проходил preroll, после чего supervisor
корректно останавливал FFmpeg, чтобы не продолжать эфир с неполным трактом.

## Исправление

Перед формированием `location=` drive-letter и UNC paths переводятся в
принимаемую Windows/GLib форму с прямыми разделителями:

```text
location=C:/Users/iptv/AppData/Local/Temp/gruber-playout-preview/dvb-subtitles-loop-0.srt
```

POSIX paths не меняются. Добавлен regression test с фактической структурой пути
из журнала оператора.
