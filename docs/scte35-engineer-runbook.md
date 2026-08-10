# SCTE-35: инструкция эфирного инженера

Версия документа: 2026-08-04  
Применимо к: FluxIO 5.0.8, однопрограммный MPEG-TS (SPTS)

## 1. Назначение

Эта инструкция описывает подготовку, запуск и проверку SCTE-35 меток в Gruber Playout. Она рассчитана на инженера, который формирует эфирный плейлист и передаёт сигнал на головную станцию по UDP или SRT.

SCTE-35 — это сигнализация точки рекламной или другой программной врезки. Gruber не выполняет саму замену контента: приложение передаёт cue в MPEG-TS, а решение о врезке принимает downstream-оборудование или головная станция.

Нормативная основа: [ANSI/SCTE 35-1 2023r2](https://account.scte.org/standards/library/catalog/scte-35-1-digital-program-insertion-cueing-message-part-1-legacy-splice-based-and-time-based-signaling/). Практическая реализация injector и monitor построена на [TSDuck](https://tsduck.io/docs/tsduck.html).

## 2. Как проходит сигнал

```text
Playlist markers
    ↓
Node.js: position → program time → PTS 90 kHz
    ↓
FFmpeg: video/audio encoding + logo + IDR в cue-time
    ↓
локальный CBR MPEG-TS
    ↓
TSDuck: PMT CUEI + SCTE-35 PID + splice_info_section
    ↓
UDP или SRT MPEG-TS
    ↓
головная станция / рекламный сплайсер
```

В текущей версии:

- MPEG-TS содержит один program с `service_id=1`;
- SCTE-35 PID задаётся оператором, значение по умолчанию — `500` (`0x1F4`);
- PMT содержит registration `CUEI`, `stream_type 0x86` и cue identifier;
- каждая не-immediate команда передаётся дважды;
- FFmpeg ставит ключевой кадр в точке OUT и IN;
- RTMP/RTMPS при включённом SCTE-35 не поддерживается.

HLS preview в интерфейсе показывает фактическую картинку после encoding и logo overlay, но создаётся до SCTE-35 injector. Поэтому preview не подтверждает наличие cue в конечном MPEG-TS.

## 3. Данные, которые нужно получить от головной станции

До настройки запросите у принимающей стороны:

| Параметр | Что необходимо получить |
| --- | --- |
| Transport | UDP или SRT MPEG-TS |
| Адрес | IP/hostname и port |
| UDP | unicast или multicast, TTL, выходной сетевой интерфейс |
| SRT | caller/listener/rendezvous, latency, passphrase, Stream ID |
| Кодирование | video/audio codec, resolution, FPS, bitrate, GOP requirements |
| SCTE PID | допустимый PID, например `500` |
| Cue command | `time_signal` или `splice_insert` |
| Owner | Provider или Distributor |
| Pre-roll | требуемое время предупреждения до точки врезки |
| Event ID | правила выдачи и повторного использования ID |
| UPID | тип и формат идентификатора рекламного события |
| Verification | способ подтверждения cue на входе головной станции |

Не начинайте пилотный эфир, пока принимающая сторона не подтвердила эти параметры.

## 4. Предварительная проверка сервера

В terminal сервера выполните:

```bash
ffmpeg -version
ffprobe -version
tsp --version
```

Для SRT дополнительно:

```bash
tsversion --support srt
```

Команда проверки SRT должна завершиться с exit code `0`.

Проверьте `.env` в корне проекта. Для production рекомендуется абсолютный путь:

```dotenv
TSDUCK_PATH=/opt/homebrew/bin/tsp
```

На Linux или Windows путь будет другим. Его автоматически определяет `node setup.mjs`.

## 5. Значение настроек SCTE-35

### Cue command

`time_signal + segmentation_descriptor` — рекомендуемый вариант для новых интеграций. Время события находится в `time_signal`, а Event ID, duration, segmentation type и UPID — в segmentation descriptor.

`splice_insert (legacy)` — используйте только если его явно требует принимающая сторона.

### Segmentation owner

| Owner | OUT | IN |
| --- | ---: | ---: |
| Provider | `0x34` | `0x35` |
| Distributor | `0x36` | `0x37` |

Приложение выбирает эти segmentation type автоматически.

### Event ID

Event ID — целое число от `0` до `4294967295`. Для одной логической рекламной паузы рекомендуется использовать одинаковый Event ID у OUT и IN, если головная станция не требует другой схемы.

После добавления marker интерфейс автоматически увеличивает Event ID. Поэтому перед добавлением соответствующего IN вручную верните Event ID к значению OUT.

Не используйте один Event ID одновременно для двух активных рекламных пауз.

### Break duration

Duration задаётся на marker `Break Start`. Marker `Break End` duration не содержит. Если OUT имеет duration `120` секунд, IN рекомендуется установить ровно через 120 секунд после OUT.

### Pre-roll

Pre-roll — насколько заранее cue должен появиться в потоке до event PTS. Значение по умолчанию — `4000 ms`.

Первая метка плейлиста должна располагаться не раньше:

```text
pre-roll + 2 секунды startup reserve
```

Например, при pre-roll `4000 ms` первая допустимая позиция marker — `00:00:06.000` или позже. Более раннюю метку preflight не пропустит.

### PID

Допустимый диапазон — `32…8190`. Значение по умолчанию — `500`. PID должен быть согласован с головной станцией и не должен конфликтовать с другими elementary streams.

### UPID

| UI | SCTE type | Использование |
| --- | ---: | --- |
| Ad-ID | `0x03` | идентификатор рекламного материала или размещения |
| URI | `0x0F` | строковый URI/идентификатор |
| UUID | `0x10` | UUID; требуется 32 hex-символа, дефисы допустимы |
| None | `0x00` | идентификатор отсутствует |

Фактическое значение и формат UPID должен выдать рекламный или headend-контур. Не придумывайте production UPID вручную.

## 6. Настройка приложения

### Шаг 1. Подготовить плейлист

1. Откройте `Media Library`.
2. Импортируйте материалы.
3. Дождитесь зелёного статуса `Done` для каждого используемого файла.
4. Перейдите в `Playlist` и проверьте порядок роликов.
5. Проверьте preview, длительность и звук.

### Шаг 2. Настроить transport

Откройте `Broadcast → Streaming` и выберите UDP или SRT.

Для UDP заполните:

- `Destination host / multicast`;
- `Port`;
- `TS packet size`, обычно `1316`;
- `Multicast TTL`;
- `Local interface address`, если multicast должен выходить через конкретную NIC.
- `Transport bitrate`: `0` для Auto или точный постоянный TS bitrate головной станции.

Для рекламных стыков рекомендуется Closed GOP. Длина GOP определяет обычный
интервал I-frame, однако в точке SCTE-35 cue FluxIO дополнительно принудительно
создаёт IDR независимо от общей длины GOP.

Для SRT заполните:

- `Host`;
- `Port`;
- `Connection mode`;
- `Latency`;
- optional `Passphrase`;
- optional `Stream ID`.

Passphrase должна быть одинаковой с обеих сторон и иметь длину 10–79 символов.

### Шаг 3. Включить SCTE-35

В карточке `SCTE-35 Ad Markers`:

1. Включите переключатель `Planner`.
2. Выберите `Cue command`.
3. Выберите `Segmentation owner`.
4. Введите согласованный `SCTE-35 PID`.
5. Введите `Pre-roll`.
6. Укажите default duration.
7. Выберите UPID type и default UPID.
8. При включённом Repeat выберите стратегию Event ID.

### Шаг 4. Создать OUT marker

1. Вернитесь в `Playlist`.
2. Выберите ролик, внутри которого начинается рекламная пауза.
3. Установите playhead на точную позицию OUT.
4. В `SCTE-35 Marker Planner` задайте Event ID.
5. Выберите `Break Start`.
6. Введите duration.
7. Проверьте UPID.
8. Нажмите `Add at Playhead`.

В списке должна появиться метка `OUT`, Event ID и type `0x34` или `0x36`.

### Шаг 5. Создать IN marker

1. Перейдите к точке возврата из рекламной паузы.
2. Вручную укажите Event ID соответствующего OUT.
3. Выберите `Break End`.
4. Нажмите `Add at Playhead`.

В списке должна появиться метка `IN` с type `0x35` или `0x37`.

### Пример

Рекламная пауза начинается на `00:10:00` и длится 120 секунд:

| Marker | Time | Event ID | Duration | Provider type |
| --- | --- | ---: | ---: | ---: |
| OUT | `00:10:00` | `1001` | `120` | `0x34` |
| IN | `00:12:00` | `1001` | — | `0x35` |

При pre-roll `4000 ms` первая копия OUT cue должна появиться перед точкой `00:10:00`; точное наблюдаемое значение показывает monitor.

## 7. Настройка SRT с vMix

Режимы должны дополнять друг друга:

| Gruber | vMix input | Где задаётся адрес |
| --- | --- | --- |
| caller | listener | В Gruber указывается IP vMix и port; vMix слушает этот port |
| listener | caller | В vMix указывается IP Gruber и port |
| rendezvous | rendezvous | Обе стороны знают IP друг друга и используют одинаковый port |

В vMix откройте `Add Input → Stream / SRT` и выберите соответствующий тип SRT input.

Проверьте:

- одинаковый port;
- одинаковую latency;
- одинаковую passphrase;
- корректный Stream ID, если он используется;
- разрешение UDP port в firewall.

Практическое правило vMix: latency должна быть не меньше четырёх значений RTT/ping. Например, при ping `20 ms` начните с latency `80 ms` или выше.

Важно: появление видео и звука в vMix подтверждает SRT transport, но не гарантирует, что vMix показывает или использует SCTE-35. Cue проверяйте TSDuck, отдельным TS analyzer или средствами головной станции.

Официальная справка: [vMix SRT Input](https://www.vmix.com/help28/SRTInput.html).

## 8. Запуск и контроль эфира

Перед `Start Stream` проверьте:

- все материалы имеют статус `Done`;
- UDP/SRT endpoint подтверждён принимающей стороной;
- SCTE marker count соответствует плану;
- OUT и IN находятся в правильных роликах и позициях;
- Event ID и UPID проверены;
- первая метка находится позже `pre-roll + 2 s`;
- головная станция или контрольный приёмник уже готовы.

После запуска в `Encoding Monitor → SCTE-35 Injector` контролируйте:

| Поле | Нормальное значение |
| --- | --- |
| State | `running` во время эфира |
| TS PID | согласованный PID, например `500` |
| Observed cues | увеличивается при фактической выдаче очередного Event ID |
| Last Event ID | последний Event ID, увиденный локальным monitor |
| Next Event ID | следующая метка плейлиста |
| Time to next cue | время до event PTS |

Состояние `Observed cues 0 / N` до первой метки является нормальным. После выдачи первой копии значение увеличится.

Две одинаковые SCTE-35 секции перед одной точкой — нормальное поведение injector, а не дублирование рекламной паузы. В UI `Observed cues` считает уникальные Event ID текущего цикла.

Локальный статус подтверждает прохождение cue через TSDuck внутри Gruber. Он не подтверждает доставку пакетов по сети до головной станции.

## 9. Независимая проверка UDP

Запустите analyzer до запуска эфира.

Multicast пример:

```bash
tsp -I ip 239.10.10.10:5000 \
  -P splicemonitor --all-commands \
  -O drop
```

Если нужно выбрать принимающий интерфейс:

```bash
tsp -I ip --local-address 192.168.10.20 239.10.10.10:5000 \
  -P splicemonitor --all-commands \
  -O drop
```

В FluxIO выберите адрес передающего адаптера из той же сети. Начиная с v4.2.3
TSDuck принудительно отправляет multicast через выбранный interface, а PCR
interval нормализуется после добавления SCTE-35.

Начиная с v4.2.4 FFmpeg создаёт постоянный muxrate с PID `0x1FFF` stuffing, а
TSDuck регулирует финальную выдачу по тому же bitrate. Cue packets заменяют
доступные null packets и не увеличивают транспортную скорость.

Unicast receiver на port `5000`:

```bash
tsp -I ip 5000 \
  -P splicemonitor --all-commands \
  -O drop
```

Ожидаемый результат содержит:

- splice PID `500`;
- нужный Event ID;
- `out` для Break Start или `in` для Break End;
- event PTS;
- pre-roll;
- количество полученных копий.

## 10. Независимая проверка SRT

Если Gruber работает как `caller`, analyzer должен слушать:

```bash
tsp -I srt --listener 0.0.0.0:9000 --latency 120 --transtype live \
  -P splicemonitor --all-commands \
  -O drop
```

Если Gruber работает как `listener`, analyzer подключается как caller:

```bash
tsp -I srt --caller 192.168.10.10:9000 --latency 120 --transtype live \
  -P splicemonitor --all-commands \
  -O drop
```

При использовании passphrase добавьте одинаковое значение на обеих сторонах. Учитывайте, что ввод passphrase непосредственно в command line может сохранить её в shell history.

## 11. Проверка записанного TS-файла

Если головная станция или analyzer записали транспортный поток:

```bash
ffprobe -v error \
  -show_entries stream=codec_name,id \
  -of json capture.ts
```

Ожидаемый stream:

```json
{
  "codec_name": "scte_35",
  "id": "0x1f4"
}
```

Значение `0x1f4` соответствует PID `500`.

Проверка cue:

```bash
tsp -I file capture.ts \
  -P splicemonitor --splice-pid 500 --all-commands \
  -O drop
```

## 12. Repeat

При включённом бесконечном расписании доступны две стратегии:

`Increment each loop` — рекомендуемая стратегия. На каждом новом цикле к Event ID добавляется номер loop. OUT и IN с исходным одинаковым ID останутся парой и в следующем цикле.

`Reuse playlist Event IDs` — повторяет исходные Event ID. Используйте только если это согласовано с головной станцией и рекламным контуром.

При переходе на следующий loop FFmpeg и TSDuck перезапускают цикл. Возможен короткий межцикловый стык; текущая версия не гарантирует бесшовный continuous loop.

## 13. Ошибки и диагностика

| Симптом | Возможная причина | Действие |
| --- | --- | --- |
| `TSDuck tsp is required` | `tsp` не установлен или недоступен service | Проверить `tsp --version`, абсолютный `TSDUCK_PATH`, перезапустить media-service |
| `built without SRT support` | Сборка TSDuck без libsrt | Проверить `tsversion --support srt`, установить полную сборку TSDuck |
| `too close to playlist start` | Marker раньше pre-roll + reserve | Перенести marker позже или согласованно уменьшить pre-roll |
| `cue ... obsolete` / `were too late and were dropped` | Injector не успел выдать cue до PTS | Проверить marker position, pre-roll, CPU load и startup reserve; эфир считать не прошедшим SCTE-проверку |
| Start недоступен с RTMP | RTMP/FLV не переносит SCTE PID | Выбрать UDP или SRT MPEG-TS либо выключить SCTE-35 |
| SRT не соединяется | Одинаковые или неверные caller/listener modes | Одна сторона должна быть caller, другая listener; проверить IP/port/firewall |
| SRT соединяется без видео | Несовместимый codec/profile или высокий bitrate | Сверить encoder profile с vMix/головной станцией |
| UDP отсутствует | Неверный destination, port, route, выбранный NIC, multicast membership или TTL | Сверить строку `UDP transport output`, проверить IP передающего адаптера, membership принимающей стороны и firewall |
| Video/audio есть, cue нет | PID удалён remultiplexer'ом или неверные headend expectations | Проверить TS непосредственно на выходе Gruber и после каждого промежуточного устройства |
| `Observed cues` не растёт после времени marker | Cue не прошёл локальный injector | Проверить state/error/logs; такой запуск не принимать как успешный |
| `Observed cues` растёт, но реклама не включается | Gruber выдал cue, downstream его не применил | Сверить Event ID, type, UPID, PID, command, pre-roll и правила сплайсера |
| Injector state `failed` | TSDuck завершился или отбросил cue | Остановить эфир, сохранить logs, устранить причину и выполнить повторный тест |

## 14. Критерий успешного приёмочного теста

Тест считается успешным, когда одновременно выполнены условия:

1. На головной станции стабильно принимаются video и audio.
2. PMT содержит `CUEI` и согласованный PID со `stream_type 0x86`.
3. Для OUT и IN получены правильные Event ID и segmentation type.
4. UPID соответствует данным рекламного контура.
5. Cue получен с согласованным pre-roll.
6. В точке события присутствует подходящий IDR/keyframe.
7. Рекламный сплайсер выполняет OUT и возвращается по IN либо auto-return согласно принятой схеме.
8. Ни одно промежуточное устройство не удаляет SCTE-35 PID.
9. В Gruber нет injector error, а `Observed cues` соответствует числу уникальных markers.
10. Результат подтверждён логом или capture принимающей стороны, а не только локальным preview.

## 15. Что сохранить после теста

- дату и время проверки;
- версию Gruber, FFmpeg и TSDuck;
- encoder profile;
- UDP/SRT параметры без открытой passphrase;
- SCTE PID, command, owner и pre-roll;
- список Event ID/UPID;
- screenshot Encoding Monitor;
- короткий TS capture с OUT и IN;
- вывод `splicemonitor`;
- подтверждение инженера головной станции.
