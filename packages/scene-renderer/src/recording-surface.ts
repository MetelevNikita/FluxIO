import type { SceneGradientHandle, SceneSurface, TextMetricsLike } from "./surface.js";

/* -------------------------------------------------------------------------- *
 * Поверхность, которая ничего не рисует, а записывает вызовы.
 *
 * Нужна тестам: проверить порядок наложения, геометрию и цвета можно точно и
 * без растеризатора, а значит без нативной зависимости и без эталонных
 * картинок, которые ломаются от версии Skia.
 *
 * Ширина строки считается по приближённой модели — важно не абсолютное число,
 * а то, что оно пропорционально длине и кеглю: привязанная плашка обязана
 * расти вместе с текстом.
 * ------------------------------------------------------------------------- */

export interface RecordedCall {
  op: string;
  args: number[];
  text?: string;
  style?: string;
  font?: string;
  alpha?: number;
}

/**
 * Записанный градиент: точки перехода видно тесту без растеризатора.
 *
 * Строковое представление нужно тому же тесту, что проверяет цвет заливки:
 * `fillStyle` у сплошного узла — строка, и сравнивать их удобнее одинаково.
 */
export class RecordedGradient implements SceneGradientHandle {
  readonly stops: { offset: number; color: string }[] = [];

  constructor(readonly kind: "linear" | "radial", readonly args: number[]) {}

  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }

  toString(): string {
    // Разделитель — `;`: в самом цвете `rgba(…)` есть и запятые, и пробелы, и
    // разбор записи по ним разваливал бы цвет на части.
    const stops = this.stops.map((stop) => `${stop.offset}:${stop.color}`).join(";");
    return `${this.kind}(${this.args.join(",")});${stops}`;
  }
}

/** Во сколько раз средняя буква уже кегля. Модель, а не метрика шрифта. */
const averageGlyphRatio = 0.52;

export class RecordingSurface implements SceneSurface {
  readonly calls: RecordedCall[] = [];

  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  filter = "none";
  fillStyle: string | SceneGradientHandle = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  lineJoin = "miter";
  font = "10px sans-serif";
  textBaseline = "alphabetic";
  shadowColor = "rgba(0,0,0,0)";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;

  #record(op: string, args: number[], extra: Partial<RecordedCall> = {}): void {
    this.calls.push({ op, args, ...extra });
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SceneGradientHandle {
    this.#record("createLinearGradient", [x0, y0, x1, y1]);
    return new RecordedGradient("linear", [x0, y0, x1, y1]);
  }

  createRadialGradient(
    x0: number, y0: number, r0: number, x1: number, y1: number, r1: number,
  ): SceneGradientHandle {
    this.#record("createRadialGradient", [x0, y0, r0, x1, y1, r1]);
    return new RecordedGradient("radial", [x0, y0, r0, x1, y1, r1]);
  }

  save(): void { this.#record("save", []); }
  restore(): void { this.#record("restore", []); }
  translate(x: number, y: number): void { this.#record("translate", [x, y]); }
  rotate(radians: number): void { this.#record("rotate", [radians]); }
  scale(x: number, y: number): void { this.#record("scale", [x, y]); }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.#record("transform", [a, b, c, d, e, f]);
  }
  clearRect(x: number, y: number, w: number, h: number): void { this.#record("clearRect", [x, y, w, h]); }
  fillRect(x: number, y: number, w: number, h: number): void { this.#record("fillRect", [x, y, w, h]); }
  beginPath(): void { this.#record("beginPath", []); }
  closePath(): void { this.#record("closePath", []); }
  moveTo(x: number, y: number): void { this.#record("moveTo", [x, y]); }
  lineTo(x: number, y: number): void { this.#record("lineTo", [x, y]); }
  arc(x: number, y: number, r: number, s: number, e: number): void { this.#record("arc", [x, y, r, s, e]); }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    this.#record("arcTo", [x1, y1, x2, y2, r]);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, s: number, e: number): void {
    this.#record("ellipse", [x, y, rx, ry, rot, s, e]);
  }
  rect(x: number, y: number, w: number, h: number): void { this.#record("rect", [x, y, w, h]); }
  clip(): void { this.#record("clip", []); }

  fill(): void {
    this.#record("fill", [], { style: String(this.fillStyle), alpha: this.globalAlpha });
  }
  stroke(): void {
    this.#record("stroke", [], { style: this.strokeStyle, alpha: this.globalAlpha });
  }
  fillText(text: string, x: number, y: number): void {
    this.#record("fillText", [x, y], { text, style: String(this.fillStyle), font: this.font, alpha: this.globalAlpha });
  }
  strokeText(text: string, x: number, y: number): void {
    this.#record("strokeText", [x, y], { text, style: this.strokeStyle, font: this.font });
  }
  drawImage(_image: unknown, x: number, y: number, w: number, h: number): void {
    this.#record("drawImage", [x, y, w, h]);
  }

  measureText(text: string): TextMetricsLike {
    const size = Number.parseFloat(this.font) || 10;
    return { width: text.length * size * averageGlyphRatio };
  }

  /** Все вызовы одной операции — тестам удобнее, чем фильтровать руками. */
  ops(op: string): RecordedCall[] {
    return this.calls.filter((call) => call.op === op);
  }
}
