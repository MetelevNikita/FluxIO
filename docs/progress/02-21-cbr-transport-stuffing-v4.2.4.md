# 02.21 — CBR transport, stuffing и стыки роликов в v4.2.4

## Симптомы

- в обычном UDP отсутствовали null packets PID `0x1FFF`;
- transport bitrate мог выходить за ожидаемое значение;
- анализатор показывал скачок bitrate/VBV на границе роликов.

## Причина

Прямой UDP запускался без фиксированного FFmpeg `-muxrate`. В SCTE-35 тракте
Auto muxrate для CBR ошибочно использовал сохранённый Max Bitrate, хотя в CBR
действует Target Bitrate. UDP datagrams также могли передаваться крупными
короткими burst без отдельного socket pacing.

## Реализация

- каждый UDP MPEG-TS получает постоянный `-muxrate`;
- свободная ёмкость заполняется null packets PID `0x1FFF`;
- UDP protocol получает `bitrate` и `burst_bits` размером одного datagram;
- CBR Auto muxrate рассчитывается по Target, VBR — по Max;
- добавлено ручное поле `Transport bitrate`, `0` означает Auto;
- слишком низкий ручной muxrate отклоняется до запуска;
- H.264/H.265 CBR получает VBV/HRD и filler параметры;
- TSDuck получает явный bitrate и `regulate` с packet burst одного datagram;
- UI различает video Target, VBR Max, VBV Buffer в kbit и полный TS bitrate.

## Проверка

Реальный тест формирует два клипа разной сложности и FPS, принимает обычный UDP
в Node.js и проверяет:

- наличие PID `0x1FFF`;
- средний bitrate в пределах 8% от muxrate;
- отсутствие выброса выше 12% на стыке клипов;
- штатное завершение FFmpeg и HLS preview.

Отдельный реальный multicast тест подтверждает, что цепочка FFmpeg → TSDuck →
UDP сохраняет SCTE-35 Event ID и выбранный PCR после добавления `regulate`.

Версия всех компонентов: `v4.2.4`.
