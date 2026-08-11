# 04.15 — Длинные FFmpeg input paths v6.0.14

Дата завершения: 2026-08-11.

## Причина

В v6.0.13 большой `filter_complex` уже записывался в отдельный файл, но 216
длинных Windows media paths продолжали передаваться как пары `-i <path>`.
Оставшаяся команда достигала 38 717 characters, поэтому Windows preflight
останавливал запуск. Сокращение имён или ручное разделение недельного Playlist
не подходит для штатной операторской работы.

## Реализация

- media-service сначала строит обычную команду с прямыми `-i` inputs;
- при превышении порога 30 000 characters команда автоматически перестраивается
  без media path arguments;
- video/audio clips открываются source filter `movie` с явными video/audio
  output labels внутри UTF-8 filter script;
- AGE canvases, item/channel logos и static/video FX sources переносятся тем же
  способом;
- static sources получают конечный `tpad + trim` на длительность ролика/слоя:
  это сохраняет изображение в кадре, но не удерживает FFmpeg после конца
  расписания;
- SRT burn-in path уже является частью filter graph и остаётся в script;
- `-filter_complex_script` и короткие output arguments остаются в process
  command line;
- только если сокращённая команда всё ещё превышает порог, preflight сообщает о
  большом количестве SCTE-35 forced keyframes;
- Log Output фиксирует clips, script size, command characters и выбранный режим
  `media paths embedded` либо `direct media inputs`.

## Проверка

- regression scenario строит Playlist из 216 clips с длинными Windows paths;
- scripted command с прямыми inputs превышает 38 000 characters;
- embedded-input command не содержит `-i` и остаётся меньше 30 000 characters;
- отдельные assertions проверяют video/audio labels, full-frame AGE и item logo;
- реальный FFmpeg test открывает video/audio и PNG AGE из путей с пробелами,
  создаёт HLS preview и штатно завершается;
- media-server typecheck и tests проходят с обоими режимами command builder;
- полный monorepo typecheck, test, production build и `git diff --check`
  выполняются перед выпуском.

## Эксплуатация

После обновления и переустановки media-service оператору не нужно изменять пути
материалов. Для проблемного расписания в Log Output ожидается строка:

```text
FFmpeg graph prepared for 216 clip(s): ... KiB script, ... command characters, media paths embedded
```

Если остаётся старое сообщение `The playlist still requires a 38717-character
FFmpeg command`, запущен старый background service. Его нужно остановить,
пересобрать проект и повторно установить через `node setup.mjs`.
