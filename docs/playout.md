# Эфир, кодирование и выходы

## Preflight

Start/Take сначала валидирует request и окружение:

- media/graphics/subtitles/fonts доступны;
- FFmpeg знает codec/filter;
- выбранный hardware encoder присутствует;
- interlace поддерживается hardware;
- audio codec совместим с channel count;
- transport bitrate не ниже payload peak;
- PID не пересекаются;
- DVB/multiaudio/SCTE совместимы с protocol;
- TSDuck/GStreamer доступны там, где нужны.

Ошибка preflight возвращает 400 и не должна разбирать текущий рабочий тракт.
Conflict действующей операции возвращает 409.

## Video

Поддерживаются H.264, H.265 и MPEG-2 Video; CBR, VBR и CRF; GOP, B-frames,
closed GOP, profile, level, deinterlace и field order.

Interlaced profile — контракт, а не эффект. Если accelerator не умеет fields,
Start отклоняется. Нельзя тихо отдать progressive на станцию, ожидающую 50i.

### Hardware

Режимы: off, auto, NVENC, QSV, VAAPI, VideoToolbox, AMF.

- `off` выбирает software encoder.
- `auto` ищет первый подходящий accelerator.
- Если hardware недоступен, Start падает; fallback запрещён.
- VAAPI добавляет `format=nv12,hwupload` в тот же filter graph.
- Preview всегда software.

UHD нужно считать hardware-only до тех пор, пока конкретная машина не прошла
длительный real-time test с запасом.

## Audio

AAC-LC, MP2 и AC-3; mono, stereo или 5.1 в допустимых сочетаниях. Programme
loudness normalization использует target LUFS, true peak и LRA из request.

В multiaudio первый track использует основной audio PID, следующие получают
последовательные PID. Все tracks имеют одинаковую timeline; отсутствие source
заполняется silence.

## UDP MPEG-TS

Параметры:

- destination host/port;
- packet size, обычно 1316;
- TTL;
- local source address;
- service/provider name и service ID;
- service type;
- video/audio PID;
- PCR period;
- transport bitrate, 0 = auto.

FFmpeg отдаёт локальный MPEG-TS в TSDuck. Перед UDP применяются regulation,
continuity monitoring и PCR adjustment. Manual transport bitrate должен
вмещать video peak, все audio PID, subtitles/SCTE и overhead.

## SRT MPEG-TS

Режимы caller/listener/rendezvous, latency, stream ID и passphrase. Passphrase
либо пустая, либо 10–79 characters. TSDuck формирует тот же итоговый transport,
что для UDP, затем отправляет его через SRT.

Для caller проверьте доступность remote port и направление firewall. Для
listener заранее согласуйте, кто инициирует connection.

## RTMP/RTMPS

FFmpeg формирует FLV и подключается к server URL с stream key. Ограничения:

- один programme audio stream;
- нет DVB subtitle PID;
- нет SCTE-35 PID;
- transport MPEG-TS settings не применяются.

RTMPS шифрует transport к server, но key всё равно хранится как secret.

## SCTE-35

FluxIO планирует marker относительно clip, переводит его в programme PTS 90 kHz
и формирует TSDuck XML sections.

Настройки:

- `time_signal + segmentation_descriptor` или legacy `splice_insert`;
- provider/distributor owner;
- PID;
- pre-roll;
- default Event ID и break duration;
- UPID Ad-ID, URI, UUID или None;
- loop strategy increment/reuse.

SCTE-35 — signaling, а не автоматическая рекламная вставка. Головная станция
должна отдельно подтвердить PID, command, segmentation type, UPID и реакцию.

### Независимая проверка

Для UDP используйте TSDuck analyzer/monitor на отдельной машине или зеркальном
порту. Проверяйте:

- PMT с CUEI/SCTE component;
- наличие sections до точки события;
- Event ID и segmentation type;
- PTS и pre-roll;
- повтор IN/OUT;
- continuity и bitrate.

## DVB subtitles

Source SRT очищается, обрезается по clip и сдвигается на programme timeline.
GStreamer `textrender → dvbsubenc → mpegtsmux` создаёт отдельный PID; TSDuck
объявляет component в PMT и объединяет transport.

Проверяйте:

- PID не совпадает с video/audio/SCTE;
- ISO 639 language;
- normal/hearing-impaired type;
- font family и glyphs;
- max colours/bitrate;
- PTS offset и clock synchronization.

На restart subtitle branch сохраняет programme PTS; иначе captions начнутся
с начала или сдвинутся примерно на час.

## Preview и мониторинг

Program HLS preview зеркалирует post-TSDuck transport. Он полезнее direct
FFmpeg preview для graphics и programme continuity, но HLS player не показывает
все ошибки MPEG-TS.

Контролируйте одновременно:

- FluxIO status;
- program HLS;
- независимый TS analyzer;
- реальную головную станцию или резервный decoder;
- аудиометры по всем tracks.

## HOT CHANGE и Take

HOT CHANGE заменяет текущий хвост, останавливает obsolete prefetch и не
перезапускает encoder/TSDuck. Take готовит новый request и выполняет управляемый
restart, поэтому transport clock/session могут начаться заново.

## Приёмочный тест

Минимум:

1. два разных clips и несколько границ;
2. 30–60 минут для обычного профиля, отдельный длительный soak;
3. logo, AGE, file FX и scene FX;
4. burn-in или DVB captions;
5. все audio languages;
6. markers OUT/IN;
7. HOT CHANGE следующего clip;
8. Stop/Start и recovery;
9. измерение bitrate, PCR, continuity, PTS и decoder errors.
