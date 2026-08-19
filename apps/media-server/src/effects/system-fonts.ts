import { readdir, readFile, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";

/**
 * Системные шрифты для динамических надписей.
 *
 * `drawtext` рисует конкретным файлом шрифта, поэтому оператору нужно выбрать
 * его из списка. Просто перечислить файлы мало: шрифт без кириллицы отрисует
 * бегущую строку пустыми прямоугольниками, и понять это можно будет только в
 * эфире. Поэтому здесь разбирается таблица `cmap` каждого файла — в список
 * попадает честный признак поддержки кириллицы, а имя берётся из таблицы `name`,
 * чтобы оператор видел «PT Sans», а не «PTS55F.ttf».
 */

export interface SystemFont {
  family: string;
  filePath: string;
  cyrillic: boolean;
}

const fontExtensions = new Set([".ttf", ".otf", ".ttc", ".otc"]);
const maximumFonts = 400;
const cyrillicProbe = 0x0410; // «А» — если её нет, кириллицы нет и подавно.

export function systemFontDirectories(): string[] {
  const home = homedir();
  if (platform() === "darwin") {
    return ["/System/Library/Fonts", "/Library/Fonts", path.join(home, "Library/Fonts")];
  }
  if (platform() === "win32") {
    const windows = process.env.WINDIR ?? "C:\\Windows";
    return [
      path.join(windows, "Fonts"),
      path.join(home, "AppData", "Local", "Microsoft", "Windows", "Fonts"),
    ];
  }
  return ["/usr/share/fonts", "/usr/local/share/fonts", path.join(home, ".local/share/fonts")];
}

export async function scanSystemFonts(
  directories = systemFontDirectories(),
): Promise<SystemFont[]> {
  const found = new Map<string, SystemFont>();
  for (const directory of directories) {
    for (const filePath of await collectFontFiles(directory)) {
      if (found.size >= maximumFonts) break;
      let buffer: Buffer;
      try {
        buffer = await readFile(filePath);
      } catch {
        continue;
      }
      const family = readFontFamily(buffer) ?? path.basename(filePath, path.extname(filePath));
      // Служебные шрифты системы начинаются с точки и оператору не нужны.
      if (!family || family.startsWith(".")) continue;
      // Одно семейство обычно лежит несколькими начертаниями. Оператору нужен
      // один пункт списка — и это должно быть обычное начертание: без замены
      // «Arial» означал бы файл Arial Bold Italic, просто первый по алфавиту.
      const existing = found.get(family);
      if (existing && styleRank(existing.filePath) <= styleRank(filePath)) continue;
      found.set(family, { cyrillic: supportsCyrillic(buffer), family, filePath });
    }
  }
  return [...found.values()].sort((left, right) => left.family.localeCompare(right.family));
}

const styleKeywords = [
  "bold", "italic", "oblique", "light", "thin", "black", "heavy",
  "medium", "semibold", "condensed", "narrow", "expanded",
];

/** Чем меньше, тем «обычнее» начертание. Обычное имя файла не несёт стилей. */
function styleRank(filePath: string): number {
  const name = path.basename(filePath).toLowerCase();
  return styleKeywords.filter((keyword) => name.includes(keyword)).length;
}

async function collectFontFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(current: string, depth: number): Promise<void> {
    if (depth > 3) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(entryPath, depth + 1);
      else if (fontExtensions.has(path.extname(entry.name).toLowerCase())) files.push(entryPath);
    }
  }
  try {
    if (!(await stat(directory)).isDirectory()) return [];
  } catch {
    return [];
  }
  await visit(directory, 0);
  return files.sort();
}

/* -------------------------------------------------------------------------- *
 * Разбор SFNT: ровно столько, сколько нужно для имени и охвата кириллицы
 * -------------------------------------------------------------------------- */

/** Смещение первого шрифта: у коллекций `.ttc` перед ним стоит заголовок ttcf. */
function firstFontOffset(buffer: Buffer): number | null {
  if (buffer.length < 12) return null;
  return buffer.toString("latin1", 0, 4) === "ttcf" ? buffer.readUInt32BE(12) : 0;
}

function findTable(buffer: Buffer, tag: string): { offset: number; length: number } | null {
  const base = firstFontOffset(buffer);
  if (base == null || base + 12 > buffer.length) return null;
  const tableCount = buffer.readUInt16BE(base + 4);
  for (let index = 0; index < tableCount; index += 1) {
    const record = base + 12 + index * 16;
    if (record + 16 > buffer.length) return null;
    if (buffer.toString("latin1", record, record + 4) === tag) {
      return { length: buffer.readUInt32BE(record + 12), offset: buffer.readUInt32BE(record + 8) };
    }
  }
  return null;
}

const englishLanguageIds = new Set([0x0409, 0x0000]);

/**
 * Имя семейства (nameID 1).
 *
 * У одного шрифта имя записано на нескольких языках. Брать первое попавшееся
 * нельзя: у части системных шрифтов первой идёт арабская или ивритская запись,
 * и оператор видел бы в списке нечитаемую строку. Поэтому английская запись
 * предпочитается, а всё остальное идёт запасным вариантом.
 */
