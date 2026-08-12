# 04.17 — Future import, адаптивный Broadcast и transport preview v6.0.16

Статус: завершён 2026-08-11.

## Реализовано

- Current и Future получили отдельные Import queues. Переход на пустой Future
  из Playlist сразу открывает Future Import; очистка одного слота не удаляет
  материалы второго.
- Broadcast использует высоту окна приложения: encoder settings и нижние
  monitor cards прокручиваются независимо, а 16:9 preview остаётся видимым.
- Playlist rows с тремя и более FX увеличиваются по высоте; FX chips
  раскладываются в две колонки и не вытесняют кнопки управления.
- Для UDP/SRT TSDuck после `regulate` дублирует финальный MPEG-TS на отдельный
  localhost UDP port. Независимый FFmpeg decoder создаёт HLS
  `transport-index.m3u8`, который использует Encoding Monitor.
- Transport preview автоматически перезапускается до трёх раз; его отказ не
  останавливает эфир. HLS client продолжает ожидать preview во время длительной
  подготовки недельного расписания.

## Граница мониторинга

Post-TSDuck preview подтверждает composition, кодеки и структуру локального
финального SPTS после SCTE-35/DVB subtitle/PCR/CBR обработки. Он не подтверждает
прохождение пакетов через NIC, switch и головную станцию. Для подтверждения
доставки нужен независимый приёмник, сетевой capture или return feed от ГС.

## Проверка

- `npm run typecheck`;
- media-server unit suite;
- реальная localhost цепочка `FFmpeg → TSDuck → TS mirror → FFmpeg → HLS`
  сформировала пять live HLS segments;
- Browser QA: пустой Future открывает Future Media Library;
- Browser QA при 1280×720 и 1024×700: preview остаётся видимым, settings и
  monitor details имеют независимую вертикальную прокрутку.
