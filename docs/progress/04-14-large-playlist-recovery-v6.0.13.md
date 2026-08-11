# 04.14 — Большие Playlist и recovery payload v6.0.13

Дата завершения: 2026-08-11.

## Причина

Playlist из 216 роликов создавал один большой FFmpeg `filter_complex`. На
Windows Node.js передаёт arguments через `CreateProcess`, и суммарная строка с
input paths и filter graph превышала системный предел. `spawn()` завершался с
`ENAMETOOLONG` уже после запуска TSDuck.

Snapshot большого проекта дополнительно мог превысить стандартный body limit
Fastify `1 MiB`. После failed start media-server сохранял checkpoint с нулевым
progress, из-за чего UI показывал `Interrupted · 00:00:00`, хотя эфир не успел
начаться.

## Реализация

- media-server записывает filter graph в
  `GRUBER_PREVIEW_DIR/ffmpeg-filter-<phase>-<loop>.txt`;
- FFmpeg получает короткие arguments `-filter_complex_script <path>`;
- Log Output сообщает число роликов, размер script и оценку оставшейся command
  line;
- на Windows действует preflight-порог 30 000 characters: если его превышают
  уже сами длинные media/overlay paths, оператор получает понятное сообщение до
  `spawn`, а TSDuck корректно останавливается;
- для workspace session, playout start/take и Future update установлен route
  body limit `32 MiB`;
- recovery checkpoint сохраняется только для активного эфира либо failed
  playout с реальным progress;
- legacy failed checkpoint с нулевой позицией не помечается как interrupted.

## Проверка

- unit test строит 216-роликовый graph больше 32 767 characters и подтверждает,
  что scripted FFmpeg command остаётся меньше 30 000 characters;
- API test отправляет workspace JSON больше `1 MiB` и исключает HTTP 413;
- checkpoint tests разделяют failed-before-spawn и interrupted-on-air;
- реальный FFmpeg UDP CBR integration test проходит с filter script;
- полный typecheck, test, production build и `git diff --check` выполняются из
  корня monorepo.
