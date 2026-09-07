import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const instanceRegistryFileName = "instances.json";

/**
 * Станционный конфиг: пути к инструментам, GRUBER_SECRET_KEY, GRUBER_HOST и
 * координаты PostgreSQL-сервера. Программы (`.env.program-N`) наследуют его при
 * создании. Первичная установка пишет только его — ни одной программы.
 */
export const sharedEnvFileName = ".env.shared";

export function defaultInstance(apiUrl = "http://127.0.0.1:4310", name = "Program 1") {
  return {
    id: "program-1",
    name: validateInstanceName(name),
    apiUrl: normalizeApiUrl(apiUrl),
    environmentFile: ".env",
    enabled: true,
  };
}

export function parseInstanceRegistry(value) {
  if (!value || typeof value !== "object" || value.version !== 1 || !Array.isArray(value.instances)) {
    throw new Error("Некорректный instances.json: ожидается version=1 и массив instances");
  }
  const ids = new Set();
  const ports = new Set();
  const instances = value.instances.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Некорректная запись программы");
    const id = String(entry.id ?? "");
    const name = String(entry.name ?? "").trim();
    const environmentFile = String(entry.environmentFile ?? "");
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) throw new Error(`Некорректный id программы: ${id}`);
    if (!name || name.length > 80) throw new Error(`Некорректное имя программы: ${name}`);
    if (!/^\.env(?:\.[a-z0-9-]+)?$/.test(environmentFile)) {
      throw new Error(`Некорректный env-файл программы ${id}: ${environmentFile}`);
    }
    const apiUrl = normalizeApiUrl(String(entry.apiUrl ?? ""));
    const port = new URL(apiUrl).port || (apiUrl.startsWith("https:") ? "443" : "80");
    if (ids.has(id)) throw new Error(`Повторяющийся id программы: ${id}`);
    if (ports.has(port)) throw new Error(`Повторяющийся API-порт программы: ${port}`);
    ids.add(id);
    ports.add(port);
    return { id, name, apiUrl, environmentFile, enabled: entry.enabled !== false };
  });
  return { version: 1, instances };
}

export async function readInstanceRegistry(rootPath, _fallbackApiUrl) {
  const filePath = path.join(rootPath, instanceRegistryFileName);
  // Нет файла — значит, программ ещё нет: пустой список, а не выдуманная
  // «program-1». Первую программу оператор создаёт из Control Center, как и
  // последующие.
  if (!existsSync(filePath)) return { version: 1, instances: [] };
  return parseInstanceRegistry(JSON.parse(await readFile(filePath, "utf8")));
}

export async function writeInstanceRegistry(rootPath, registry) {
  const parsed = parseInstanceRegistry(registry);
  const filePath = path.join(rootPath, instanceRegistryFileName);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
  return parsed;
}

export function withDefaultInstance(registry, apiUrl, name = "Program 1") {
  const parsed = parseInstanceRegistry(registry);
  const current = parsed.instances.find((entry) => entry.environmentFile === ".env");
  if (current) {
    current.apiUrl = normalizeApiUrl(apiUrl);
    current.name = validateInstanceName(name);
    return parsed;
  }
  parsed.instances.unshift(defaultInstance(apiUrl, name));
  return parseInstanceRegistry(parsed);
}

export function renameInstance(registry, id, name) {
  const parsed = parseInstanceRegistry(registry);
  const instance = parsed.instances.find((entry) => entry.id === id);
  if (!instance) throw new Error(`Программа не найдена: ${id}`);
  instance.name = validateInstanceName(name);
  return parsed;
}

function validateInstanceName(value) {
  const name = String(value).trim();
  if (!name || name.length > 80) throw new Error("Название должно содержать от 1 до 80 символов");
  return name;
}

export function publicInstances(registry) {
  return parseInstanceRegistry(registry).instances.map(({ id, name, apiUrl, enabled }) => ({
    id,
    name,
    apiUrl,
    enabled,
  }));
}

export function normalizeApiUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Неподдерживаемый протокол API: ${url.protocol}`);
  }
  return url.toString().replace(/\/$/, "");
}
