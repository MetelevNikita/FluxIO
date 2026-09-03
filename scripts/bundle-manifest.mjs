import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readlink, stat } from "node:fs/promises";
import path from "node:path";

/* -------------------------------------------------------------------------- *
 * Описание офлайн-комплекта.
 *
 * Один и тот же модуль читают сборщик (на машине с интернетом) и мастер
 * установки (на машине без неё), поэтому здесь только Node без зависимостей:
 * `@gruber/contracts` собирается TypeScript-ом, а установщик работает **до**
 * любой сборки и обязан подняться на голом рантайме.
 *
 * Целостность считается покомпонентно, а не пофайлово: в комплекте десятки
 * тысяч файлов, и пофайловый список раздул бы манифест до мегабайтов, ничего
 * не добавив — при расхождении всё равно пересчитывается весь компонент.
 * ------------------------------------------------------------------------- */

export const bundleManifestVersion = 1;
export const bundleManifestFileName = "manifest.json";

/** Профили установки: рабочее место оператора и сервер без монитора. */
export const bundleProfiles = ["workstation", "server"];

/** Комплекты, которые выпускаются в 9.0.0. */
export const supportedBundleTargets = ["win-x64", "linux-x64", "macos-arm64"];

/**
 * Опознаватель платформы комплекта.
 *
 * Архитектура входит в него намеренно: нативная часть рантайма
 * (`@napi-rs/canvas`), Electron и весь медиастек собраны под конкретную пару,
 * и комплект arm64 на x64 не запустится.
 */
export function bundleTargetId(platform = process.platform, arch = process.arch) {
  const platformId = platform === "win32"
    ? "win"
    : platform === "darwin"
      ? "macos"
      : platform;
  return `${platformId}-${arch}`;
}

export function bundleDirectoryName(version, target) {
  return `FluxIO-${version}-${target}`;
}

/**
 * Почему комплект не подходит этой машине, или `null`, если подходит.
 *
 * Отдельная функция, а не бросок исключения: мастеру нужно объяснить оператору
 * причину человеческим языком до того, как он что-то запишет на диск.
 */
export function bundleTargetMismatch(manifest, target = bundleTargetId()) {
  if (manifest.target.id === target) return null;
  return `Комплект собран для ${manifest.target.id}, а машина — ${target}. ` +
    "Нативные части (Electron, растеризатор сцены, медиастек) между платформами " +
    "не переносятся: возьмите комплект своей платформы и архитектуры.";
}

/**
 * Проверяет форму манифеста.
 *
 * Ошибки здесь дорогие: комплект приезжает на машину без интернета, и
 * непонятный отказ означает поездку инженера. Поэтому каждое поле проверяется
 * отдельно и называется в сообщении.
 */
export function validateBundleManifest(value) {
  const manifest = requireObject(value, "manifest.json");
  const manifestVersion = manifest.manifestVersion;
  if (manifestVersion !== bundleManifestVersion) {
    throw new Error(
      `Версия описания комплекта ${String(manifestVersion)} не поддерживается ` +
        `(ожидается ${bundleManifestVersion}). Комплект собран другой версией FluxIO.`,
    );
  }
  requireString(manifest, "version", "manifest.version");
  const target = requireObject(manifest.target, "manifest.target");
  requireString(target, "id", "manifest.target.id");
  requireString(target, "platform", "manifest.target.platform");
  requireString(target, "arch", "manifest.target.arch");

  const profiles = Array.isArray(manifest.profiles) ? manifest.profiles : null;
  if (!profiles || profiles.length === 0) {
    throw new Error("manifest.profiles: комплект не объявляет ни одного профиля установки");
  }
  for (const profile of profiles) {
    if (!bundleProfiles.includes(profile)) {
      throw new Error(`manifest.profiles: неизвестный профиль «${String(profile)}»`);
    }
  }

  const components = Array.isArray(manifest.components) ? manifest.components : null;
  if (!components || components.length === 0) {
    throw new Error("manifest.components: комплект пуст");
  }
  for (const [index, component] of components.entries()) {
    const label = `manifest.components[${index}]`;
    const entry = requireObject(component, label);
    requireString(entry, "id", `${label}.id`);
    requireString(entry, "path", `${label}.path`);
    requireString(entry, "digest", `${label}.digest`);
    requireNumber(entry, "files", `${label}.files`);
    requireNumber(entry, "bytes", `${label}.bytes`);
  }

  return manifest;
}

