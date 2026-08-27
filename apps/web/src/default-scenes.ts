import {
  sceneNodeSchema,
  sceneTemplateSchema,
  sceneTrack,
  type BroadcastEffectKind,
  type SceneNode,
  type SceneTemplate,
  type SceneTrack,
} from "@gruber/contracts";

/* -------------------------------------------------------------------------- *
 * Сцены по умолчанию.
 *
 * Каждый вид эффекта получает готовое оформление при создании: до появления
 * редактора собрать сцену оператору негде, а эффект без оформления бесполезен.
 * Позже эти же сцены становятся тем, что редактор открывает на правку.
 *
 * Все величины — доли кадра: `x` и ширина от ширины, `y`, высота, кегли и
 * радиусы от высоты. Одна сцена одинаково ложится на 576, 1080 и 2160.
 * ------------------------------------------------------------------------- */

/** Плавный въезд слева: значение уходит за край и возвращается на место. */
function slideIn(value: number, from = -0.35): SceneTrack {
  return {
    value,
    inKeyframes: [
      { atSeconds: 0, value: from, easing: "out" },
      { atSeconds: 0.6, value, easing: "out" },
    ],
    outKeyframes: [
      { atSeconds: 0, value, easing: "in" },
      { atSeconds: 0.5, value: from, easing: "in" },
    ],
  };
}

function fadeIn(): SceneTrack {
  return {
    value: 1,
    inKeyframes: [
      { atSeconds: 0, value: 0, easing: "out" },
      { atSeconds: 0.5, value: 1, easing: "out" },
    ],
    outKeyframes: [
      { atSeconds: 0, value: 1, easing: "in" },
      { atSeconds: 0.4, value: 0, easing: "in" },
    ],
  };
}

function grow(): SceneTrack {
  return {
    value: 1,
    inKeyframes: [
      { atSeconds: 0, value: 0, easing: "out" },
      { atSeconds: 0.45, value: 1, easing: "out" },
    ],
    outKeyframes: [
      { atSeconds: 0, value: 1, easing: "in" },
      { atSeconds: 0.35, value: 0, easing: "in" },
    ],
  };
}

interface NodeShape {
  id: string;
  name: string;
  kind: SceneNode["kind"];
  x: SceneTrack;
  y: number;
  width: number;
  height: number;
  opacity?: SceneTrack;
  scale?: SceneTrack;
  anchorX?: number;
  anchorY?: number;
  extra?: Partial<SceneNode>;
}

function node(shape: NodeShape): SceneNode {
  return sceneNodeSchema.parse({
    id: shape.id,
    name: shape.name,
    kind: shape.kind,
    parentId: null,
    transform: {
      x: shape.x,
      y: sceneTrack(shape.y),
      width: sceneTrack(shape.width),
      height: sceneTrack(shape.height),
      anchorX: shape.anchorX ?? 0,
      anchorY: shape.anchorY ?? 0,
      scale: shape.scale ?? sceneTrack(1),
      rotationDegrees: sceneTrack(0),
      opacity: shape.opacity ?? sceneTrack(1),
    },
    ...shape.extra,
  });
}

const plateFill = {
  fill: "#1E2C38",
  fillOpacity: 0.92,
  cornerRadius: 0.018,
  strokeWidth: 0,
  strokeColor: "#FFFFFF",
};

/** Подложка, которая растёт по тексту, с мягкой тенью. */
function plate(textNodeId: string, y: number, height: number, x: SceneTrack): SceneNode {
  return node({
    id: "plate",
    name: "Плашка",
    kind: "rect",
    x,
    y,
    width: 0.3,
    height,
    extra: {
      fitToText: { nodeId: textNodeId, padX: 0.028, padY: 0.012, axis: "x", anchor: "grow" },
      shadow: { enabled: true, color: "#000000", opacity: 0.5, blur: 0.02, offsetY: 0.005 },
      rectStyle: plateFill,
    },
  });
}

function textNode(
  id: string,
  name: string,
  fieldKey: string,
  x: SceneTrack,
  y: number,
  size: number,
  color: string,
): SceneNode {
  return node({
    id,
    name,
    kind: "text",
    x,
    y,
    width: 0.3,
    height: size * 1.35,
    opacity: fadeIn(),
    extra: {
      text: { kind: "field", fieldKey },
      textStyle: {
        fontFilePath: null,
        fontFamily: "",
        size,
        lineHeight: 1.2,
        letterSpacing: 0,
        color,
        align: "left",
        strokeWidth: 0,
        strokeColor: "#000000",
      },
    },
  });
}

/** Ключи полей, которые эффект заполняет при применении. */
export const sceneFieldKeys = {
  title: "title",
  subtitle: "subtitle",
  clock: "clock",
  ticker: "ticker",
} as const;

