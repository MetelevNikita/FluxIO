# 03.05 — перенос Encoding Settings в FluxIO v5.0.4

Дата завершения: 2026-08-07.

## Результат

В Broadcast Settings добавлена панель `Encoding settings profile` с действиями
`Save .TXT` и `Import .TXT`. Профиль сохраняет все переносимые encoder, audio,
output, logo, Repeat и SCTE-35 настройки и восстанавливает их одним действием.

Формат описан shared contract и имеет `formatVersion: 1`. Импорт проверяет
структуру, обязательные поля и допустимые диапазоны. Максимальный размер — 1 MB.

SRT passphrase, RTMP stream key и legacy stream key исключаются до сериализации
и принудительно очищаются после импорта.

## Desktop integration

- отдельные Electron IPC channels для open/save;
- native `.txt` filters на Windows, macOS и Linux;
- UTF-8 read/write;
- web fallback через browser file input и download для development.

## Дополнительное исправление

Карточка `Schedule resources` теперь ограничивает ширину flex-content и
корректно сокращает длинный AGE help text через ellipsis, не перекрывая соседний
блок Channel logo.

## Проверка

- round-trip profile test;
- проверка отсутствия secrets в сериализованном тексте;
- TypeScript typecheck всех workspaces;
- полный test suite и production build;
- визуальная проверка Broadcast и Playlist toolbar.
