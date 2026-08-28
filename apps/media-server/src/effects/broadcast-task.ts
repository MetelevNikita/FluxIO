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
const maximumFeedBytes = 4 * 1024 * 1024;
const feedTimeoutMs = 15_000;

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
 * • Строки, числа и boolean приводятся к тексту.
 * • Вложенные значения получают dotted key (`program.title`).
 * • Старое поле `name` остаётся совместимым идентификатором, но JSON Parser
 *   позволяет выбрать для сопоставления любой другой ключ.
 */
export function parseBroadcastTaskDocument(document: unknown): {
  records: Record<string, string>[];
  fields: { key: string; populatedCount: number; samples: string[] }[];
  entries: { name: string; values: Record<string, string> }[];
  warnings: string[];
} {
  const parsed = broadcastTaskFileSchema.safeParse(unwrapTaskDocument(document));
  if (!parsed.success) {
    throw new Error(
      "Task file must be one object or a non-empty array of no more than 10,000 objects",
    );
  }
  const warnings: string[] = [];
  const records: Record<string, string>[] = [];
  const entries = new Map<string, { name: string; values: Record<string, string> }>();
  for (const [index, raw] of parsed.data.entries()) {
    const record: Record<string, string> = {};
    flattenTaskValue(raw, "", record, warnings, index + 1);
    records.push(record);
    const name = record.name?.trim() ?? "";
    if (name) {
      const values = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "name"));
      if (entries.has(name)) {
        warnings.push(`"${name}" appears more than once in the task file; the last entry wins`);
      }
      entries.set(name, { name, values });
    }
  }
  if (entries.size === 0) {
    warnings.push('Поле "name" не найдено: выберите идентификатор ролика в JSON Parser');
  }
  return {
    records,
    fields: describeTaskFields(records),
    entries: [...entries.values()],
    warnings,
  };
}

/**
 * Снимает обёртку вида `{ "<любое имя>": [ … ] }`.
 *
 * Выгрузки эфирных систем почти всегда приходят обёрнутыми — именем блока,
 * рубрики или таблицы, — и имя это у каждой системы своё. Без снятия обёртки
 * весь файл считается **одной** записью с ключами `lower.0.title`, и совпасть
 * с именем ролика ей нечем: снаружи это выглядит как «JSON не подхватился».
 *
 * Имя ключа поэтому не проверяется вовсе. Проверяется однозначность: внутри
 * объекта должен быть **ровно один** непустой массив объектов — рядом с ним
 * может лежать метаинформация (версия, дата выгрузки), она не мешает. Два
 * списка сразу — уже догадка, а угаданное неверно тихо подменило бы данные
 * эфира, поэтому такой файл разбирается как раньше.
 */
function unwrapTaskDocument(document: unknown): unknown {
  if (!isObject(document)) return document;
  const lists = Object.values(document).filter(
    (value): value is Record<string, unknown>[] =>
      Array.isArray(value) && value.length > 0 && value.every(isObject),
  );
  return lists.length === 1 ? lists[0]! : document;
}

/** Объекты и массивы превращаются в ключи `program.title` и `items.0`. */
function flattenTaskValue(
  value: unknown,
  prefix: string,
  target: Record<string, string>,
  warnings: string[],
  row: number,
): void {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (!prefix) return;
    if (prefix.length > 256) {
      warnings.push(`Строка ${row}: слишком длинный ключ пропущен`);
      return;
    }
    target[prefix] = String(value);
    return;
  }
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flattenTaskValue(
      entry,
      prefix ? `${prefix}.${index}` : String(index),
      target,
      warnings,
      row,
    ));
    return;
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      flattenTaskValue(entry, prefix ? `${prefix}.${key}` : key, target, warnings, row);
    }
    return;
  }
  warnings.push(`Строка ${row}: значение "${prefix}" неподдерживаемого типа пропущено`);
}

function describeTaskFields(
  records: Record<string, string>[],
): { key: string; populatedCount: number; samples: string[] }[] {
  const values = new Map<string, string[]>();
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      const current = values.get(key) ?? [];
      current.push(value);
      values.set(key, current);
    }
  }
  return [...values]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, fieldValues]) => ({
      key,
      populatedCount: fieldValues.length,
      samples: [...new Set(fieldValues.map((value) => value.slice(0, 512)))].slice(0, 3),
    }));
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

/**
 * Заголовки новостной ленты для бегущей строки.
 *
 * Ленту качает сервер, а не интерфейс: у Electron-окна строгий CSP, и запрос к
 * произвольному домену оттуда не уйдёт. Схема ограничена http/https, размер и
 * время ответа урезаны — эфирная машина не должна вставать из-за чужого сайта.
 */
export async function readTickerFeed(url: string, limit: number): Promise<TickerSourceContent> {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Ticker feed URL must use http or https");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), feedTimeoutMs);
  let text: string;
  try {
    const response = await fetch(target, {
      headers: { accept: "application/rss+xml, application/xml, text/xml, */*" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Ticker feed responded with ${response.status} ${response.statusText}`);
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > maximumFeedBytes) {
      throw new Error(`Ticker feed is larger than ${maximumFeedBytes} bytes`);
    }
    text = new TextDecoder("utf-8").decode(body);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Ticker feed did not answer within ${feedTimeoutMs / 1_000} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return tickerSourceContentSchema.parse({
    filePath: target.toString(),
    ...parseTickerFeed(text, limit),
  });
}

/**
 * Заголовки из RSS 2.0 и Atom. Полноценный XML-разбор здесь не нужен и вреден:
 * лента может быть какой угодно, а нам требуются только `title` внутри записей.
 */
export function parseTickerFeed(
  xml: string,
  limit: number,
): { items: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const entries = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  if (entries.length === 0) {
    throw new Error("The feed has no <item> or <entry> elements");
  }
  const items: string[] = [];
  for (const entry of entries) {
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(entry)?.[1];
    const text = title ? decodeFeedText(title) : "";
    if (!text) {
      warnings.push("Запись ленты без заголовка пропущена");
      continue;
    }
    items.push(text);
    if (items.length >= limit) break;
  }
  if (items.length === 0) throw new Error("The feed has no usable headlines");
  return { items, warnings };
}

function decodeFeedText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