function lowerThird(title: string, subtitleLabel: string): SceneTemplate {
  const x = slideIn(0.06);
  return sceneTemplateSchema.parse({
    id: `scene-${title}`,
    name: title,
    targets: ["hd"],
    director: { inSeconds: 0.6, outSeconds: 0.5 },
    fields: [
      { key: sceneFieldKeys.title, label: "Заголовок", type: "text", sample: "Заголовок" },
      { key: sceneFieldKeys.subtitle, label: subtitleLabel, type: "text", sample: "" },
    ],
    nodes: [
      plate(sceneFieldKeys.title, 0.775, 0.115, x),
      node({
        id: "marker",
        name: "Маркер",
        kind: "ellipse",
        x: sceneTrack(0.043),
        y: 0.8325,
        width: 0.024,
        height: 0.043,
        anchorX: 0.5,
        anchorY: 0.5,
        scale: grow(),
        extra: {
          rectStyle: {
            fill: "#E97F2C", fillOpacity: 1, cornerRadius: 0,
            strokeWidth: 0, strokeColor: "#FFFFFF",
          },
        },
      }),
      textNode(sceneFieldKeys.title, "Заголовок", sceneFieldKeys.title, x, 0.788, 0.046, "#FFFFFF"),
      textNode(
        sceneFieldKeys.subtitle, subtitleLabel, sceneFieldKeys.subtitle, x, 0.845, 0.028, "#B9C7D0",
      ),
    ],
  });
}

function clockScene(): SceneTemplate {
  const x = sceneTrack(0.86);
  return sceneTemplateSchema.parse({
    id: "scene-clock",
    name: "Часы",
    targets: ["hd"],
    director: { inSeconds: 0.4, outSeconds: 0.4 },
    fields: [],
    nodes: [
      node({
        id: "plate",
        name: "Плашка",
        kind: "rect",
        x,
        y: 0.06,
        width: 0.1,
        height: 0.07,
        opacity: fadeIn(),
        extra: {
          fitToText: { nodeId: "clock", padX: 0.022, padY: 0.01, axis: "x", anchor: "grow" },
          shadow: { enabled: true, color: "#000000", opacity: 0.45, blur: 0.016, offsetY: 0.004 },
          rectStyle: plateFill,
        },
      }),
      node({
        id: "clock",
        name: "Время",
        kind: "text",
        x,
        y: 0.072,
        width: 0.1,
        height: 0.05,
        opacity: fadeIn(),
        extra: {
          // Часы идут по эфирному времени ролика, а не по системным: рендерер
          // следующего ролика стартует заранее.
          text: { kind: "clock", format: "HH:MM:SS", timezoneOffsetMinutes: 0 },
          textStyle: {
            fontFilePath: null, fontFamily: "", size: 0.042, lineHeight: 1.2,
            letterSpacing: 0, color: "#FFFFFF", align: "left",
            strokeWidth: 0, strokeColor: "#000000",
          },
        },
      }),
    ],
  });
}

function tickerScene(): SceneTemplate {
  return sceneTemplateSchema.parse({
    id: "scene-ticker",
    name: "Бегущая строка",
    targets: ["hd"],
    director: { inSeconds: 0.5, outSeconds: 0.5 },
    fields: [{ key: sceneFieldKeys.ticker, label: "Сообщения", type: "text", sample: "" }],
    nodes: [
      node({
        id: "band",
        name: "Полоса",
        kind: "rect",
        x: sceneTrack(0),
        y: 0.88,
        width: 1,
        height: 0.08,
        opacity: fadeIn(),
        extra: {
          rectStyle: { ...plateFill, cornerRadius: 0, fillOpacity: 0.85 },
        },
      }),
      node({
        id: sceneFieldKeys.ticker,
        name: "Строка",
        kind: "text",
        x: sceneTrack(0.01),
        y: 0.89,
        width: 0.98,
        height: 0.06,
        opacity: fadeIn(),
        extra: {
          // Строка обрезается по своему прямоугольнику: за полосу она уехать
          // не может, и отдельный холст ради этого не нужен.
          text: { kind: "ticker", items: [], separator: "   •   ", speed: 0.06, direction: "left" },
          textStyle: {
            fontFilePath: null, fontFamily: "", size: 0.036, lineHeight: 1.2,
            letterSpacing: 0, color: "#FFFFFF", align: "left",
            strokeWidth: 0, strokeColor: "#000000",
          },
        },
      }),
    ],
  });
}

/**
 * Оформление, с которым вид эффекта создаётся.
 *
 * `null` — виду сцена не нужна: Animation in/out и Stinger оформлены готовым
 * alpha-медиа, внутри них подставлять нечего.
 */
export function defaultSceneTemplate(kind: BroadcastEffectKind): SceneTemplate | null {
  if (kind === "dynamic-title") return lowerThird("Динамическая плашка", "Подпись");
  if (kind === "next-program") return lowerThird("Следующая программа", "Время выхода");
  if (kind === "clock-countdown") return clockScene();
  if (kind === "ticker-crawl") return tickerScene();
  return null;
}

/** Виды, оформление которых живёт сценой, а не файлом. */
export function usesScene(kind: BroadcastEffectKind): boolean {
  return defaultSceneTemplate(kind) !== null;
}
