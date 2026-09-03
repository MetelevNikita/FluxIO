import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  bundleManifestFileName,
  bundleTargetId,
  bundleTargetMismatch,
  digestDirectory,
  formatBytes,
  validateBundleManifest,
} from "./bundle-manifest.mjs";

/* -------------------------------------------------------------------------- *
 * Установка из офлайн-комплекта — сторона целевой машины.
 *
 * Мастер работает здесь до всякой сборки, поэтому модуль обходится голым Node:
 * ни `@gruber/contracts`, ни npm-зависимостей.
 *
 * Дерево комплекта:
 *   <root>/manifest.json
 *   <root>/app/            это дерево, в нём и лежит setup.mjs
 *   <root>/runtime/node    интерпретатор, которым мастер и запущен
 *   <root>/db/migrations/  схема
 *   <root>/tools/<id>/     медиастек
 * ------------------------------------------------------------------------- */

/** Исполняемые файлы, которые мастер ищет в комплекте. */
const toolExecutables = {
  ffmpeg: { id: "ffmpeg", names: ["ffmpeg"] },
  ffprobe: { id: "ffmpeg", names: ["ffprobe"] },
  gstreamer: { id: "gstreamer", names: ["gst-launch-1.0"] },
  gstreamerInspect: { id: "gstreamer", names: ["gst-inspect-1.0"] },
  initdb: { id: "postgres", names: ["initdb"] },
  pgIsReady: { id: "postgres", names: ["pg_isready"] },
  postgres: { id: "postgres", names: ["postgres"] },
  psql: { id: "postgres", names: ["psql"] },
  tsduck: { id: "tsduck", names: ["tsp"] },
};

/**
 * Корень комплекта или `null`, если мастер запущен из обычного дерева проекта.
 *
 * Явный путь важнее найденного: комплект могли распаковать рядом, а запустить
 * мастера из репозитория.
 */
export function detectBundleRoot(projectRoot, explicitPath = null) {
  if (explicitPath) {
    const candidate = path.resolve(explicitPath);
    return existsSync(path.join(candidate, bundleManifestFileName)) ? candidate : null;
  }

  const root = path.resolve(projectRoot);
  const candidates = [root];
  // Уровнем выше комплект ищется, только если дерево лежит в `app/` — так его
  // раскладывает сборщик. Иначе чужой `manifest.json`, случайно оказавшийся
  // рядом с репозиторием, ломал бы обычную установку из исходников.
  if (path.basename(root) === "app") candidates.unshift(path.dirname(root));
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, bundleManifestFileName))) return candidate;
  }
  return null;
}

export async function readBundleManifest(bundleRoot) {
  const manifestPath = path.join(bundleRoot, bundleManifestFileName);
  let raw;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    throw new Error(`Не найден ${manifestPath}: это не каталог комплекта`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${manifestPath} повреждён: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const manifest = validateBundleManifest(parsed);
  const mismatch = bundleTargetMismatch(manifest, bundleTargetId());
  if (mismatch) throw new Error(mismatch);
  return manifest;
}

/**
 * Сверяет содержимое комплекта с манифестом.
 *
 * Считается всё: комплект едет флешкой, и битый файл в медиастеке всплыл бы
 * отказом эфира через неделю. Пересчёт идёт покомпонентно, чтобы оператор видел
 * прогресс и понимал, что именно не сошлось.
 */
export async function verifyBundleComponents(bundleRoot, manifest, onComponent) {
  const problems = [];
  for (const component of manifest.components) {
    const directory = path.join(bundleRoot, component.path);
    if (!existsSync(directory)) {
      problems.push(`${component.id}: каталог ${component.path} отсутствует`);
      onComponent?.({ component, ok: false });
      continue;
    }
    const actual = await digestDirectory(directory);
    const ok = actual.digest === component.digest;
    if (!ok) {
      problems.push(
        `${component.id}: контрольная сумма не совпала ` +
          `(${actual.files} файл(ов), ${formatBytes(actual.bytes)} против ` +
          `${component.files} и ${formatBytes(component.bytes)})`,
      );
    }
    onComponent?.({ actual, component, ok });
  }
  if (problems.length > 0) {
    throw new Error(
      `Комплект повреждён:\n  - ${problems.join("\n  - ")}\n` +
        "Скопируйте файл заново и проверьте его контрольную сумму.",
    );
  }
}

/**
 * Пути к инструментам комплекта.
 *
 * Отсутствующий инструмент — не ошибка: комплект можно собрать без медиастека
 * (`--without-tools`) для площадки, где он уже установлен и настроен.
 */
export function bundleToolPaths(bundleRoot, manifest, platform = process.platform) {
  const paths = {};
  for (const [key, tool] of Object.entries(toolExecutables)) {
    const relativeRoot = manifest.tools?.[tool.id];
    if (!relativeRoot) continue;
    const toolRoot = path.join(bundleRoot, relativeRoot);
    for (const name of tool.names) {
      const executable = resolveBundledExecutable(toolRoot, name, platform);
      if (executable) {
        paths[key] = executable;
        break;
      }
    }
  }
  return paths;
}

/** Исполняемый файл внутри каталога инструмента: сначала `bin/`, затем корень. */
export function resolveBundledExecutable(toolRoot, name, platform = process.platform) {
  const fileName = platform === "win32" ? `${name}.exe` : name;
  for (const candidate of [path.join(toolRoot, "bin", fileName), path.join(toolRoot, fileName)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function bundleMigrationsDirectory(bundleRoot) {
  return path.join(bundleRoot, "db", "migrations");
}

export function bundleTitlesDirectory(bundleRoot) {
  return path.join(bundleRoot, "assets", "titles");
}