export function readFontFamily(buffer: Buffer): string | null {
  const table = findTable(buffer, "name");
  if (!table || table.offset + 6 > buffer.length) return null;
  const count = buffer.readUInt16BE(table.offset + 2);
  const storage = table.offset + buffer.readUInt16BE(table.offset + 4);
  let fallback: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const record = table.offset + 6 + index * 12;
    if (record + 12 > buffer.length) break;
    const platformId = buffer.readUInt16BE(record);
    const languageId = buffer.readUInt16BE(record + 4);
    const nameId = buffer.readUInt16BE(record + 6);
    if (nameId !== 1) continue;
    const length = buffer.readUInt16BE(record + 8);
    const start = storage + buffer.readUInt16BE(record + 10);
    if (start + length > buffer.length) continue;
    const value = platformId === 3 || platformId === 0
      ? decodeUtf16BE(buffer, start, length)
      : buffer.toString("latin1", start, start + length);
    const family = value.replace(/\0/g, "").trim();
    if (!family) continue;
    if (platformId === 3 && englishLanguageIds.has(languageId)) return family;
    fallback ??= family;
  }
  return fallback;
}

/**
 * Строка таблицы `name` записана в UTF-16 **big-endian**.
 *
 * Переставлять символы после декодирования нельзя: `toString("utf16le")` уже
 * склеил байты попарно не в том порядке, и обмен символов местами даёт
 * бессмыслицу — вместо «.New York» получалось «一⸀眀攀夀 爀漀欀». Менять порядок
 * нужно у байтов и до декодирования.
 */
function decodeUtf16BE(buffer: Buffer, start: number, length: number): string {
  if (length <= 0 || length % 2 !== 0) return "";
  return Buffer.from(buffer.subarray(start, start + length)).swap16().toString("utf16le");
}

/** Есть ли в шрифте кириллица. Отсутствие «А» означает пустые прямоугольники в эфире. */
export function supportsCyrillic(buffer: Buffer): boolean {
  const table = findTable(buffer, "cmap");
  if (!table || table.offset + 4 > buffer.length) return false;
  const subtableCount = buffer.readUInt16BE(table.offset + 2);
  for (let index = 0; index < subtableCount; index += 1) {
    const record = table.offset + 4 + index * 8;
    if (record + 8 > buffer.length) break;
    const platformId = buffer.readUInt16BE(record);
    const encodingId = buffer.readUInt16BE(record + 2);
    const unicode = platformId === 0 ||
      (platformId === 3 && (encodingId === 1 || encodingId === 10));
    if (!unicode) continue;
    if (hasGlyph(buffer, table.offset + buffer.readUInt32BE(record + 4), cyrillicProbe)) {
      return true;
    }
  }
  return false;
}

function hasGlyph(buffer: Buffer, offset: number, codePoint: number): boolean {
  if (offset + 4 > buffer.length) return false;
  const format = buffer.readUInt16BE(offset);
  if (format === 4) return hasGlyphFormat4(buffer, offset, codePoint);
  if (format === 12) return hasGlyphFormat12(buffer, offset, codePoint);
  return false;
}

function hasGlyphFormat4(buffer: Buffer, offset: number, codePoint: number): boolean {
  if (codePoint > 0xffff || offset + 14 > buffer.length) return false;
  const segCount = buffer.readUInt16BE(offset + 6) / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  if (idRangeOffsets + segCount * 2 > buffer.length) return false;

  for (let segment = 0; segment < segCount; segment += 1) {
    if (buffer.readUInt16BE(endCodes + segment * 2) < codePoint) continue;
    if (buffer.readUInt16BE(startCodes + segment * 2) > codePoint) return false;
    const rangeOffset = buffer.readUInt16BE(idRangeOffsets + segment * 2);
    if (rangeOffset === 0) {
      return ((codePoint + buffer.readInt16BE(idDeltas + segment * 2)) & 0xffff) !== 0;
    }
    const start = buffer.readUInt16BE(startCodes + segment * 2);
    const glyphAddress = idRangeOffsets + segment * 2 + rangeOffset + (codePoint - start) * 2;
    if (glyphAddress + 2 > buffer.length) return false;
    return buffer.readUInt16BE(glyphAddress) !== 0;
  }
  return false;
}

function hasGlyphFormat12(buffer: Buffer, offset: number, codePoint: number): boolean {
  if (offset + 16 > buffer.length) return false;
  const groupCount = buffer.readUInt32BE(offset + 12);
  for (let index = 0; index < groupCount; index += 1) {
    const group = offset + 16 + index * 12;
    if (group + 12 > buffer.length) return false;
    const start = buffer.readUInt32BE(group);
    const end = buffer.readUInt32BE(group + 4);
    if (codePoint < start) return false;
    if (codePoint <= end) return buffer.readUInt32BE(group + 8) !== 0;
  }
  return false;
}
