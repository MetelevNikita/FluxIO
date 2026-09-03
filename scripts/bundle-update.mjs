import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  bundleManifestFileName,
  planBundleUpdate,
} from "./bundle-manifest.mjs";

/* -------------------------------------------------------------------------- *
 * Обновление установленного комплекта.
 *
 * Новый комплект распаковывается рядом, а не поверх: перезапись работающей
 * установки на середине копирования оставила бы эфирную машину без обеих
 * версий. Поэтому обновление — отдельный шаг, который переносит в установленный
 * каталог только изменившиеся компоненты.
 *
 * Две вещи не трогаются никогда:
 *
 * - `data/` — кластер PostgreSQL и реестр плагинов GStreamer. Компонентом он не
 *   является и в манифесте не описан, поэтому под замену не попадает вовсе;
 * - `app/.env` — вся настройка станции. Он лежит **внутри** компонента `app`,
 *   который заменяется целиком, поэтому его приходится уносить и возвращать
 *   руками.
 * ------------------------------------------------------------------------- */

/** Файлы установки, которые переживают замену компонента `app`. */
export const preservedApplicationFiles = [".env", ".env.backup", ".env.backup.1"];

/**
 * Почему обновить эту установку нельзя, или `null`.
 *
 * Проверки до первого копирования: на эфирной машине откатывать половину
 * перенесённых компонентов нечем.
 */
export function updateRefusal(installed, incoming) {
  if (installed.target.id !== incoming.target.id) {
    return `Установлен комплект для ${installed.target.id}, а обновление — для ` +
      `${incoming.target.id}. Платформы не совпадают.`;
  }
  if (installed.version === incoming.version) {
    return `Версия ${incoming.version} уже установлена.`;
  }
  return null;
}

/**
 * Что переносить.
 *
 * Медиастек весит сотни мегабайт и от версии к версии не меняется — сверка
 * отпечатков избавляет оператора от переписывания того же самого.
 */
export function planUpdate(installed, incoming) {
  return planBundleUpdate(installed, incoming);
}

/**
 * Переносит изменившиеся компоненты в установленный каталог.
 *
 * `.env` уносится до замены `app` и возвращается после: он живёт внутри
 * компонента, а настройка станции переезда не переживёт.
 */
export async function applyBundleUpdate({
  incoming,
  installationRoot,
  log = () => {},
  plan,
  sourceRoot,
}) {
  const preserved = await stashApplicationFiles(installationRoot);

  for (const id of plan.changed) {
    const component = incoming.components.find((entry) => entry.id === id);
    if (!component) continue;
    const source = path.join(sourceRoot, component.path);
    const destination = path.join(installationRoot, component.path);
    log(`  ${component.id} → ${component.path}`);
    await rm(destination, { force: true, recursive: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }

  for (const id of plan.removed) {
    log(`  ${id}: больше не входит в комплект`);
  }

  await restoreApplicationFiles(installationRoot, preserved);
  await cp(
    path.join(sourceRoot, bundleManifestFileName),
    path.join(installationRoot, bundleManifestFileName),
  );
  return { kept: plan.unchanged.length, moved: plan.changed.length };
}

async function stashApplicationFiles(installationRoot) {
  const stash = path.join(installationRoot, ".fluxio-update-stash");
  await rm(stash, { force: true, recursive: true });
  await mkdir(stash, { recursive: true });
  const saved = [];
  for (const name of preservedApplicationFiles) {
    const source = path.join(installationRoot, "app", name);
    if (!existsSync(source)) continue;
    await rename(source, path.join(stash, name));
    saved.push(name);
  }
  return { saved, stash };
}

async function restoreApplicationFiles(installationRoot, preserved) {
  for (const name of preserved.saved) {
    await rename(
      path.join(preserved.stash, name),
      path.join(installationRoot, "app", name),
    );
  }
  // Каталог-времянка не должен пережить обновление: в следующий раз он выглядел
  // бы как чужие остатки.
  if ((await readdir(preserved.stash)).length === 0) {
    await rm(preserved.stash, { force: true, recursive: true });
  }
}
