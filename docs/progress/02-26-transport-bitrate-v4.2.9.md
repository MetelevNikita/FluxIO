# 02.26 — Проверка Transport bitrate после TSDuck в v4.2.9

Дата: 2026-08-06

## Задача

Оператор выбрал ручной Transport bitrate `12 Mbps`, но анализатор показывал
`12.9 Mbps`. Необходимо было проверить значение на конечном UDP output после
TSDuck, а не только в аргументах FFmpeg.

## Диагностика

Для профиля H.264 `10.5 Mbps` + MP2 `192 kbps` режим Auto FluxIO вычисляет
`12.9 Mbps`:

```text
ceil_100k((10.5 + 0.192) × 1.18 + 0.256) = 12.9 Mbps
```

Поэтому наблюдаемые `12.9 Mbps` соответствуют именно Auto, а не ручным
`12.0 Mbps`.

## Проверенный data path

При ручном значении `12 Mbps` сервер передаёт `12_000_000 bps` во все точки
трактa:

1. FFmpeg MPEG-TS `-muxrate 12000000`;
2. FFmpeg UDP pacing `bitrate=12000000`;
3. глобальный input bitrate TSDuck `--bitrate 12000000`;
4. TSDuck `regulate --bitrate 12000000`;
5. конечный UDP output.

## Реальная проверка

Integration test использует профиль оператора:

- H.264, `1920×1080`, `25 fps`;
- VBR target/max `10.5 Mbps`;
- Closed GOP `25`, B-frames `5`;
- MP2, `48 kHz`, `192 kbps`;
- Transport bitrate `12.0 Mbps`;
- PCR target `26 ms`.

После TSDuck захватываются конечные UDP datagrams. Тест независимо проверяет:

- среднюю скорость прихода MPEG-TS payload — отклонение не более 2% от
  `12_000_000 bps`;
- bitrate, восстановленный по расстоянию TS packets между PCR — отклонение не
  более 2% от `12_000_000 bps`;
- PCR repetition interval — строго меньше `40 ms`;
- наличие PID `0x1FFF` stuffing.

Все проверки прошли.

## Наблюдаемость для оператора

`PlayoutStatus` теперь содержит подтверждённые сервером поля:

- `transportBitrateBps`;
- `transportBitrateMode`: `manual` или `auto`.

В `Encoding Monitor` отображается, например:

```text
Applied TS bitrate  12.000 Mbps (manual)
```

А стартовый Log Output содержит:

```text
UDP CBR transport 12.000 Mbps ... manual muxrate
UDP transport output ... transport target 12.000 Mbps (manual), PCR target 26 ms
```

Строка `FFmpeg reported bitrate` остаётся телеметрией FFmpeg и не заменяет
измерение конечного transport. Transport bitrate относится к 188-byte MPEG-TS
payload. Анализатор сетевой line rate может дополнительно учитывать UDP/IP и
Ethernet overhead.

## Команды проверки

```bash
npm run typecheck
npm test
GRUBER_RUN_FFMPEG_TESTS=1 npm test -w @gruber/media-server
npm run build
```

Техническая основа: [TSDuck regulate](https://tsduck.io/docs/tsduck.html) с
фиксированным `--bitrate` ограничивает скорость TS packet flow; глобальный
`tsp --bitrate` сообщает bitrate входного transport всем processors.

