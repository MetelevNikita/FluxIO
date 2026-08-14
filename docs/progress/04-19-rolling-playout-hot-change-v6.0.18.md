# 04.19 — Rolling playout и transport hardening v6.0.18

Дата: 2026-08-14.

## Причина

Один FFmpeg graph со всеми 300 роликами недельного расписания медленно
запускался, упирался в Windows command-line limits и пересоздавал encoder на
операторском Take. На анализаторе также наблюдались CC gaps, bitrate transients,
PCR на subtitle PID и subtitle PTS, приходящий слишком поздно.

## Реализация

1. Media-service держит один program encoder и один TSDuck output на весь
   Playlist. Отдельные clip-renderers формируют готовые YUV/PCM потоки; следующий
   renderer заранее запущен и ждёт на pipe.
2. `PUT /api/playout/playlist` принимает изменения Current. Уже сыгранная и
   текущая часть неизменны, а будущий clip renderer пересобирается. AGE, LOGO,
   FX и Burn-in SRT вступают в силу при старте этого ролика.
3. Для UDP/SRT удалена дублирующая HLS-ветка program encoder. Monitor строится
   только из локальной копии финального post-TSDuck TS.
4. `continuity --fix` нормализует CC до endpoint. DVB subtitle PID очищается от
   PCR, а bitmap PES передаётся до 2000 ms раньше при сохранении presentation
   PTS; pre-roll ограничивается первым cue. SRT читаются по восемь файлов
   параллельно, UTF-8 имеет fallback Windows-1251.
5. UI получил отдельный Clip Progress, live RMS meter в dBFS и composite
   Playlist preview с AGE/LOGO/FX/Burn-in SRT.
6. Schedule `.txt` сохраняет `titlePath#1..N`, `startOn`, `endOn`; старый файл
   без `endOn` остаётся совместимым. `.air` остаётся только входным форматом.
7. Заблокированный prefetched FFmpeg при Stop/HOT CHANGE получает закрытие raw
   pipes, SIGTERM и ограниченный fallback SIGKILL, поэтому процесс не остаётся
   висеть после Electron/test shutdown.

## Проверка

- `npm run typecheck`;
- `npm test` — 99 обычных тестов без ошибок, 5 аппаратных/integration сценариев
  пропущены штатно;
- `GRUBER_RUN_FFMPEG_TESTS=1 node --test --test-name-pattern="real FFmpeg session keeps" apps/media-server/dist-test/app.test.js`;
- реальный тест подтверждает два клипа, PID 0x1FFF stuffing, fixed muxrate,
  отсутствие video/audio CC errors, PCR interval менее 40 ms, GOP I/P/B,
  post-TSDuck HLS и Repeat; процесс завершается без утечки child FFmpeg.

## Граница этапа

HOT CHANGE не меняет кадры уже идущего ролика и не перестраивает активные
DVB subtitle/SCTE-35 plans. Граница Repeat/Current→Future пока запускает новый
transport cycle. Перед 24/7 вводом обязателен 72-часовой soak-test на целевом
сервере со скоростью encoder не ниже 1.05x и независимым приёмным анализатором.