/** Компонент по опознавателю или `null` — комплект мог собираться без инструментов. */
export function bundleComponent(manifest, id) {
  return manifest.components.find((component) => component.id === id) ?? null;
}

/**
 * Что изменилось между установленным комплектом и новым.
 *
 * Обновление перекладывает только изменившиеся компоненты: медиастек весит
 * сотни мегабайт и от версии к версии не меняется, а приложение — десяток.
 */
export function planBundleUpdate(installed, incoming) {
  const previous = new Map(
    (installed?.components ?? []).map((component) => [component.id, component]),
  );
  const changed = [];
  const unchanged = [];
  for (const component of incoming.components) {
    const before = previous.get(component.id);
    if (before && before.digest === component.digest) unchanged.push(component.id);
    else changed.push(component.id);
    previous.delete(component.id);
  }
  return { changed, removed: [...previous.keys()], unchanged };
}

/**
 * Отпечаток каталога: контрольная сумма по отсортированному списку
 * «путь, размер, сумма содержимого».
 *
 * Путь пишется через прямые слэши, а список сортируется по нему: иначе один и
 * тот же каталог давал бы разный отпечаток на Windows и на Linux, и проверка
 * целостности срабатывала бы вхолостую.
 */
export async function digestDirectory(directoryPath, onProgress) {
  const files = await listFilesRecursively(directoryPath);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const digest = createHash("sha256");
  let bytes = 0;
  for (const entry of files) {
    if (entry.link != null) {
      // Ссылка описывается целью: приложение macOS собрано из них, и
      // подменённая ссылка — это подменённый фреймворк.
      digest.update(`${entry.path}\0->\0${entry.link}\n`);
      continue;
    }
    const absolutePath = path.join(directoryPath, entry.path);
    const size = (await stat(absolutePath)).size;
    const sha256 = await digestFile(absolutePath);
    digest.update(`${entry.path}\0${size}\0${sha256}\n`);
    bytes += size;
    onProgress?.(bytes);
  }
  return { digest: `sha256:${digest.digest("hex")}`, files: files.length, bytes };
}

export function digestFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Все файлы каталога относительными путями через прямые слэши. */
export async function listFilesRecursively(directoryPath, prefix = "") {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(
        ...(await listFilesRecursively(path.join(directoryPath, entry.name), relativePath)),
      );
      continue;
    }
    // Ссылку разворачивать нельзя: у приложения macOS фреймворки собраны из
    // них, и копирование с разворачиванием превращает 319 МБ в 851 МБ полных
    // копий. Поэтому она описывается своей целью.
    if (entry.isSymbolicLink()) {
      files.push({ link: await readlink(path.join(directoryPath, entry.name)), path: relativePath });
      continue;
    }
    if (entry.isFile()) files.push({ link: null, path: relativePath });
  }
  return files;
}

export function formatBytes(bytes) {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} ГБ`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} МБ`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} КБ`;
  return `${bytes} Б`;
}

export function formatBundleSummary(manifest) {
  const lines = [
    `FluxIO ${manifest.version} · ${manifest.target.id} · профили: ${manifest.profiles.join(", ")}`,
  ];
  for (const component of manifest.components) {
    const version = component.version ? ` ${component.version}` : "";
    lines.push(
      `  ${component.id}${version}: ${component.files} файл(ов), ${formatBytes(component.bytes)}`,
    );
  }
  const bytes = manifest.components.reduce((total, component) => total + component.bytes, 0);
  lines.push(`  всего: ${formatBytes(bytes)}`);
  return lines.join("\n");
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: ожидается объект`);
  }
  return value;
}

function requireString(container, key, label) {
  const value = container[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label}: ожидается непустая строка`);
  }
  return value;
}

function requireNumber(container, key, label) {
  const value = container[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}: ожидается неотрицательное число`);
  }
  return value;
}
