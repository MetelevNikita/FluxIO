# 02.25 — Гарантированный PCR interval для UDP в v4.2.8

Дата: 2026-08-06

## Симптом

При выбранном в Broadcast значении `PCR interval = 26 ms` транспортный
анализатор фиксировал интервалы `45–55 ms` и ошибку TR 101 290
`PCR repetition error (> 40 ms)`.

## Причина

UDP без SCTE-35 раньше открывался FFmpeg напрямую. Финальный TSDuck
`pcradjust` работал только в тракте SCTE-35, поэтому UI-параметр доходил до
FFmpeg muxer, но не контролировался после полного формирования и pacing
конечного потока.

Кроме того, `pcradjust --min-ms-interval` задаёт порог, после которого TSDuck
заменяет следующий доступный null packet пакетом с PCR. Если использовать
требуемый максимум как сам порог, packet-grid может дать небольшое превышение.

## Реализация

- любой UDP теперь использует тракт
  `FFmpeg → loopback UDP → TSDuck pcradjust → regulate → UDP endpoint`;
- `pcradjust` получает явный video/PCR PID из Broadcast settings;
- внутренний порог вычисляется как `max(1, floor(targetMs) − 2)`;
- при `PCR interval = 26 ms` TSDuck получает порог `24 ms`;
- при выключенном SCTE-35 relay не добавляет `CUEI`, SCTE PID, PMT changes или
  cue sections;
- Log Output показывает `TSDuck UDP PCR relay started` и строку конечного UDP
  output с `PCR target 26 ms`.

Порог в 2 ms — запас на положение следующего null packet в CBR transport.
Значение из UI остаётся операторским maximum target.

## Проверка

Автоматический реальный тест создаёт два клипа, передаёт профиль:

- H.264, `1920×1080`, `25 fps`;
- VBR target/max `10.5 Mbps`, VBV `21 Mbps`;
- Closed GOP `25`, B-frames `5`;
- MP2, `48 kHz`, `192 kbps`;
- UDP PCR target `26 ms`.

Тест захватывает конечные UDP datagrams после TSDuck, извлекает PCR из
MPEG-TS-пакетов и требует более 20 измерений и максимальный интервал строго
ниже `40 ms`. Проверка выполнена успешно.

Команды проверки:

```bash
npm run typecheck
npm test
GRUBER_RUN_FFMPEG_TESTS=1 npm test -w @gruber/media-server
npm run build
```

## Нормативные и технические ссылки

- [ETSI TR 101 290](https://www.etsi.org/deliver/etsi_tr/101200_101299/101290/01.03.01_60/tr_101290v010301p.pdf) — порог PCR repetition error `40 ms`;
- [TSDuck User Guide](https://tsduck.io/docs/tsduck.html) — processor `pcradjust` и `--min-ms-interval`;
- [FFmpeg Formats Documentation](https://ffmpeg.org/ffmpeg-formats.html) — MPEG-TS option `pcr_period`.

