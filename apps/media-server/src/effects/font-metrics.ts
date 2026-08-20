import { findTable } from "./system-fonts.js";

/* -------------------------------------------------------------------------- *
 * Ширина строки по метрикам самого шрифта
 *
 * Нужна плашке, которая обязана сесть по тексту: в Lottie нет раскладки, ширина
 * прямоугольника — обычное число в файле. Чтобы подогнать его под подставленный
 * оператором текст, ширину надо посчитать так же, как её посчитает рендерер, то
 * есть по таблицам `cmap` (символ → глиф) и `hmtx` (ширина глифа).
 *
 * Кернинг (`GPOS`) здесь не учитывается — его не применяет и thorvg, которым
 * FluxIO печёт Lottie в файл.
 * -------------------------------------------------------------------------- */

export interface FontMetrics {
  unitsPerEm: number;
  /** Высота прописной буквы в единицах em. */
  capHeight: number;
  advanceFor(codePoint: number): number;
}

export function readFontMetrics(buffer: Buffer): FontMetrics | null {
  const head = findTable(buffer, "head");
  const hhea = findTable(buffer, "hhea");
  const hmtx = findTable(buffer, "hmtx");
  const maxp = findTable(buffer, "maxp");
  const cmap = findTable(buffer, "cmap");
  if (!head || !hhea || !hmtx || !maxp || !cmap) return null;
  if (head.offset + 20 > buffer.length) return null;
  if (hhea.offset + 36 > buffer.length) return null;
  if (maxp.offset + 6 > buffer.length) return null;

  const unitsPerEm = buffer.readUInt16BE(head.offset + 18);
  const horizontalMetrics = buffer.readUInt16BE(hhea.offset + 34);
  const glyphCount = buffer.readUInt16BE(maxp.offset + 4);
  if (unitsPerEm <= 0 || horizontalMetrics === 0 || glyphCount === 0) return null;

  const subtable = bestCmapSubtable(buffer, cmap.offset);
  if (subtable == null) return null;

  return {
    unitsPerEm,
    capHeight: readCapHeight(buffer, unitsPerEm),
    advanceFor(codePoint: number) {
      const glyph = glyphFor(buffer, subtable, codePoint);
      return advanceOf(buffer, hmtx.offset, horizontalMetrics, glyphCount, glyph);
    },
  };
}

/**
 * Ширина строки в пикселях при заданном кегле. Многострочный текст меряется по
 * самой длинной строке — плашка обязана вместить её целиком.
 *
 * `trackingPerMille` — трекинг Lottie (`tr`), тысячные доли em, как в After Effects.
 */
export function measureTextWidth(
  metrics: FontMetrics,
  text: string,
  fontSize: number,
  trackingPerMille = 0,
): number {
  let widest = 0;
  for (const line of text.split("\n")) {
    const characters = [...line];
    let units = 0;
    for (const character of characters) units += metrics.advanceFor(character.codePointAt(0) ?? 0);
    const tracking = characters.length > 1
      ? ((characters.length - 1) * trackingPerMille * fontSize) / 1_000
      : 0;
    widest = Math.max(widest, (units / metrics.unitsPerEm) * fontSize + tracking);
  }
  return widest;
}

/** Прописная высота из `OS/2`; у старых шрифтов таблицы нет — берём 0.7 em. */
function readCapHeight(buffer: Buffer, unitsPerEm: number): number {
  const os2 = findTable(buffer, "OS/2");
  if (os2 && os2.length >= 90 && os2.offset + 90 <= buffer.length) {
    const version = buffer.readUInt16BE(os2.offset);
    const capHeight = version >= 2 ? buffer.readInt16BE(os2.offset + 88) : 0;
    if (capHeight > 0) return capHeight;
  }
  return Math.round(unitsPerEm * 0.7);
}

function advanceOf(
  buffer: Buffer,
  hmtxOffset: number,
  horizontalMetrics: number,
  glyphCount: number,
  glyph: number,
): number {
  // У моноширинного хвоста шрифта своей записи нет: последняя ширина в таблице
  // действует на все оставшиеся глифы.
  const index = Math.min(Math.max(0, glyph), Math.min(glyphCount, horizontalMetrics) - 1);
  const address = hmtxOffset + index * 4;
  if (address + 2 > buffer.length) return 0;
  return buffer.readUInt16BE(address);
}

/** Формат 12 предпочтительнее: он покрывает символы за пределами BMP. */
function bestCmapSubtable(buffer: Buffer, base: number): number | null {
  if (base + 4 > buffer.length) return null;
  const count = buffer.readUInt16BE(base + 2);
  let best: { score: number; offset: number } | null = null;
  for (let index = 0; index < count; index += 1) {
    const record = base + 4 + index * 8;
    if (record + 8 > buffer.length) break;
    const platform = buffer.readUInt16BE(record);
    const encoding = buffer.readUInt16BE(record + 2);
    const offset = base + buffer.readUInt32BE(record + 4);
    if (offset + 2 > buffer.length) continue;
    const format = buffer.readUInt16BE(offset);
    if (format !== 4 && format !== 12) continue;
    const score = platform === 3 && encoding === 10 ? 3 : platform === 3 ? 2 : 1;
    if (!best || score > best.score) best = { offset, score };
  }
  return best?.offset ?? null;
}

function glyphFor(buffer: Buffer, offset: number, codePoint: number): number {
  const format = buffer.readUInt16BE(offset);
  if (format === 4) return glyphFormat4(buffer, offset, codePoint);
  if (format === 12) return glyphFormat12(buffer, offset, codePoint);
  return 0;
}

function glyphFormat4(buffer: Buffer, offset: number, codePoint: number): number {
  if (codePoint > 0xffff || offset + 14 > buffer.length) return 0;
  const segments = buffer.readUInt16BE(offset + 6) / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segments * 2 + 2;
  const deltas = startCodes + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  if (rangeOffsets + segments * 2 > buffer.length) return 0;

  for (let segment = 0; segment < segments; segment += 1) {
    if (buffer.readUInt16BE(endCodes + segment * 2) < codePoint) continue;
    const start = buffer.readUInt16BE(startCodes + segment * 2);
    if (start > codePoint) return 0;
    const rangeOffset = buffer.readUInt16BE(rangeOffsets + segment * 2);
    if (rangeOffset === 0) {
      return (codePoint + buffer.readInt16BE(deltas + segment * 2)) & 0xffff;
    }
    const address = rangeOffsets + segment * 2 + rangeOffset + (codePoint - start) * 2;
    if (address + 2 > buffer.length) return 0;
    const glyph = buffer.readUInt16BE(address);
    return glyph === 0 ? 0 : (glyph + buffer.readInt16BE(deltas + segment * 2)) & 0xffff;
  }
  return 0;
}

function glyphFormat12(buffer: Buffer, offset: number, codePoint: number): number {
  if (offset + 16 > buffer.length) return 0;
  const groups = buffer.readUInt32BE(offset + 12);
  for (let index = 0; index < groups; index += 1) {
    const group = offset + 16 + index * 12;
    if (group + 12 > buffer.length) return 0;
    const start = buffer.readUInt32BE(group);
    if (codePoint < start) return 0;
    if (codePoint <= buffer.readUInt32BE(group + 4)) {
      return buffer.readUInt32BE(group + 8) + (codePoint - start);
    }
  }
  return 0;
}
