# Документация FluxIO

## Запуск и эксплуатация

- [`development-runbook.md`](development-runbook.md) — интерактивная test/development установка одной командой без Docker.
- [`production-runbook.md`](production-runbook.md) — clone → setup wizard → background service на Linux/macOS/Windows.
- [`scte35-engineer-runbook.md`](scte35-engineer-runbook.md) — операторская настройка, запуск и независимая проверка SCTE-35 по UDP/SRT.

## Проектирование

- [`product-requirements.md`](product-requirements.md) — назначение, границы MVP и требования надёжности.
- [`architecture.md`](architecture.md) — компоненты, данные, FFmpeg pipeline и безопасность.
- [`design-system.md`](design-system.md) — дизайн-токены и фактическое поведение интерфейса из Figma.
- [`development-plan.md`](development-plan.md) — завершённые этапы и следующая очередь работ.
- [`adr`](adr) — журнал архитектурных решений.
- [`progress`](progress) — отчёты по законченным вертикальным срезам и команды проверки.

## Правило обновления

После каждого этапа одновременно обновляются:

1. реализация;
2. воспроизводимая проверка;
3. архитектура и инструкции запуска;
4. соответствующий отчёт в `progress`.
