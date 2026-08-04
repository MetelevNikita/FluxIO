# Этап 2.4 — Надёжный HLS preview и эфирный countdown

Дата завершения: 2026-08-04.

## Результат

Playlist Preview и Broadcast Monitor используют общую устойчивую схему HLS-воспроизведения. Preview выбранного исходника запускается после Play, а эфирный monitor автоматически подключается к program output сразу после появления первых HLS-сегментов.

Оба видеоблока сохраняют соотношение сторон 16:9. Playlist Preview ограничивает размер одновременно шириной рабочей области и высотой viewport, поэтому при изменении размера Electron-окна не ломает transport, filmstrip и properties.

## Исправленная причина

Раньше Broadcast запрашивал manifest сразу после запуска FFmpeg. До создания первого сегмента API возвращал `404`, HLS.js считал ошибку fatal и больше не подключался. Playlist Preview дополнительно мог выбрать нативный HLS через `canPlayType`, хотя Chromium/Electron не гарантировал фактическое воспроизведение этой веткой.

Теперь:

- HLS.js используется приоритетно;
- worker отключён для одинакового поведения в development и packaged Electron;
- network errors повторяют загрузку manifest с ограниченным backoff;
- media errors используют decoder recovery;
- асинхронный Playlist Play стартует muted, затем восстанавливает выбранную громкость после фактического начала видео;
- UI различает `Preparing`, `Playing` и понятную ошибку preview.

## Оставшееся время

Broadcast Monitor вычисляет оставшееся время всего плейлиста по серверному timeline:

```text
Remaining = totalDurationSeconds - outTimeSeconds
```

Countdown `HH:MM:SS` отображается:

- поверх живого program preview;
- в карточке Playlist Progress;
- в Real-time Stats;
- в общей нижней status bar.

## Проверка

Создан настоящий 12-секундный H.264/AAC ролик. Через media-service выполнены ffprobe, clip HLS и UDP playout на loopback endpoint. В Chromium подтверждены `readyState=4`, декодирование 960×540, движение `currentTime` и отсутствие pause. В Broadcast подтверждены живой preview, NET 2.4 Mbps и уменьшение `Remaining` с `00:00:12` до `00:00:01`.

Тестовый UDP-поток, HLS session и временный ролик после проверки остановлены и удалены.
