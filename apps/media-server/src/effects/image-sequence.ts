import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Последовательность пронумерованных кадров как источник перехода.
 *
 * Отличий от видеофайла три, и все три меняют поведение эфира:
 *
 * • **частоты кадров в файлах нет.** У .mov её читает ffprobe, здесь задать её
 *   может только оператор — без неё длительность перехода не определена.
 * • **звука нет как класса.** Стингер со звуком из последовательности собрать
 *   нельзя, и это надо сказать до применения, а не ронять мультиплексор.
 * • **целостность не гарантирована.** Пропущенный номер — дыра в переходе;
 *   FFmpeg просто остановит чтение на первом отсутствующем кадре.
 *
 * Оператор выбирает любой кадр, а шаблон нумерации выводится из его имени.
 */

export interface SequenceNameParts {
  prefix: string;
  /** Ширина номера с ведущими нулями; 0 — ширина не фиксирована. */
  digits: number;
  suffix: string;
}

export interface ImageSequence {
  /** Шаблон для FFmpeg: абсолютный путь с printf-номером. */
  pattern: string;
  startNumber: number;
  frameCount: number;
  /** Отсутствующие номера внутри диапазона — дыры в переходе. */
  missing: number[];
  /** Конкретный первый кадр: по нему меряются ширина и высота. */
  firstFramePath: string;
}

/**
 * Разбирает имя кадра на постоянную и переменную части.
 *
 * Берётся последняя группа цифр перед расширением: у `cam2_frame_0042.png`
 * номером кадра является `0042`, а не `2` из имени камеры.
 */
export function deriveSequenceNameParts(fileName: string): SequenceNameParts | null {
  const extension = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - extension.length);
  const match = /^(.*?)(\d+)$/.exec(base);
  if (!match) return null;
  const [, prefix = "", number = ""] = match;
  return { prefix, digits: number.length, suffix: extension };
}

/** Номера кадров, имена которых подходят под тот же шаблон. */
export function collectSequenceNumbers(
  fileNames: readonly string[],
  parts: SequenceNameParts,
): number[] {
  const numbers: number[] = [];
  for (const name of fileNames) {
    if (!name.startsWith(parts.prefix) || !name.endsWith(parts.suffix)) continue;
    const middle = name.slice(parts.prefix.length, name.length - parts.suffix.length);
    if (!/^\d+$/.test(middle)) continue;
    numbers.push(Number(middle));
  }
  return numbers.sort((left, right) => left - right);
}

/**
 * Диапазон и дыры.
 *
 * Дыры считаются от первого кадра до последнего: последовательность из 1, 2 и 9
 * это не три кадра, а девять с шестью пропусками — FFmpeg остановится на
 * третьем, и переход оборвётся посреди стыка.
 */
export function describeSequenceNumbers(
  numbers: readonly number[],
): { startNumber: number; frameCount: number; missing: number[] } | null {
  if (numbers.length === 0) return null;
  const startNumber = numbers[0]!;
  const lastNumber = numbers[numbers.length - 1]!;
  const present = new Set(numbers);
  const missing: number[] = [];
  for (let value = startNumber; value <= lastNumber; value += 1) {
    if (!present.has(value)) missing.push(value);
  }
  return { startNumber, frameCount: lastNumber - startNumber + 1, missing };
}

/**
 * printf-шаблон для FFmpeg.
 *
 * Ширину номера фиксируем только тогда, когда она одинакова у всех кадров:
 * при разной ширине `%04d` не нашёл бы `frame_100.png`, а `%d` читает и то,
 * и другое.
 */
export function sequencePattern(parts: SequenceNameParts, fixedWidth: boolean): string {
  const number = fixedWidth && parts.digits > 1 ? `%0${parts.digits}d` : "%d";
  return `${parts.prefix}${number}${parts.suffix}`;
}

/** Максимум кадров в одном переходе: 30 секунд при 240 fps с запасом. */
const maximumSequenceFrames = 10_000;

/**
 * Собирает последовательность по одному выбранному кадру.
 *
 * Каталог читается целиком один раз: у перехода кадров немного, а второй проход
 * ради подсчёта дыр стоил бы столько же, сколько первый.
 */
export async function readImageSequence(framePath: string): Promise<ImageSequence> {
  if (!path.isAbsolute(framePath)) {
    throw new Error(`Sequence frame path must be absolute: ${framePath}`);
  }
  const info = await stat(framePath);
  if (!info.isFile()) throw new Error(`Sequence frame is not a file: ${framePath}`);

  const directory = path.dirname(framePath);
  const parts = deriveSequenceNameParts(path.basename(framePath));
  if (!parts) {
    throw new Error(
      `В имени «${path.basename(framePath)}» нет номера кадра. ` +
        "Последовательность должна быть пронумерована, например frame_0001.png.",
    );
  }

  const names = await readdir(directory);
  const numbers = collectSequenceNumbers(names, parts);
  const described = describeSequenceNumbers(numbers);
  if (!described || numbers.length < 2) {
    throw new Error(
      `Рядом с «${path.basename(framePath)}» нет других кадров той же нумерации: ` +
        "одиночная картинка переходом быть не может.",
    );
  }
  if (described.frameCount > maximumSequenceFrames) {
    throw new Error(
      `В последовательности ${described.frameCount} кадров — больше допустимых ${maximumSequenceFrames}.`,
    );
  }

  const widths = new Set(names
    .filter((name) => name.startsWith(parts.prefix) && name.endsWith(parts.suffix))
    .map((name) => name.slice(parts.prefix.length, name.length - parts.suffix.length))
    .filter((middle) => /^\d+$/.test(middle))
    .map((middle) => middle.length));

  const fixedWidth = widths.size === 1;
  const firstName = fixedWidth && parts.digits > 1
    ? `${parts.prefix}${String(described.startNumber).padStart(parts.digits, "0")}${parts.suffix}`
    : `${parts.prefix}${described.startNumber}${parts.suffix}`;
  return {
    pattern: path.join(directory, sequencePattern(parts, fixedWidth)),
    startNumber: described.startNumber,
    frameCount: described.frameCount,
    missing: described.missing.slice(0, 20),
    firstFramePath: path.join(directory, firstName),
  };
}
