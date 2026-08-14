# 04.20 — Исправление старта rolling playout и Preview v6.0.19

Дата: 2026-08-14.

## Симптомы

После запуска большого расписания media-service доходил до `FFmpeg started`,
`Clip renderer started` и `prefetched`, но не передавал ни одного кадра.
Broadcast Preview оставался пустым. Composite Preview во вкладке Playlist тоже
не создавал первый HLS segment.

## Причины

1. Raw video и PCM audio передавались из clip renderer в постоянный encoder
   напрямую через два независимых системных pipe. На полном кадре 1920×1080
   один pipe мог заполниться, пока принимающий FFmpeg открывал второй input.
2. Composite Preview удалял program output из команды, но оставлял выходы
   `[vprogram]` и `[aprogram]` неподключёнными. FFmpeg завершался с ошибкой
   `Filter ... has output unconnected`.
3. После восстановления workspace media registry нового процесса был пуст,
   хотя duration и audio metadata ролика уже находились в сохранённой сессии.
4. FFmpeg progress composite preview поступал в stdout, который сервис не
   считывал, поэтому длительная preview-сессия могла остановиться после
   заполнения child-process pipe.

## Реализация

- Для каждого текущего и prefetched clip renderer созданы ограниченные Node.js
  `PassThrough` buffers: минимум один полный YUV420P frame для video и две
  секунды PCM для audio.
- Переход к следующему ролику выполняется только после успешного завершения
  renderer и полного drain video/audio buffers. Байты соседних роликов не могут
  перемешаться на входе постоянного encoder.
- При готовности обоих потоков Log Output пишет
  `Clip renderer N/M pipe ready: video + audio`. Если один поток не поступил за
  30 секунд, playout завершается с указанием `video`, `audio` либо обоих.
- Composite graph подключает неиспользуемые program branches к `nullsink` и
  `anullsink`, а stdout preview-процесса всегда считывается.
- Composite Preview принимает сохранённый `sourceDurationSeconds`, повторно
  проверяет canonical file path и регистрирует только выбранный существующий
  файл. Полный Playlist повторно анализировать не требуется.

## Проверка

- `npm test -w @gruber/media-server` — 72 сценария, 67 passed, 5 штатно skipped;
- реальный FFmpeg/TSDuck тест выполнен на output 1920×1080 с активной
  нормализацией -23 LUFS;
- восстановленный composite Playlist Preview создал HLS manifest и segment;
- два ролика прошли через persistent encoder и один TSDuck transport;
- подтверждены transmitted frames, PID 0x1FFF stuffing, заданный CBR, отсутствие
  video/audio continuity errors, PCR interval менее 40 ms и post-TSDuck HLS;
- Repeat успешно начал следующий цикл и все child processes штатно завершились.

## Уточнение после полевого теста

На отдельных исходниках с включённым динамическим `loudnorm` один video/audio
renderer всё ещё мог заполнить video pipe до первого нормализованного audio
chunk. Этот случай устранён в v6.0.20 разделением video и audio renderers.

## Операторская проверка после обновления

После `git pull` запустить `node setup.mjs`, затем Start Broadcast. До первого
`Transmitted frames` в логе должна появиться строка
`pipe ready: video + audio`. В Playlist нажать Play на ролике из восстановленной
сессии: composite preview должен начать воспроизведение без повторного Analyze
всех 257 файлов.
