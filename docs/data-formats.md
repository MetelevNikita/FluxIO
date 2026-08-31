# Форматы данных

## Общие правила

Все JSON-форматы валидируются Zod-схемами. Не редактируйте production files
вручную без повторного import test. Unknown format/version отклоняется до
изменения workspace.

## Schedule `.air/.txt`

Line-oriented текстовый формат. `.air` — legacy input, `.txt` — input/output.
Подробная grammar и examples: [schedules-and-media.md](schedules-and-media.md).

## Encoding profile `.txt`

UTF-8 JSON:

```json
{
  "format": "fluxio-encoding-settings",
  "formatVersion": 1,
  "applicationVersion": "8.0.1",
  "exportedAt": "2026-08-28T00:00:00.000Z",
  "secretsOmitted": ["srtPassphrase", "rtmpStreamKey"],
  "settings": {}
}
```

Содержит portable video/audio/output/subtitle/SCTE/logo settings. Не содержит
SRT passphrase, RTMP key и legacy stream key. После переноса проверьте path,
local address, hardware и secrets.

## Title `.fto`

`format = fluxio-title`, versioned metadata, summary и scene template. Extension
нельзя менять на `.json`: native dialog и library различают тип по extension и
marker.

## Broadcast task JSON

Допустим:

```json
[
  { "title": "Programme 01", "guest": "Иван Иванов", "role": "Ведущий" }
]
```

или одна wrapper property:

```json
{
  "lower_thirds": [
    { "title": "Programme 01", "guest": "Иван Иванов" }
  ],
  "exportedAt": "2026-08-28"
}
```

Wrapper снимается только если найден ровно один непустой object array. Два
массива требуют явного решения, иначе система могла бы тихо выбрать неверные
данные. Максимум records задаётся contracts (сейчас 10 000).

Mapping хранит `matchSourceKey` и bindings `sourceKey → targetKey`. Значения
field могут быть strings/numbers/booleans и нормализуются в text.

## Ticker source

TXT — одна непустая строка на item. JSON — array strings/objects по поддержанной
форме. RSS/Atom загружает media-service, extracts titles и ограничивает count.

URL source является server-side fetch; API нельзя публиковать в недоверенную
сеть.

## Workspace snapshot

Внутренний JSON в PostgreSQL:

- version;
- analyzed assets;
- Current/Future;
- active schedule и selection;
- schedule metadata;
- libraries;
- effect definitions;
- start marker;
- primitive Broadcast Settings.

Secrets удаляются перед записью snapshot и шифруются отдельно. Runtime
checkpoint содержит session/current clip/time/progress/loop/interrupted.
Максимальный HTTP body для больших workspace/playout requests — 32 MiB.

## Database

Prisma migrations определяют persistent schema. JSON columns хранят request
snapshots и metadata, relational entities — media, playlists, configurations и
sessions. Generated Prisma client не коммитится и восстанавливается
`npm run db:generate`.

## HLS preview

Temporary files:

- `index.m3u8` / `segment-N.ts` для direct programme preview;
- `transport-index.m3u8` / `transport-segment-N.ts` для post-TSDuck mirror;
- отдельный session path для clip preview.

Это cache, не archive master. При cleanup/перезапуске preview можно удалить.

## Logs

`fluxio-YYYY-MM-DD.log` содержит timestamped events и daily report. Каталог
определяет `GRUBER_LOG_DIR`, иначе Desktop/FluxIO logs или home fallback.
Логи могут содержать paths и endpoint labels; перед передачей третьей стороне
их нужно проверить на чувствительные данные.
