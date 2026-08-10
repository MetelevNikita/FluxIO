# DVB-субтитры для эфирного инженера

Применимо к FluxIO **v6.0.9**, однопрограммному UDP/SRT MPEG-TS.

## Назначение

Кнопка `SRT` в Playlist включает SubRip-файл конкретного ролика. В режиме
`DVB Subtitles` текст не изменяет video: FluxIO преобразует его в отдельный
bitmap elementary stream. Телевизор или STB показывает язык в меню субтитров,
а абонент включает и выключает его самостоятельно.

```text
video playlist ─→ FFmpeg ───────────────────────────────┐
SRT cue files ─→ program timeline ─→ GStreamer dvbsubenc├→ TSDuck CBR MPEG-TS → UDP/SRT
SCTE-35 cue plan ────────────────────────────────────────┘
```

## Подготовка

`node setup.mjs` проверяет FFmpeg, TSDuck и GStreamer. Для offline-установки
они должны быть установлены заранее. Ручные команды:

```bash
# macOS
brew install ffmpeg tsduck gstreamer

# Debian/Ubuntu
sudo apt install ffmpeg tsduck gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-bad

# Windows PowerShell
winget install --id Gyan.FFmpeg --exact
winget install tsduck
winget install --id gstreamerproject.gstreamer --exact
```

Официальный 64-bit MSVC installer может установить GStreamer для текущего
пользователя в
`%LOCALAPPDATA%\Programs\gstreamer\1.0\msvc_x86_64\bin`, системно в
`%ProgramFiles%\gstreamer\1.0\msvc_x86_64\bin` или, для старых выпусков, в
`C:\gstreamer\1.0\msvc_x86_64\bin`. `setup.mjs` проверяет все три варианта,
WinGet packages, PATH и корневые переменные GStreamer.

Проверка DVB encoder:

```bash
gst-inspect-1.0 --exists dvbsubenc
tsp --version
```

В PowerShell без настроенного PATH можно проверить полный путь:

```powershell
& "$env:LOCALAPPDATA\Programs\gstreamer\1.0\msvc_x86_64\bin\gst-launch-1.0.exe" --version
& "$env:LOCALAPPDATA\Programs\gstreamer\1.0\msvc_x86_64\bin\gst-inspect-1.0.exe" --exists dvbsubenc
$LASTEXITCODE
```

Последняя команда должна вернуть `0`. Если executable найден, но код не `0`,
в установленном Runtime отсутствует `dvbsubenc` из **GStreamer Bad Plug-ins**:
переустановите официальный MSVC x86_64 Runtime с полным набором plug-ins.

На Windows используются `gst-inspect-1.0.exe` и `tsp.exe`. Пути сохраняются в
`.env` как `GSTREAMER_LAUNCH_PATH`, `GSTREAMER_INSPECT_PATH` и `TSDUCK_PATH`.

## Настройка эфира

1. В Playlist выберите папку SRT и включите `SRT` у нужных роликов.
2. Откройте `Broadcast → Subtitle Output`.
3. Выберите `DVB Subtitles` и UDP либо SRT.
4. Задайте уникальный `Subtitle PID`; по умолчанию `288` (`0x0120`). Он не должен совпадать с video, audio или SCTE-35 PID.
5. Укажите трёхбуквенный ISO 639 language, например `rus` или `eng`.
6. Выберите `Normal` либо `Hearing impaired`.
7. Проверьте font, размер, нижний отступ, palette и reserved bitrate. DVB renderer
   использует только документированные свойства `textrender`; отдельной настройки
   outline в этом режиме нет.
8. Оставьте `PTS offset = 1400 ms`, пока измерение на приёмнике не покажет систематическое опережение или запаздывание.
9. Нажмите Start. В Encoding Monitor карточка `DVB Subtitles` должна перейти в `running` и показать число cue.

Page IDs первой реализации фиксированы: `composition_page_id=1`,
`ancillary_page_id=1`. Для HD используется subtitling type `0x14`, для
hearing-impaired HD — `0x24`.

## Что формируется в потоке

- video PID и audio PID — как заданы в MPEG-TS service;
- subtitle PID — private PES, `stream_type 0x06`;
- в PMT subtitle component находится `subtitling_descriptor` с language/type/page IDs;
- SCTE-35 остаётся отдельным PID, если planner включён;
- TSDuck заменяет stuffing пакетами subtitle stream и восстанавливает заданную постоянную transport rate.

Субтитры каждого ролика обрезаются его фактическим trim range и смещаются на
суммарную длительность предыдущих роликов. Отсутствующий `.srt` пропускается;
video и эфир не останавливаются.

## Проверка на приёмной стороне

На отдельной машине в той же сети:

```bash
tsanalyze -I ip 239.10.10.10:5000
ffprobe -hide_banner -show_programs -show_streams "udp://239.10.10.10:5000?localaddr=192.168.10.20"
```

Проверить:

- subtitle PID присутствует в том же service/program;
- codec определяется как DVB subtitle/private data;
- язык совпадает с `rus/eng/...`;
- PMT version обновлена и descriptor виден;
- continuity counter subtitle PID не содержит ошибок;
- текст появляется и исчезает в cue time, а decoder позволяет выключить его;
- итоговая transport bitrate и PCR interval не изменились после включения subtitles.

## Диагностика

`DVB subtitles require GStreamer` — проверить `gst-inspect-1.0 --exists dvbsubenc` и пути в `.env`.

`no property "draw-outline" in element "textrender"` — используется версия
FluxIO до v6.0.7. Обновить repository, пересобрать media-service и повторить
запуск; `draw-outline` и `draw-shadow` не являются свойствами `textrender`.

`No such file "C:Users...dvb-subtitles-loop-0.srt"` без разделителей каталогов —
используется FluxIO до v6.0.9. В старой сборке GStreamer воспринимал обратные
слэши Windows-пути как escape-символы. v6.0.9 передаёт `filesrc` нормализованный
путь `C:/Users/...`; обновите repository и обязательно пересоберите
media-service.

`Subtitle PID must differ...` — назначить свободный PID от `32` до `8190`.

Язык не появился в телевизоре — проверить трёхбуквенный код и
`subtitling_descriptor` в PMT; одного `stream_type 0x06` недостаточно.

Текст идёт раньше/позже — изменять `PTS offset` небольшими шагами после измерения
на конечном decoder. Значение компенсирует стартовую MPEG-TS временную базу, а не
индивидуальную ошибку тайминга внутри SRT.

В preview нет DVB-текста — это ожидаемо: HLS preview показывает clean program
video. Отдельный subtitle PID проверяется на реальном UDP/SRT receiver.

RTMP выбран вместе с DVB — запуск блокируется. Для RTMP выбрать `Burn-in`.
