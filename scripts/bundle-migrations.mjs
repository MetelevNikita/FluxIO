import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/* -------------------------------------------------------------------------- *
 * Миграции схемы из офлайн-комплекта.
 *
 * В комплекте едут сами `migration.sql`, а не Prisma CLI: CLI со schema engine
 * весит 66 МБ и на целевой машине больше ни для чего не нужен — рантайм Prisma 7
 * работает через WASM-компилятор запросов и движка-бинаря не требует.
 *
 * Применение обязано выглядеть для Prisma так же, как `migrate deploy`:
 * запись в `_prisma_migrations` с той же контрольной суммой файла. Иначе на
 * машине разработчика следующая `migrate deploy` попыталась бы применить их
 * второй раз и упала на существующих таблицах.
 * ------------------------------------------------------------------------- */

/** Таблица журнала миграций Prisma. Форма закреплена самой Prisma. */
const migrationsTableSql = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

/** Контрольная сумма миграции — ровно та, что считает Prisma: sha256 файла. */
export function migrationChecksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

/**
 * Миграции комплекта в порядке применения.
 *
 * Порядок задан именами каталогов (`20260803120000_initial`) и сортировкой по
 * ним: у Prisma это единственный источник очерёдности, и менять его нельзя —
 * вторая миграция ссылается на таблицы первой.
 */
export async function readBundleMigrations(migrationsDirectory) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const migrations = [];
  for (const name of names) {
    const filePath = path.join(migrationsDirectory, name, "migration.sql");
    let sql;
    try {
      sql = await readFile(filePath, "utf8");
    } catch {
      throw new Error(`Миграция ${name} без migration.sql: комплект собран неполностью`);
    }
    migrations.push({ checksum: migrationChecksum(sql), name, sql });
  }
  if (migrations.length === 0) {
    throw new Error(`В ${migrationsDirectory} нет миграций: комплект собран неполностью`);
  }
  return migrations;
}

/**
 * Что осталось применить.
 *
 * Изменившаяся сумма уже применённой миграции — отказ, а не «применим ещё раз»:
 * это значит, что база и комплект разошлись, и молча накатывать поверх нельзя.
 */
export function pendingMigrations(migrations, applied) {
  const appliedByName = new Map(applied.map((entry) => [entry.migration_name, entry]));
  const pending = [];
  for (const migration of migrations) {
    const previous = appliedByName.get(migration.name);
    if (!previous) {
      pending.push(migration);
      continue;
    }
    if (previous.checksum !== migration.checksum) {
      throw new Error(
        `Миграция ${migration.name} в базе не совпадает с комплектом. ` +
          "База изменена вручную или собрана другой версией: примените обновление " +
          "на исходной машине или пересоздайте базу.",
      );
    }
  }
  return pending;
}

/**
 * Применяет миграции комплекта.
 *
 * `client` — обычный клиент `pg`; каждая миграция идёт своей транзакцией вместе
 * с записью в журнал: частично применённая схема без записи о ней хуже, чем
 * отказ на середине.
 */
export async function applyBundleMigrations(client, migrations, onApplied) {
  await client.query(migrationsTableSql);
  const { rows } = await client.query(
    'SELECT "migration_name", "checksum" FROM "_prisma_migrations" ' +
      'WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL',
  );
  const pending = pendingMigrations(migrations, rows);

  for (const migration of pending) {
    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO "_prisma_migrations" ' +
          '("id", "checksum", "finished_at", "migration_name", "logs", ' +
          '"rolled_back_at", "started_at", "applied_steps_count") ' +
          "VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)",
        [randomUUID(), migration.checksum, migration.name],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new Error(
        `Миграция ${migration.name} не применилась: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    onApplied?.(migration.name);
  }

  return { applied: pending.map((migration) => migration.name), total: migrations.length };
}
