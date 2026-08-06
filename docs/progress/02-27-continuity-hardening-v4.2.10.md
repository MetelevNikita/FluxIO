# 02.27 — UDP continuity hardening в v4.2.10

Дата: 2026-08-06

## Симптом

DVBControl регистрирует `Continuity_count_error`. В момент ошибки изображение
замирает или нижняя часть кадра превращается в вертикальные полосы. Такой
рисунок означает, что декодер получил только часть video PES/access unit и не
может восстановить оставшиеся macroblocks до следующего корректного IDR.

PCR interval или небольшое отклонение bitrate само по себе не создаёт такой
дефект. Непосредственная причина — пропущенные, переставленные или повреждённые
TS packets video PID.

## Изменения

UDP-тракт усилен на двух socket boundaries:

- FFmpeg loopback UDP send buffer увеличен с platform default до `4 MiB`;
- TSDuck loopback UDP receive buffer установлен `4 MiB`;
- TSDuck endpoint UDP send buffer установлен `4 MiB`;
- output использует `--enforce-burst --packet-burst 7`, то есть во время эфира
  каждый datagram содержит ровно 7 × 188 = `1316` bytes MPEG-TS;
- TSDuck continuity monitor пассивно проверяет video/audio PID после всех
  transformations и перед `regulate`/UDP output;
- `--fix` не используется: потерянный payload невозможно восстановить, а
  переписывание CC только скрыло бы реальную ошибку.

## Наблюдаемость

В `Encoding Monitor` добавлен `Internal CC errors`.

- `0`, но DVBControl увеличивает ошибки — FluxIO сформировал непрерывный поток,
  потеря находится после TSDuck: NIC, кабель, switch, multicast routing или
  receive buffer DVBControl;
- значение растёт — ошибка уже присутствует внутри FFmpeg → loopback → TSDuck;
  соответствующее сообщение `TSDuck continuity warning` пишется в UI Log
  Output и terminal media-service.

При старте появляется строка:

```text
Continuity monitor active on video PID 256 and audio PID 257
```

## Реальная проверка

Контрольный профиль:

- H.264 `1920×1080`, `25 fps`;
- VBR target/max `10.5 Mbps`;
- Closed GOP 25, B-frames 5;
- MP2 `48 kHz`, `192 kbps`;
- Transport bitrate `12 Mbps`;
- PCR `26 ms`;
- два ролика в одном filter graph.

Конечный UDP output после TSDuck захвачен и проверен. Результат:

- video/audio continuity errors: `0`;
- все рабочие datagrams: `1316 bytes`; последний datagram при штатном закрытии
  может быть неполным, но всегда кратен 188 bytes;
- PCR repetition: меньше `40 ms`;
- TS rate по wall-clock и PCR: в пределах 2% от `12 Mbps`;
- stuffing PID `0x1FFF` присутствует;
- переход между роликами не создаёт transport burst или CC gap.

## Проверка на целевой сети

На отдельном компьютере в сети головной станции:

```bash
tsp -I ip --buffer-size 4194304 --local-address <RECEIVER_IP> <GROUP_OR_IP>:<PORT> \
  -P continuity --pid 256 --pid 257 --tag receiver \
  -O drop
```

Если FluxIO показывает `Internal CC errors = 0`, а receiver-команда сообщает
missing packets, проверить:

1. выбран ли физический NIC сети головной станции;
2. проводное ли соединение и нет ли packet drops/errors на NIC и switch port;
3. MTU не ниже 1500 — datagram с 1316-byte payload не должен фрагментироваться;
4. IGMP snooping и IGMP querier для multicast;
5. не flood'ится ли multicast во все порты VLAN;
6. отключены ли VPN/виртуальные адаптеры из маршрута;
7. увеличен ли UDP receive buffer на DVBControl/головной станции;
8. не включены ли power saving/Energy Efficient Ethernet на эфирном NIC.

## Источники

- [TSDuck ip output](https://tsduck.io/docs/tsduck.html) — `--buffer-size`,
  `--packet-burst`, `--enforce-burst`;
- [TSDuck continuity](https://tsduck.io/docs/tsduck.html) — проверка CC PID-by-PID;
- [FFmpeg UDP protocol](https://ffmpeg.org/ffmpeg-protocols.html#udp) —
  `buffer_size`, `pkt_size`, `bitrate`, `burst_bits`.

