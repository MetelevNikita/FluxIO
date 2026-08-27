import type { SceneNode, SceneTextSource } from "@gruber/contracts";
import type { SceneDrawInput, SceneSurface } from "./surface.js";

/* -------------------------------------------------------------------------- *
 * Содержимое текстового узла.
 *
 * Часы и отсчёт считаются от эфирного времени ролика, а не от системных часов:
 * рендерер следующего ролика запускается заранее, и по системным часам он
 * нарисовал бы будущее. Это единственная причина, по которой сюда вообще
 * приходит `airEpochSeconds`.
 * ------------------------------------------------------------------------- */

function pad(value: number): string {
  return String(Math.floor(Math.abs(value))).padStart(2, "0");
}

function clockParts(format: string, hours: number, minutes: number, seconds: number): string {
  if (format === "HH:MM") return `${pad(hours)}:${pad(minutes)}`;
  if (format === "MM:SS") return `${pad(minutes)}:${pad(seconds)}`;
  if (format === "SS") return pad(seconds);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Одна строка без переводов и лишних пробелов: бегущая строка едет в одну линию. */
export function singleLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function joinTickerItems(items: readonly string[], separator: string): string {
  const messages = items.map(singleLine).filter((item) => item.length > 0);
  if (messages.length === 0) return "";
  // Разделитель ставится и в конце: круг замыкается им же.
  return messages.length === 1 ? messages[0]! : `${messages.join(separator)}${separator}`;
}

export function resolveText(source: SceneTextSource, input: SceneDrawInput): string {
  if (source.kind === "static") return source.text;
  if (source.kind === "field") return input.fields[source.fieldKey] ?? "";
  if (source.kind === "ticker") return joinTickerItems(source.items, source.separator);

  if (source.kind === "clock") {
    const epoch = input.airEpochSeconds + input.timeSeconds + source.timezoneOffsetMinutes * 60;
    const day = Math.floor(epoch) % 86_400;
    const safe = day < 0 ? day + 86_400 : day;
    return clockParts(source.format, Math.floor(safe / 3600), Math.floor(safe / 60) % 60, safe % 60);
  }

  const total = source.source === "clip-remaining" ? input.clipRemainingSeconds : source.seconds;
  const left = Math.max(0, total - input.timeSeconds);
  return clockParts(source.format, Math.floor(left / 3600), Math.floor(left / 60) % 60, Math.floor(left) % 60);
}

/**
 * Самое широкое значение, которое поле примет за показ.
 *
 * У часов и отсчёта в кадре меняется каждая секунда, и плашка, посаженная по
 * текущему значению, дёргалась бы вместе с цифрами. Меряем по образцу: все
 * девятки той же длины.
 */
export function fitSampleText(source: SceneTextSource, input: SceneDrawInput): string {
  if (source.kind === "clock" || source.kind === "countdown") {
    return clockParts(source.format, 99, 59, 59);
  }
  return resolveText(source, input);
}

/** Строка шрифта в том виде, в каком её понимает Canvas 2D. */
export function fontSpec(sizePx: number, family: string): string {
  return `${Math.max(1, Math.round(sizePx))}px ${family || "sans-serif"}`;
}

/**
 * Ширина строки узла. Промер идёт тем же шрифтом и кеглем, которыми надпись
 * реально выйдет, — иначе привязанная плашка сядет по чужой ширине.
 */
export function measureNodeText(
  surface: SceneSurface,
  node: SceneNode,
  text: string,
  sizePx: number,
  family: string,
): number {
  const previous = surface.font;
  surface.font = fontSpec(sizePx, family);
  const width = surface.measureText(text).width +
    Math.max(0, text.length - 1) * node.textStyle.letterSpacing * sizePx;
  surface.font = previous;
  return width;
}
