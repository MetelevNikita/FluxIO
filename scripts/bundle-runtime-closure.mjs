import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/* -------------------------------------------------------------------------- *
 * Рантайм-замыкание зависимостей.
 *
 * На целевой машине нет ни сети, ни npm, поэтому `node_modules` едут готовыми.
 * Но не всё дерево: TypeScript, Vite, electron-builder и Prisma CLI нужны
 * только сборщику и весят вместе больше, чем всё остальное приложение.
 *
 * Замыкание считается от `dependencies` рабочих пакетов вглубь. Необязательные
 * зависимости берутся, только если они есть на диске: у нативных пакетов
 * (`@napi-rs/canvas`) в них перечислены все платформы сразу, а установлена
 * ровно одна — та, под которую собирается комплект.
 * ------------------------------------------------------------------------- */

/**
 * @returns пакеты для `node_modules` комплекта: имя и каталог-источник.
 *   Сами рабочие пакеты в список не попадают — их переносит дерево приложения.
 */
export async function collectRuntimeClosure({ entryPackages, projectRoot }) {
  const collected = new Map();
  const queue = [];

  for (const name of entryPackages) {
    const directory = await resolvePackageDirectory(name, projectRoot, projectRoot);
    if (!directory) throw new Error(`Рабочий пакет ${name} не найден в дереве проекта`);
    queue.push({ directory, name });
  }

  const seenEntries = new Set(entryPackages);
  while (queue.length > 0) {
    const current = queue.shift();
    const manifest = await readPackageManifest(current.directory);
    if (!manifest) continue;
    for (const name of dependencyNames(manifest)) {
      const directory = await resolvePackageDirectory(name, current.directory, projectRoot);
      if (!directory) {
        // Необязательная зависимость чужой платформы — её здесь просто нет.
        if (isOptional(manifest, name)) continue;
        throw new Error(
          `Зависимость ${name} пакета ${manifest.name ?? current.name} не найдена. ` +
            "Выполните npm ci на сборочной машине перед сборкой комплекта.",
        );
      }
      if (collected.has(name) || seenEntries.has(name)) continue;
      collected.set(name, { directory, name });
      queue.push({ directory, name });
    }
  }

  return [...collected.values()].sort((left, right) => (left.name < right.name ? -1 : 1));
}

/** Обязательные плюс те необязательные, что реально установлены. */
export function dependencyNames(manifest) {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
}

export function isOptional(manifest, name) {
  return Object.hasOwn(manifest.optionalDependencies ?? {}, name);
}

/**
 * Разрешение пакета по правилам Node: сначала свой `node_modules`, затем вверх
 * по дереву до корня проекта. Дальше корня не идём — комплект не должен
 * зацепить пакет из глобальной установки сборочной машины.
 */
export async function resolvePackageDirectory(name, fromDirectory, projectRoot) {
  let current = path.resolve(fromDirectory);
  const root = path.resolve(projectRoot);
  for (;;) {
    const candidate = path.join(current, "node_modules", ...name.split("/"));
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current || !parent.startsWith(root)) break;
    current = parent;
  }
  return null;
}

async function readPackageManifest(directory) {
  try {
    return JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  } catch {
    return null;
  }
}
