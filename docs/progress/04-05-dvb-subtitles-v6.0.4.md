# 04.05 — DVB subtitles и draggable FX layers v6.0.4

Дата завершения: 2026-08-10.

Реализовано:

- добавлен выбор `Burn-in / DVB Subtitles` в Broadcast;
- `.srt` всех активных роликов объединяются в program timeline с учётом trim;
- GStreamer создаёт DVB bitmap PES, TSDuck объединяет его с video/audio/SCTE;
- PMT получает private-data `stream_type 0x06` и DVB `subtitling_descriptor`;
- настраиваются subtitle PID, ISO 639 language, normal/hearing-impaired type, font, palette, reserved bitrate и PTS offset;
- DVB PID проходит через тот же CBR transport и continuity monitor;
- Encoding Monitor показывает состояние, PID, язык, число source clips и cue;
- FX layer переносится целиком по Timeline Trimming, не меняя длительность; handles сохраняют функцию trim;
- дизайн синхронизирован в Figma отдельным экраном `v6.0.4 · Playlist · Draggable FX timeline + DVB subtitles`: центральная зона `DRAG` двигает слой, края задают IN/OUT, субтитры показаны отдельной DVB PID-дорожкой;
- `setup.mjs` ищет и устанавливает GStreamer на macOS, Windows и Debian/Ubuntu;
- версия приложения увеличена до `6.0.4`.

Проверка:

- `npm run typecheck`;
- `npm test`;
- unit tests program SRT timeline, GStreamer command, PMT descriptor, TSDuck merge и FX drag clamping.
- визуальная проверка Figma полного экрана и Timeline Trimming; все текстовые слои используют семейство Geist.
