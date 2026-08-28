/* -------------------------------------------------------------------------- *
 * Поверхность рисования.
 *
 * Здесь описано ровно то подмножество Canvas 2D, которым пользуется отрисовка
 * сцены. Смысл в том, что этому описанию отвечают обе среды: `canvas` браузера
 * в редакторе и Skia в эфирном процессе. Поэтому рисует их **одна функция**,
 * и предпросмотр не может разойтись с выходом.
 *
 * Никаких типов из DOM и никаких из Node: пакет не должен знать, где он
 * исполняется.
 * ------------------------------------------------------------------------- */

export interface TextMetricsLike {
  width: number;
}

/**
 * Градиент полотна.
 *
 * И у канвы браузера, и у `@napi-rs/canvas` он устроен одинаково: объект с
 * точками перехода, который кладётся в `fillStyle` вместо строки цвета.
 */
export interface SceneGradientHandle {
  addColorStop(offset: number, color: string): void;
}

export interface SceneSurface {
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SceneGradientHandle;
  createRadialGradient(
    x0: number, y0: number, r0: number, x1: number, y1: number, r1: number,
  ): SceneGradientHandle;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  scale(x: number, y: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  ellipse(
    x: number, y: number, radiusX: number, radiusY: number,
    rotation: number, start: number, end: number,
  ): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): TextMetricsLike;
  drawImage(image: unknown, x: number, y: number, width: number, height: number): void;
  /**
   * Произвольное преобразование. Нужно наклону: своего вызова у канвы для него
   * нет, и он выражается сдвигом по горизонтали от высоты.
   */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;

  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: string | SceneGradientHandle;
  strokeStyle: string;
  lineWidth: number;
  lineJoin: string;
  font: string;
  textBaseline: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  /** Фильтр канвы — им делается размытие. */
  filter: string;
}

/** Готовые растры, которые сцена не умеет доставать сама. */
export interface SceneImageSource {
  /** Что отдать в `drawImage`; природа зависит от среды. */
  image: unknown;
  width: number;
  height: number;
}

export interface SceneDrawInput {
  /** Кадр целиком — от него считаются все доли. */
  frameWidth: number;
  frameHeight: number;
  /**
   * Область, которую на самом деле рисуем. Полотно меньше кадра, а координаты
   * остаются кадровыми: разница снимается сдвигом начала координат.
   */
  originX: number;
  originY: number;
  /** Время от начала показа. Считается из номера кадра, не из системных часов. */
  timeSeconds: number;
  /** Значения полей шаблона по ключу. */
  fields: Readonly<Record<string, string>>;
  /** Растры для узлов-картинок по id узла. */
  images: Readonly<Record<string, SceneImageSource>>;
  /**
   * Абсолютное эфирное время первого кадра ролика. Нужно только часам: рендерер
   * следующего ролика стартует заранее, и по системным часам он нарисовал бы
   * будущее.
   */
  airEpochSeconds: number;
  /** Сколько осталось до конца ролика — для отсчёта «до конца». */
  clipRemainingSeconds: number;
}
