# Разработка

## Репозиторий

Это npm workspaces monorepo. Границы:

- contracts — данные и чистая scene timing/layout logic;
- scene-renderer — drawing only;
- media-server — filesystem/process/database/network;
- web — operator state, effect planning и UI;
- desktop — native shell.

Не переносите ответственность ради удобного import. Особенно запрещено
запускать FFmpeg из React и рисовать вторую версию scene в server.

## Команды

```bash
npm ci --include=dev
npm run build:contracts
npm run typecheck
npm test
npm run build
```

После изменения contracts всегда сначала `build:contracts`: workspace packages
потребляют compiled `dist`.

## Contracts-first

Новая форма данных:

1. Zod schema;
2. inferred type;
3. defaults/backward compatibility;
4. build contracts;
5. UI/server consumers;
6. validation tests.

Не создавайте ручной interface, повторяющий schema.

## Сквозная encoding setting

1. `portableEncodingSettingsSchema` и runtime video/audio/endpoint schema;
2. default Broadcast Settings;
3. UI control;
4. `buildStartRequest`;
5. FFmpeg/TSDuck command builder;
6. profile serialization, если setting portable;
7. preflight и test.

Secrets не входят в portable profile.

## Эффект второго уровня

1. settings schema;
2. default definition/scene;
3. pure `planBroadcastEffect`;
4. `applyBroadcastPlan`;
5. inspector;
6. task mapping, если нужно;
7. tests на timing/order/idempotence;
8. docs operator + data format.

Planner не мутирует input и не сортирует effects.

## Scene property/node

1. `packages/contracts/src/scene.ts`;
2. pure timing/layout в `scene-timing.ts`;
3. RecordingSurface test;
4. `drawScene`;
5. editor inspector/tree/timeline;
6. template validation;
7. docs.

`apps/media-server/src/scene/surface.ts` должен только создавать canvas,
регистрировать fonts и выдавать pixels. Если property требует drawing logic
там, слой выбран неверно.

## UI

`App.tsx` остаётся orchestration root. Подключение к media-service, health и
telemetry polling уже вынесены в `use-media-service.ts`; следующие независимые
state machines следует выносить в hooks/modules. Screens загружаются через
`React.lazy`, чтобы не возвращать единый megabyte bundle.

Polling не должен перерисовывать тяжёлый Effects tree; используйте stable
callbacks и memo только после измерения. Не держите две competing selection
states.

CSS проверяйте визуально: typecheck не ловит потерянное тело multi-selector
rule. Для layout change откройте минимум 960×640 и 1440×920.

## Media-service

Routes тонкие: parse schema, call service, map error. Process state живёт в
`PlayoutSupervisor`. Pure argument construction — в command builders.

Не:

- глотать preflight failure;
- создавать второй `-filter_complex`;
- менять PMT/PID посреди session;
- убивать process tree без ownership check;
- выполнять долгую sync работу в request path без причины.

## Database

Изменение persistent schema:

```bash
npm run db:migrate:dev
npm run db:generate
```

Migration коммитится, generated Prisma client — нет. Secrets хранятся отдельно
и шифруются. Backward compatibility workspace обеспечивается defaults/upgrade
logic в contracts/UI.

## Файлы и paths

Используйте `node:path`, не ручную конкатенацию. Windows drive, UNC и POSIX
обязательны в tests для command builders. Пути, приходящие из UI, валидируются
и читаются media-service, не browser.

## Производительность

Критичные места:

- scene pixels и pipe throughput;
- command-line length;
- number of child processes;
- event-loop blocking;
- web initial bundle;
- weekly array transformations.

Оптимизация должна иметь metric. Удаление строк само по себе не цель. Не
объединяйте понятный code только ради меньшего line count.

## Документация

Обновляйте evergreen file, связанный с поведением. История patch хранится в
Git, отдельные progress reports не создаются. Значимое архитектурное решение
оформляется ADR.

## Definition of done

- typecheck;
- unit/integration tests;
- production build;
- relevant external test;
- visual QA для UI/scene;
- docs;
- no broken links;
- no secrets или generated output в diff.
