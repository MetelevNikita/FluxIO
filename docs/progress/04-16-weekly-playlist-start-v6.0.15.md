# 04.16 — Запуск недельного Playlist v6.0.15

Дата завершения: 2026-08-11.

## Причина

Electron применял общий `AbortSignal.timeout(10000)` к `/api/playout/start`.
Media-service при этом продолжал последовательно проверять каждый материал через
`ffprobe`. Для недельного расписания из сотен сетевых файлов клиент через 10
секунд показывал `signal timed out`, хотя сервер позднее всё же запускал эфир.

Дополнительный предел в 500 элементов не покрывал даже базовый случай 168 часов
по 20 минут: он содержит 504 ролика до добавления отбивок.

## Реализация

- `/api/playout/start` и `/api/playout/take` получили отдельный client timeout
  30 минут;
- media import сохраняет `sourceDurationSeconds` и `hasAudio` в workspace и
  передаёт их в playout request;
- если metadata присутствуют, media-service проверяет существование файла, но не
  запускает повторный `ffprobe`;
- legacy session без metadata сохраняет совместимость и выполняет обычный
  `ffprobe`;
- graphics/media preparation использует максимум восемь параллельных workers,
  сохраняет исходный порядок Playlist и переиспользует probe Promise для
  повторяющихся media paths;
- Log Output показывает заявленную длительность, concurrency и progress на
  первом, каждом 50-м и последнем элементе;
- лимиты Current/Future и start/update API увеличены до 1000 элементов;
- workspace допускает 1000 элементов в каждом расписании и до 2500 media assets;
- media scan/probe принимает до 1000 файлов.

## Ожидаемый Log Output

```text
Preparing 504-clip schedule (168.0 hours) with 8 parallel media checks
Graphics preparation: 1/504 clip(s) checked
Graphics preparation: 50/504 clip(s) checked
...
Media preparation: 504/504 clip(s) checked
FFmpeg graph prepared for 504 clip(s): ... media paths embedded
Starting 504 clip playout
```

## Проверка

- command regression строит 504 ролика по 20 минут, суммарно ровно 168 часов;
- StartPlayout contract принимает все 504 элемента;
- concurrency test подтверждает максимум восемь активных workers, 504 результата
  и неизменный порядок;
- web test подтверждает 30-минутный timeout start/take, 10-минутный analyze и
  обычный 10-секундный timeout status request;
- typecheck, полный test suite, production build и `git diff --check` проходят
  из корня monorepo.

## Эксплуатация

После обновления нужно пересобрать и переустановить media-service и Electron.
Если UI продолжает показывать `signal timed out` примерно через 10 секунд,
запущен старый web bundle либо background media-service предыдущей версии.
