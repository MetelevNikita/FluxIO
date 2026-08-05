# 02.22 — Управление GOP I/P/B в v4.2.5

## Интерфейс

В Broadcast добавлен блок `GOP Structure (I/P/B)`:

- `GOP length (frames)` — период I-frame, от 1 до 600 кадров;
- `Consecutive B-frames` — число B-frame между опорными I/P;
- `GOP mode` — Closed или Open;
- динамическая подсказка показывает пример структуры и длительность GOP в секундах.

Начальное значение для 23.976 fps: `48` кадров, `2` B-frame, Closed GOP.

## Команды encoder

- H.264: фиксированные `keyint/min-keyint`, `scenecut=0`, `b-adapt=0`,
  `b-pyramid=none`, управляемый `open-gop`;
- H.265: те же ограничения через `x265-params`;
- MPEG-2: `-g`, `-bf`, optional `+cgop`; Closed GOP получает необходимый
  `sc_threshold=1000000000`;
- общий FFmpeg output получает `-g`, `-keyint_min` и `-bf`.

При `B=0` H.264 использует `zerolatency`. При `B>0` этот tune отключается,
поскольку он несовместим с B-frame reorder. SCTE-35 по-прежнему принудительно
создаёт keyframe в cue-time.

## Validation и проверка

- B-frame count должен быть меньше GOP length;
- MPEG-2 допускает максимум два последовательных B-frame;
- H.264 Baseline допускает только `B=0`;
- unit tests проверяют H.264/H.265/MPEG-2 команды;
- реальный UDP capture разобран ffprobe и содержит I, P и B frame;
- отдельные реальные H.265 и MPEG-2 smoke tests подтвердили структуру `IBBP`.

Версия всех компонентов: `v4.2.5`.
