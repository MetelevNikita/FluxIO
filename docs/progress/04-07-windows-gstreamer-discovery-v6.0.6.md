# 04.07 — Windows GStreamer discovery v6.0.6

Дата завершения: 2026-08-10.

## Проблема

После успешной Windows-установки GStreamer мастер мог завершиться сообщением,
что `gst-launch-1.0` не найден. Поиск учитывал системный `Program Files`, но не
user-only каталог актуального installer и не legacy-каталог старых версий.
Отсутствующий executable и отсутствующий `dvbsubenc` также выглядели для
оператора как одна и та же ошибка.

## Реализация

- добавлен поиск в `%LOCALAPPDATA%\Programs\gstreamer\1.0`,
  `%ProgramFiles%\gstreamer\1.0` и `C:\gstreamer\1.0`;
- сохранён recursive поиск WinGet packages и добавлены известные root variables;
- после обнаружения запускается `gst-inspect-1.0 --exists dvbsubenc`;
- `.env` получает проверенные абсолютные пути `GSTREAMER_LAUNCH_PATH` и
  `GSTREAMER_INSPECT_PATH`;
- сообщение об ошибке указывает конкретный probe и необходимость Bad Plug-ins.

## Проверка

- unit-test проверяет все три стандартных Windows-каталога;
- unit-test проверяет sibling `gst-inspect-1.0.exe` и аргументы plugin probe;
- полные typecheck и test suite выполняются из корня проекта.
