# 02.19 — UDP/MPEG-TS controls и v4.2.2

## Результат

UDP-профиль FluxIO теперь управляет сетевым интерфейсом и основными параметрами
однопрограммного MPEG-TS. Версия всех компонентов синхронизирована как
`v4.2.2`.

## Реализовано

- `GET /api/system/network-interfaces` получает IPv4/IPv6 адаптеры через
  `node:os`; UI выбирает первый внешний IPv4, если профиль ещё пуст;
- `Automatic routing` и явный IP адаптера доступны в Broadcast → UDP;
- добавлен Field Order: progressive, upper/TFF, lower/BFF;
- добавлены service name, service number/ID, provider, video PID, audio PID,
  MPEG-TS service type и PCR interval;
- старые сохранённые запросы получают defaults: FluxIO / 1 / FluxIO / 256 /
  257 / digital_tv / 20 ms / progressive;
- FFmpeg получает `localaddr`, field-order encoder flags, service metadata,
  `-streamid`, `-mpegts_service_id`, `-mpegts_service_type` и `-pcr_period`;
- SCTE-35/TSDuck тракт сохраняет service ID и выбранный output interface;
- preflight блокирует конфликт SCTE-35 PID с video/audio PID;
- Log Output получает progress-строки с transmitted frames, FPS, bitrate и
  program time.

## Проверка

- `npm run typecheck` — успешно;
- `npm test` — unit/cross-platform suite;
- `GRUBER_RUN_FFMPEG_TESTS=1 npm run test -w @gruber/media-server` — реальный
  двухроликовый TFF playout через UDP с custom service/PID/PCR и HLS preview;
- production build выполняется командой `npm run build`.

Frame progress подтверждает передачу FFmpeg в локальный UDP socket. Фактический
приём головной станцией по-прежнему проверяется downstream analyzer или
return-feed.
