# Версионирование

FluxIO использует Semantic Versioning:

- major — несовместимая смена formats/API/operator workflow;
- minor — новая совместимая capability;
- patch — исправление или завершённый совместимый vertical slice.

Текущая версия хранится в корневом `package.json`. UI, media-service, setup и
splash читают её автоматически. Версии package metadata в workspaces и lockfile
обновляются npm-aware командой и должны совпадать.

## Совместимость

- API version сейчас `v1`.
- Workspace snapshot поддерживает version 1/2 через defaults/migration logic.
- Encoding profile format version 1.
- `.fto` имеет собственный formatVersion.
- `.air` — legacy schedule input; новый export — `.txt`.
- Старый service с новым UI запрещён операционно: UI показывает warning, потому
  что schema старого service может срезать новые fields.

## Перед bump

1. Определить compatibility impact.
2. Добавить migration/defaults.
3. Обновить root и workspace package versions + lockfile.
4. Проверить health version test.
5. Обновить format version только при изменении самого file format.
6. Обновить документацию и release notes.
7. Выполнить release checklist.

Не меняйте номер версии global text replacement.
