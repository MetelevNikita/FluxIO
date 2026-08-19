import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  broadcastTaskFileContentSchema,
  broadcastTaskFileSchema,
  tickerSourceContentSchema,
  type BroadcastTaskFileContent,
  type TickerSourceContent,
} from "@gruber/contracts";

/**
 * Файлы данных для эфирных эффектов второго уровня: задания Animation_in/out и
 * Next_program, а также тексты бегущей строки. Разбор вынесен в чистые функции,
 * потому что правила сопоставления ключей — то, что чаще всего ломается у
 * оператора, и это должно проверяться тестом, а не запуском эфира.
 */

const maximumTaskBytes = 4 * 1024 * 1024;

export async function readBroadcastTaskFile(filePath: string): Promise<BroadcastTaskFileContent> {
  const resolvedPath = await readableFile(filePath, [".json"]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Invalid task JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return broadcastTaskFileContentSchema.parse({
    filePath: resolvedPath,
    ...parseBroadcastTaskDocument(parsed),
  });
}

/**
 * Приводит документ задания к списку записей `{ name, values }`.
 *
 * • `name` — служебный ключ, он в Lottie не передаётся.
 * • Значение поля обязано быть строкой: числа и объекты нельзя положить в
 *   текстовый слой, поэтому такой ключ отбрасывается с предупреждением.
 * • Ключи сопоставляются точно и с учётом регистра — `eng` и `ENG` разные.
 */
export function parseBroadcastTaskDocument(document: unknown): {
  entries: { name: string; values: Record<string, string> }[];
  warnings: string[];
} {
  const parsed = broadcastTaskFileSchema.safeParse(document);
  if (!parsed.success) {
    throw new Error(
      "Task file must be one object or an array of objects, each with a non-empty name",
    );
  }
  const warnings: string[] = [];
  const entries = new Map<string, { name: string; values: Record<string, string> }>();
  for (const raw of parsed.data) {
    const name = raw.name.trim();
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === "name") continue;
      if (typeof value === "string") {
        values[key] = value;
      } else {
        warnings.push(`"${name}": key "${key}" is ignored because its value is not a string`);
      }
    }
    if (entries.has(name)) {
      warnings.push(`"${name}" appears more than once in the task file; the last entry wins`);
    }
    entries.set(name, { name, values });
  }
  return { entries: [...entries.values()], warnings };
}

export async function readTickerSourceFile(filePath: string): Promise<TickerSourceContent> {
  const resolvedPath = await readableFile(filePath, [".json", ".txt"]);
  const text = await readFile(resolvedPath, "utf8");
  return tickerSourceContentSchema.parse({
    filePath: resolvedPath,
    ...parseTickerSourceDocument(text, path.extname(resolvedPath).toLowerCase()),
  });
}

/**
 * Тексты бегущей строки. `.txt` — одно сообщение на строку. `.json` — либо
 * массив строк, либо объект с ключом `items`, чтобы принимать выгрузки
 * новостных систем без переделки на стороне оператора.
 */
export function parseTickerSourceDocument(
  text: string,
  extension: string,
): { items: string[]; warnings: string[] } {
  const warnings: string[] = [];
  if (extension === ".txt") {
    return { items: cleanItems(text.split(/\r?\n/), warnings), warnings };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid ticker JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : isObject(parsed) && Array.isArray(parsed.items)
      ? parsed.items
      : null;
  if (!raw) {
    throw new Error('Ticker JSON must be an array of strings or an object with an "items" array');
  }
  return { items: cleanItems(raw, warnings), warnings };
}

function cleanItems(raw: unknown[], warnings: string[]): string[] {
  const items: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") {
      warnings.push("A non-string ticker message was skipped");
      continue;
    }
    const message = value.replace(/[\r\n\t]+/g, " ").trim();
    if (message) items.push(message);
    if (items.length >= 200) {
      warnings.push("Only the first 200 ticker messages are used");
      break;
    }
  }
  return items;
}

async function readableFile(filePath: string, extensions: string[]): Promise<string> {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`Task file path must be absolute: ${filePath}`);
  }
  if (!extensions.includes(path.extname(filePath).toLowerCase())) {
    throw new Error(`Task file must be one of ${extensions.join(", ")}: ${path.basename(filePath)}`);
  }
  const info = await stat(filePath);
  if (!info.isFile() || info.size <= 0 || info.size > maximumTaskBytes) {
    throw new Error(`Task file must be between 1 byte and ${maximumTaskBytes} bytes`);
  }
  return filePath;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
