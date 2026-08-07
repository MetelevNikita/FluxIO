# Перенос Encoding Settings через `.txt`

Применимо к FluxIO **v5.0.4**.

## 1. Назначение

Профиль позволяет перенести настройки Broadcast между установками FluxIO или
сохранить проверенную конфигурацию перед изменениями. Это обычный UTF-8 `.txt`
с versioned JSON-структурой `fluxio-encoding-settings`.

## 2. Что входит в профиль

- video codec, profile, level, preset, resolution и frame rate;
- field order, deinterlace, GOP length, B-frames и closed/open GOP;
- CBR/VBR/CRF, target/max bitrate и VBV buffer;
- audio codec, sample rate, channels и bitrate;
- выбранный UDP/SRT/RTMP/RTMPS protocol и его несекретные параметры;
- UDP interface, service metadata, PID, PCR и transport bitrate;
- logo overlay, Repeat и SCTE-35 planner defaults.

Путь логотипа и IP выбранного сетевого интерфейса сохраняются буквально. После
переноса на другой компьютер проверьте, что файл логотипа существует, а такой
адрес действительно назначен локальному адаптеру.

## 3. Что намеренно не сохраняется

В файл никогда не записываются:

- legacy `streamKey`;
- SRT passphrase;
- RTMP/RTMPS stream key.

Файл остаётся читаемым текстом, поэтому хранить в нём пароли небезопасно. После
импорта секрет выбранного endpoint нужно ввести вручную.

## 4. Сохранение

1. Открыть **Broadcast Settings**.
2. Настроить encoder, audio, output и SCTE-35.
3. В панели **Encoding settings profile** нажать **Save .TXT**.
4. Выбрать каталог и имя файла.

FluxIO предлагает имя вида
`FluxIO-encoding-settings-2026-08-07T12-00-00-000Z.txt`.

## 5. Импорт

1. Штатно остановить активный эфир: импорт во время playout заблокирован.
2. Нажать **Import .TXT**.
3. Выбрать ранее сохранённый FluxIO profile.
4. Проверить сообщение об успешном импорте.
5. Проверить logo path и UDP network interface.
6. Для SRT/RTMP повторно ввести passphrase/stream key.
7. Перед production-запуском выполнить тест на резервном endpoint.

Импорт заменяет текущие настройки Broadcast целиком. Playlist и медиафайлы при
этом не меняются.

## 6. Проверка файла

Допускается только `.txt` размером от 1 байта до 1 MB. FluxIO проверяет:

- идентификатор и версию формата;
- наличие всех полей;
- типы и диапазоны bitrate, resolution, ports, PID, PCR и GOP;
- допустимые значения codec/protocol/field order/SCTE-35 selectors;
- дату и версию приложения, создавшего профиль.

Повреждённый, неполный или вручную неверно изменённый файл отклоняется без
изменения текущих настроек.
