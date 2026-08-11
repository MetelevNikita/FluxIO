# DVB-субтитры для эфирного инженера

Применимо к FluxIO **v6.0.15**, однопрограммному UDP/SRT MPEG-TS.

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
8. Оставьте `PTS offset = 0 ms`. Начиная с v6.0.12 FluxIO задаёт FFmpeg и
   GStreamer общую MPEG-TS шкалу с началом около `01:00:00.000`, поэтому
   ручной сдвиг для устранения прежней разницы примерно в один час не нужен.
   Меняйте offset только после измеренного небольшого постоянного
   рассогласования на конкретном декодере.
9. Нажмите Start. В Encoding Monitor карточка `DVB Subtitles` должна перейти в
   `running`, показать число cue, `Observed subtitle PES`, `Video PTS origin`
   и `Subtitle clock = Aligned`.

Page IDs первой реализации фиксированы: `composition_page_id=1`,
`ancillary_page_id=1`. Для HD используется subtitling type `0x14`, для
hearing-impaired HD — `0x24`.

## Что формируется в потоке

- video PID и audio PID — как заданы в MPEG-TS service;
- subtitle PID — private PES, `stream_type 0x06`;
- в PMT subtitle component находится `subtitling_descriptor` с language/type/page IDs;
- SCTE-35 остаётся отдельным PID, если planner включён;
- TSDuck заменяет stuffing пакетами subtitle stream и восстанавливает заданную постоянную transport rate.
- TSDuck после merge проверяет video и subtitle PID через `pcrextract`; каждый
  найденный subtitle PES с PTS увеличивает `Observed subtitle PES` в Encoding
  Monitor;
- первый subtitle PTS сравнивается с `Video PTS origin + start первого SRT cue
  + PTS offset`; допустимое отклонение — `±250 ms`.

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
- `Subtitle clock` показывает `Aligned`, а модуль отклонения не превышает
  `250 ms`;
- текст появляется и исчезает в cue time, а decoder позволяет выключить его;
- итоговая transport bitrate и PCR interval не изменились после включения subtitles.

### Как отделить FluxIO от головной станции

Наличие языка в меню VLC ещё не доказывает наличие картинок субтитров. PMT может
содержать `subtitling_descriptor`, пока payload выбранного PID отсутствует,
повреждён или имеет неверный PTS.

1. Сначала откройте **исходный multicast FluxIO до головной станции**.
2. Во время cue проверьте в Encoding Monitor, что `Observed subtitle PES` больше
   нуля. Это подтверждает наличие PES/PTS после GStreamer и merge TSDuck.
3. Затем откройте multicast, который вернула головная станция, и сравните PMT,
   subtitle PID, packet count, continuity counter и PTS.

Результаты трактуются так:

- subtitle отображается в прямом FluxIO multicast, но не отображается в
  возвращённом — головная станция удаляет, переназначает или рассинхронизирует
  компонент при remux;
- язык выбирается в прямом multicast, но `Observed subtitle PES = 0` — PMT есть,
  но GStreamer не передал bitmap PES в финальный TS; смотреть Log Output;
- `Observed subtitle PES > 0`, но прямой multicast не рисует текст — проверить
  `Subtitle clock`, page IDs `1/1`, subtitling type и возможности декодера;
- прямой multicast работает в VLC, но не на STB — проверить поддержку DVB bitmap
  subtitles и HD type `0x14` на целевом устройстве.

Для двух независимых захватов можно использовать одинаковые команды, меняя
адрес и сетевой интерфейс:

```bash
tsanalyze -I ip --local-address 192.168.10.20 239.10.10.10:5000
ffprobe -hide_banner -show_programs -show_streams \
  "udp://239.10.10.10:5000?localaddr=192.168.10.20&fifo_size=1000000&overrun_nonfatal=1"
```

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

`Subtitle clock = Mismatch` — сравнить показанные `Video PTS origin`, первый
subtitle PTS и `clock error`. Разница примерно `+01:00:00` означает старую
сборку media-service без общей временной базы: обновить и пересобрать FluxIO.
Небольшое постоянное отклонение можно компенсировать `PTS offset`; значение не
исправляет индивидуальные ошибки тайминга внутри SRT.

Текст идёт раньше/позже при `Subtitle clock = Aligned` — начать с
`PTS offset = 0 ms` и изменять его небольшими шагами только после измерения на
конечном decoder. Входной PTS около `01:00:00` является штатной общей шкалой
FluxIO v6.0.12, а не ошибкой длительностью в час.

Язык выбирается, но текста нет — сравнить `Planned cues` и
`Observed subtitle PES`. Нулевое второе значение означает, что PMT сигнализация
есть, но bitmap PES не дошли до финального TSDuck TS. Ненулевое значение
переводит диагностику на PTS/decoder либо на remux головной станции.

В preview нет DVB-текста — это ожидаемо: HLS preview показывает clean program
video. Отдельный subtitle PID проверяется на реальном UDP/SRT receiver.

RTMP выбран вместе с DVB — запуск блокируется. Для RTMP выбрать `Burn-in`.
