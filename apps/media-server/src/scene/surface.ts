import { createCanvas, GlobalFonts, type Canvas } from "@napi-rs/canvas";
import {
  sceneRegion,
  sceneTiming,
  type SceneFormat,
  type SceneTemplate,
  type SceneTiming,
} from "@gruber/contracts";
import {
  drawScene,
  measureSceneText,
  type SceneDrawInput,
  type SceneSurface,
} from "@gruber/scene-renderer";

/* -------------------------------------------------------------------------- *
 * Эфирная поверхность сцены.
 *
 * Здесь только создание полотна, шрифты и выдача сырых пикселей. Рисует общая
 * функция из `@gruber/scene-renderer` — та же, что вызывает редактор. Своего
 * кода отрисовки у эфира нет и быть не должно: как только он появится,
 * предпросмотр начнёт расходиться с выходом.
 * ------------------------------------------------------------------------- */

/**
 * Зарегистрированные файлы шрифтов по пути.
 *
 * Регистрируем именно файл, а не семейство: подстановка семейства в этом
 * проекте дважды приводила к пустым прямоугольникам вместо кириллицы. Имя,
 * под которым шрифт становится доступен, выводим из пути, чтобы сцена могла
 * сослаться на него без знания о системе.
 */
const registered = new Map<string, string>();

export function registerSceneFont(filePath: string): string {
  const known = registered.get(filePath);
  if (known) return known;
  const family = `scene-${registered.size}`;
  if (!GlobalFonts.registerFromPath(filePath, family)) {
    throw new Error(`Не удалось загрузить шрифт: ${filePath}`);
  }
  registered.set(filePath, family);
  return family;
}

/**
 * Подставляет во все текстовые узлы зарегистрированное имя семейства.
 *
 * Шаблон хранит путь к файлу — он переживает перенос проекта лучше, чем имя
 * семейства, — а растеризатору нужно имя. Перевод делается один раз на шаблон.
 */
export function withRegisteredFonts(template: SceneTemplate): SceneTemplate {
  return {
    ...template,
    nodes: template.nodes.map((node) => {
      const path = node.textStyle.fontFilePath;
      if (node.kind !== "text" || !path) return node;
      return { ...node, textStyle: { ...node.textStyle, fontFamily: registerSceneFont(path) } };
    }),
  };
}

export interface SceneFrame {
  /** Сырые RGBA той области, которую действительно нарисовали. */
  pixels: Buffer;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Рисовальщик одного шаблона в одном формате.
 *
 * Полотно переиспользуется между кадрами: выделять его заново 50 раз в секунду
 * на 2160 — это мусор, который приходит собирать посреди эфира.
 */
export class SceneRenderer {
  readonly #template: SceneTemplate;
  readonly #format: SceneFormat;
  readonly #timing: SceneTiming;
  #canvas: Canvas | null = null;
  #canvasWidth = 0;
  #canvasHeight = 0;
  /** Отдельное крошечное полотно только для промера строк. */
  #ruler: Canvas | null = null;

  constructor(template: SceneTemplate, format: SceneFormat, durationSeconds: number) {
    this.#template = withRegisteredFonts(template);
    this.#format = format;
    this.#timing = sceneTiming(template.director, durationSeconds);
  }

  get timing(): SceneTiming {
    return this.#timing;
  }

  #surfaceFor(width: number, height: number): { canvas: Canvas; surface: SceneSurface } {
    if (!this.#canvas || this.#canvasWidth < width || this.#canvasHeight < height) {
      this.#canvas = createCanvas(width, height);
      this.#canvasWidth = width;
      this.#canvasHeight = height;
    }
    const context = this.#canvas.getContext("2d");
    context.clearRect(0, 0, this.#canvasWidth, this.#canvasHeight);
    // Канва Skia отвечает тому же подмножеству Canvas 2D, что и браузерная;
    // приведение нужно только чтобы не тянуть её типы в общий пакет.
    return { canvas: this.#canvas, surface: context as unknown as SceneSurface };
  }

  /**
   * Кадр номер `frame`. Время считается из номера, а не из системных часов:
   * рендерер следующего ролика запускается заранее и по часам нарисовал бы
   * будущее — тот же капкан, что у нынешних экранных часов.
   *
   * `null` означает «в этот момент рисовать нечего»: трубу занимать незачем.
   */
  render(frame: number, input: Omit<SceneDrawInput, "originX" | "originY" | "timeSeconds" | "frameWidth" | "frameHeight">): SceneFrame | null {
    const timeSeconds = frame / this.#format.drawRate;
    const drawInput: SceneDrawInput = {
      ...input,
      frameWidth: this.#format.width,
      frameHeight: this.#format.height,
      originX: 0,
      originY: 0,
      timeSeconds,
    };

    // Промер идёт до расчёта области: привязанная плашка растёт по тексту, и
    // область, посчитанная без промера, срезала бы длинную надпись по краю.
    if (!this.#ruler) this.#ruler = createCanvas(1, 1);
    const widths = measureSceneText(
      this.#ruler.getContext("2d") as unknown as SceneSurface,
      this.#template, this.#format, drawInput,
    );

    const region = sceneRegion(
      this.#template, this.#format, this.#timing, timeSeconds, widths,
    );
    if (!region || region.width <= 0 || region.height <= 0) return null;

    const { canvas, surface } = this.#surfaceFor(region.width, region.height);
    drawScene(
      surface, this.#template, this.#format, this.#timing,
      { ...drawInput, originX: region.x, originY: region.y },
      widths,
    );

    // Полотно может быть больше области — оно переиспользуется, — поэтому
    // отдаём ровно тот прямоугольник, который обещали координатами.
    const context = canvas.getContext("2d");
    const image = context.getImageData(0, 0, region.width, region.height);
    return {
      pixels: Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength),
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    };
  }
}
