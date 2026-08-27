import {
  sceneNodeSchema,
  sceneTemplateSchema,
  sceneTrack,
  type SceneKeyframe,
  type SceneNode,
  type SceneTemplate,
  type SceneTrack,
} from "./scene.js";

/* -------------------------------------------------------------------------- *
 * Базовый набор титров, который едет вместе с программой.
 *
 * Новостная раскладка: чёрный, белый и один красный. Набор нужен не как
 * украшение — без него первый же канал начинает с пустого холста, а собранная
 * с нуля плашка почти всегда оказывается за зоной надписей или без привязки
 * подложки к тексту.
 *
 * Все координаты — доли кадра: `x` и ширина от ширины, `y`, высота и кегль от
 * высоты. Поэтому один и тот же набор работает в 4:3, 16:9, HD и UHD.
 * ------------------------------------------------------------------------- */

/** Палитра набора. Красный вещательный — не чистый #FF0000: он «звенит» на SD. */
const ink = "#0F1114";
const paper = "#FFFFFF";
const accent = "#C0392B";

/** Нижняя треть стоит внутри зоны надписей: за ней приёмник зрителя режет. */
const leftMargin = 0.06;

let sequence = 0;
function nodeId(kind: string): string {
  return `${kind}-${++sequence}`;
}

interface Box { x: number; y: number; w: number; h: number }

function rect(name: string, box: Box, fill: string, extra: Partial<SceneNode> = {}): SceneNode {
  return sceneNodeSchema.parse({
    id: nodeId("rect"),
    name,
    kind: "rect",
    transform: geometry(box),
    rectStyle: { fill, fillOpacity: 1 },
    ...extra,
  });
}

function text(
  name: string,
  box: Box,
  content: { kind: "static"; text: string } | { kind: "field"; fieldKey: string },
  style: { size: number; color: string; align?: "left" | "center" | "right"; spacing?: number },
  extra: Partial<SceneNode> = {},
): SceneNode {
  return sceneNodeSchema.parse({
    id: nodeId("text"),
    name,
    kind: "text",
    transform: geometry(box),
    text: content,
    textStyle: {
      size: style.size,
      color: style.color,
      align: style.align ?? "left",
      letterSpacing: style.spacing ?? 0,
    },
    ...extra,
  });
}

function geometry(box: Box): Record<string, SceneTrack | number> {
  return {
    x: sceneTrack(box.x),
    y: sceneTrack(box.y),
    width: sceneTrack(box.w),
    height: sceneTrack(box.h),
    anchorX: 0,
    anchorY: 0,
    scale: sceneTrack(1),
    rotationDegrees: sceneTrack(0),
    opacity: sceneTrack(1),
  };
}

/** Кривая «торможение»: элемент приезжает и мягко встаёт. */
const settle: SceneKeyframe["bezier"] = { x1: 0, y1: 0, x2: 0.35, y2: 1 };

/**
 * Выезд слева с проявлением.
 *
 * Выход начинается с того значения, на котором закончился вход: расхождение
 * здесь — это прыжок элемента в момент перехода к выходу.
 */
function slideIn(node: SceneNode, from: number, inSeconds: number, outSeconds: number): SceneNode {
  const x = node.transform.x.value;
  return {
    ...node,
    transform: {
      ...node.transform,
      x: {
        value: x,
        inKeyframes: [
          { atSeconds: 0, value: x - from, easing: "bezier", bezier: settle },
          { atSeconds: inSeconds, value: x, easing: "bezier", bezier: settle },
        ],
        outKeyframes: [
          { atSeconds: 0, value: x, easing: "in" },
          { atSeconds: outSeconds, value: x - from, easing: "in" },
        ],
      },
      opacity: {
        value: 1,
        inKeyframes: [
          { atSeconds: 0, value: 0, easing: "linear" },
          { atSeconds: inSeconds * 0.55, value: 1, easing: "linear" },
        ],
        outKeyframes: [
          { atSeconds: outSeconds * 0.45, value: 1, easing: "linear" },
          { atSeconds: outSeconds, value: 0, easing: "linear" },
        ],
      },
    },
  };
}

/** Раскрытие по ширине — самый «эфирный» вход для плашки. */
function wipe(node: SceneNode, inSeconds: number, outSeconds: number): SceneNode {
  const w = node.transform.width.value;
  return {
    ...node,
    transform: {
      ...node.transform,
      width: {
        value: w,
        inKeyframes: [
          { atSeconds: 0, value: 0, easing: "bezier", bezier: settle },
          { atSeconds: inSeconds, value: w, easing: "bezier", bezier: settle },
        ],
        outKeyframes: [
          { atSeconds: 0, value: w, easing: "in" },
          { atSeconds: outSeconds, value: 0, easing: "in" },
        ],
      },
    },
  };
}

/** Проявление на месте: для того, что не должно ездить. */
function fade(node: SceneNode, inSeconds: number, outSeconds: number, delay = 0): SceneNode {
  return {
    ...node,
    transform: {
      ...node.transform,
      opacity: {
        value: 1,
        inKeyframes: [
          { atSeconds: 0, value: 0, easing: "linear" },
          { atSeconds: delay, value: 0, easing: "linear" },
          { atSeconds: inSeconds, value: 1, easing: "out" },
        ],
        outKeyframes: [
          { atSeconds: 0, value: 1, easing: "linear" },
          { atSeconds: outSeconds * 0.7, value: 0, easing: "linear" },
        ],
      },
    },
  };
}

/** Подложка тянется по тексту: длинный заголовок не должен выезжать за неё. */
function boundTo(node: SceneNode, textNode: SceneNode, padX: number, padY = 0.012): SceneNode {
  return { ...node, fitToText: { nodeId: textNode.id, padX, padY, axis: "x", anchor: "grow" } };
}

/**
 * Узел едет за правым краем текста, сохраняя свою ширину.
 *
 * Так держится хвост плашки: без этого он отрывается от подложки, как только
 * заголовок оказывается длиннее или короче образца.
 */
function followsRightOf(node: SceneNode, source: SceneNode, padX: number): SceneNode {
  return { ...node, fitToText: { nodeId: source.id, padX, padY: 0.012, axis: "x", anchor: "follow" } };
}

/* --------------------------- 1 · Логотип и заголовок ---------------------- */

function logoHeadline(): SceneTemplate {
  const inS = 0.55;
  const outS = 0.45;

  const logoBox = rect("Место логотипа", { x: leftMargin, y: 0.735, w: 0.062, h: 0.105 }, ink);
  const logoText = text("Подпись логотипа", { x: leftMargin, y: 0.762, w: 0.062, h: 0.05 },
    { kind: "static", text: "ЛОГО" }, { size: 0.022, color: paper, align: "center", spacing: 0.004 });

  const locationTab = rect("Плашка города", { x: 0.122, y: 0.735, w: 0.11, h: 0.026 }, accent);
  const location = text("Город", { x: 0.13, y: 0.735, w: 0.1, h: 0.026 },
    { kind: "field", fieldKey: "location" }, { size: 0.016, color: paper, spacing: 0.006 });

  const bar = rect("Плашка", { x: 0.122, y: 0.761, w: 0.5, h: 0.079 }, paper);
  const headline = text("Заголовок", { x: 0.136, y: 0.766, w: 0.47, h: 0.046 },
    { kind: "field", fieldKey: "headline" }, { size: 0.042, color: ink });
  const second = text("Вторая строка", { x: 0.136, y: 0.808, w: 0.47, h: 0.026 },
    { kind: "field", fieldKey: "subtitle" }, { size: 0.021, color: ink, spacing: 0.004 });

  // Хвост стоит вплотную к плашке и уезжает вместе с ней.
  const tail = rect("Хвост", { x: 0.622, y: 0.761, w: 0.014, h: 0.079 }, accent);

  return sceneTemplateSchema.parse({
    id: "preset-logo-headline",
    name: "Логотип и заголовок",
    targets: ["hd"],
    director: { inSeconds: inS, outSeconds: outS },
    fields: [
      { key: "headline", label: "Заголовок", type: "text", sample: "ЗАГОЛОВОК СЮДА" },
      { key: "subtitle", label: "Вторая строка", type: "text", sample: "Вторая строка" },
      { key: "location", label: "Город", type: "text", sample: "МОСКВА" },
    ],
    nodes: [
      wipe(logoBox, inS, outS),
      fade(logoText, inS, outS, inS * 0.5),
      wipe(locationTab, inS, outS),
      fade(location, inS, outS, inS * 0.6),
      wipe(boundTo(bar, headline, 0.028), inS, outS),
      fade(headline, inS, outS, inS * 0.45),
      fade(second, inS, outS, inS * 0.6),
      wipe(followsRightOf(tail, bar, 0), inS, outS),
    ],
  });
}

/* --------------------------- 2 · Срочно, тёмная плашка -------------------- */

function breakingDark(): SceneTemplate {
  const inS = 0.5;
  const outS = 0.4;

  const tab = rect("Плашка «Срочно»", { x: leftMargin, y: 0.716, w: 0.152, h: 0.032 }, accent);
  const tabText = text("Срочно", { x: 0.07, y: 0.718, w: 0.14, h: 0.028 },
    { kind: "static", text: "• СРОЧНО" }, { size: 0.02, color: paper, spacing: 0.008 });

  const locationTab = rect("Плашка города", { x: 0.212, y: 0.716, w: 0.11, h: 0.026 }, paper);
  const location = text("Город", { x: 0.22, y: 0.716, w: 0.1, h: 0.026 },
    { kind: "field", fieldKey: "location" }, { size: 0.015, color: ink, spacing: 0.006 });

  const bar = rect("Плашка", { x: leftMargin, y: 0.748, w: 0.56, h: 0.082 }, ink);
  // Красная черта у текста — то, чем этот вариант отличается от остальных.
  const accentBar = rect("Отчёркивание", { x: 0.07, y: 0.758, w: 0.005, h: 0.062 }, accent);
  const headline = text("Заголовок", { x: 0.082, y: 0.762, w: 0.52, h: 0.055 },
    { kind: "field", fieldKey: "headline" }, { size: 0.05, color: paper });

  return sceneTemplateSchema.parse({
    id: "preset-breaking-dark",
    name: "Срочно · тёмная плашка",
    targets: ["hd"],
    director: { inSeconds: inS, outSeconds: outS },
    fields: [
      { key: "headline", label: "Заголовок", type: "text", sample: "ТЕКСТ СООБЩЕНИЯ" },
      { key: "location", label: "Город", type: "text", sample: "МОСКВА" },
    ],
    nodes: [
      wipe(tab, inS, outS),
      fade(tabText, inS, outS, inS * 0.5),
      wipe(locationTab, inS, outS),
      fade(location, inS, outS, inS * 0.6),
      wipe(boundTo(bar, headline, 0.03), inS, outS),
      fade(accentBar, inS, outS, inS * 0.4),
      slideIn(headline, 0.05, inS, outS),
    ],
  });
}

/* --------------------------- 3 · Срочно, блок слева ----------------------- */

function breakingBlock(): SceneTemplate {
  const inS = 0.5;
  const outS = 0.4;

  const block = rect("Блок «Срочно»", { x: leftMargin, y: 0.73, w: 0.088, h: 0.068 }, ink);
  const blockTop = text("Срочно", { x: 0.066, y: 0.738, w: 0.076, h: 0.026 },
    { kind: "static", text: "СРОЧНЫЕ" }, { size: 0.019, color: paper, align: "center" });
  const blockBottom = text("Новости", { x: 0.066, y: 0.762, w: 0.076, h: 0.026 },
    { kind: "static", text: "НОВОСТИ" }, { size: 0.019, color: paper, align: "center" });

  const bar = rect("Плашка", { x: 0.148, y: 0.73, w: 0.48, h: 0.068 }, paper);
  const headline = text("Заголовок", { x: 0.164, y: 0.738, w: 0.45, h: 0.05 },
    { kind: "field", fieldKey: "headline" }, { size: 0.045, color: ink });

  const liveTab = rect("Плашка «В эфире»", { x: leftMargin, y: 0.798, w: 0.082, h: 0.03 }, accent);
  const liveText = text("В эфире", { x: 0.066, y: 0.8, w: 0.07, h: 0.026 },
    { kind: "static", text: "• В ЭФИРЕ" }, { size: 0.017, color: paper, spacing: 0.004 });

  const secondBar = rect("Плашка второй строки", { x: 0.142, y: 0.798, w: 0.36, h: 0.03 }, ink);
  const second = text("Вторая строка", { x: 0.158, y: 0.8, w: 0.33, h: 0.026 },
    { kind: "field", fieldKey: "subtitle" }, { size: 0.021, color: paper });

  return sceneTemplateSchema.parse({
    id: "preset-breaking-block",
    name: "Срочно · блок слева",
    targets: ["hd"],
    director: { inSeconds: inS, outSeconds: outS },
    fields: [
      { key: "headline", label: "Заголовок", type: "text", sample: "ЗАГОЛОВОК СЮДА" },
      { key: "subtitle", label: "Вторая строка", type: "text", sample: "Вторая строка" },
    ],
    nodes: [
      wipe(block, inS, outS),
      fade(blockTop, inS, outS, inS * 0.5),
      fade(blockBottom, inS, outS, inS * 0.55),
      wipe(boundTo(bar, headline, 0.03), inS, outS),
      fade(headline, inS, outS, inS * 0.45),
      wipe(liveTab, inS * 1.2, outS),
      fade(liveText, inS * 1.2, outS, inS * 0.8),
      wipe(boundTo(secondBar, second, 0.026), inS * 1.2, outS),
      fade(second, inS * 1.2, outS, inS * 0.85),
    ],
  });
}

/* --------------------- 4 · Срочно, заголовок и подпись -------------------- */

function breakingTwoBars(): SceneTemplate {
  const inS = 0.5;
  const outS = 0.4;

  const tab = rect("Плашка «Срочно»", { x: leftMargin, y: 0.712, w: 0.138, h: 0.03 }, accent);
  const tabText = text("Срочно", { x: 0.07, y: 0.714, w: 0.126, h: 0.026 },
    { kind: "static", text: "СРОЧНЫЕ НОВОСТИ" }, { size: 0.017, color: paper, spacing: 0.004 });

  const bar = rect("Плашка", { x: leftMargin, y: 0.742, w: 0.54, h: 0.078 }, ink);
  const headline = text("Заголовок", { x: 0.074, y: 0.748, w: 0.5, h: 0.052 },
    { kind: "field", fieldKey: "headline" }, { size: 0.048, color: paper });

  const secondBar = rect("Плашка второй строки", { x: leftMargin, y: 0.82, w: 0.54, h: 0.032 }, paper);
  const second = text("Вторая строка", { x: 0.074, y: 0.822, w: 0.5, h: 0.028 },
    { kind: "field", fieldKey: "subtitle" }, { size: 0.021, color: ink });

  return sceneTemplateSchema.parse({
    id: "preset-breaking-two-bars",
    name: "Срочно · заголовок и подпись",
    targets: ["hd"],
    director: { inSeconds: inS, outSeconds: outS },
    fields: [
      { key: "headline", label: "Заголовок", type: "text", sample: "ЗАГОЛОВОК СЮДА" },
      { key: "subtitle", label: "Вторая строка", type: "text", sample: "Вторая строка" },
    ],
    nodes: [
      wipe(tab, inS, outS),
      fade(tabText, inS, outS, inS * 0.5),
      wipe(boundTo(bar, headline, 0.028), inS, outS),
      fade(headline, inS, outS, inS * 0.45),
      wipe(boundTo(secondBar, second, 0.028), inS * 1.15, outS),
      fade(second, inS * 1.15, outS, inS * 0.75),
    ],
  });
}

/* --------------------- 5 · Срочно, с подчёркиванием ----------------------- */

function breakingUnderline(): SceneTemplate {
  const inS = 0.5;
  const outS = 0.4;

  const tab = rect("Плашка «Срочно»", { x: leftMargin, y: 0.706, w: 0.138, h: 0.03 }, accent);
  const tabText = text("Срочно", { x: 0.07, y: 0.708, w: 0.126, h: 0.026 },
    { kind: "static", text: "СРОЧНЫЕ НОВОСТИ" }, { size: 0.017, color: paper, spacing: 0.004 });

  const bar = rect("Плашка", { x: leftMargin, y: 0.736, w: 0.54, h: 0.108 }, ink);
  const headline = text("Заголовок", { x: 0.074, y: 0.744, w: 0.5, h: 0.052 },
    { kind: "field", fieldKey: "headline" }, { size: 0.048, color: paper });

  // Тонкая линия: на 576 она обязана остаться видимой, поэтому её высота
  // задана долей высоты кадра, а не пикселями.
  const rule = rect("Линия", { x: 0.074, y: 0.8, w: 0.42, h: 0.0035 }, paper);
  const second = text("Вторая строка", { x: 0.074, y: 0.808, w: 0.5, h: 0.028 },
    { kind: "field", fieldKey: "subtitle" }, { size: 0.021, color: paper });

  return sceneTemplateSchema.parse({
    id: "preset-breaking-underline",
    name: "Срочно · с подчёркиванием",
    targets: ["hd"],
    director: { inSeconds: inS, outSeconds: outS },
    fields: [
      { key: "headline", label: "Заголовок", type: "text", sample: "ЗАГОЛОВОК СЮДА" },
      { key: "subtitle", label: "Вторая строка", type: "text", sample: "Вторая строка" },
    ],
    nodes: [
      wipe(tab, inS, outS),
      fade(tabText, inS, outS, inS * 0.5),
      wipe(boundTo(bar, headline, 0.028, 0.02), inS, outS),
      fade(headline, inS, outS, inS * 0.45),
      wipe(boundTo(rule, headline, 0.012), inS * 1.3, outS),
      fade(second, inS * 1.3, outS, inS * 0.8),
    ],
  });
}

/* ------------------------------ 6 · В эфире ------------------------------- */

function liveBadge(): SceneTemplate {
  const inS = 0.4;
  const outS = 0.35;

  // Угловая метка стоит справа сверху, внутри зоны надписей.
  const dot = sceneNodeSchema.parse({
    id: nodeId("ellipse"),
    name: "Точка",
    kind: "ellipse",
    transform: geometry({ x: 0.79, y: 0.072, w: 0.008, h: 0.014 }),
    rectStyle: { fill: accent, fillOpacity: 1 },
  });
  const live = text("В ЭФИРЕ", { x: 0.804, y: 0.062, w: 0.14, h: 0.06 },
    { kind: "static", text: "В ЭФИРЕ" }, { size: 0.055, color: paper, spacing: 0.006 });

  const locationTab = rect("Плашка города", { x: 0.804, y: 0.124, w: 0.1, h: 0.028 }, accent);
  const location = text("Город", { x: 0.804, y: 0.126, w: 0.1, h: 0.024 },
    { kind: "field", fieldKey: "location" }, { size: 0.018, color: paper, align: "center", spacing: 0.006 });

  return sceneTemplateSchema.parse({
    id: "preset-live-badge",
    name: "В эфире · угловая метка",
    targets: ["hd"],
    director: { inSeconds: inS, outSeconds: outS },
    fields: [
      { key: "location", label: "Город", type: "text", sample: "МОСКВА" },
    ],
    nodes: [
      fade(dot, inS, outS),
      fade(live, inS, outS, inS * 0.3),
      wipe(boundTo(locationTab, location, 0.02), inS, outS),
      fade(location, inS, outS, inS * 0.5),
    ],
  });
}

/* -------------------------------------------------------------------------- */

/**
 * Базовый набор целиком.
 *
 * Опознаватели узлов выдаются счётчиком, а не случайно: набор сравнивается в
 * тесте, и случайность сделала бы сравнение невозможным. При загрузке в проект
 * шаблон всё равно получает свежие опознаватели.
 */
export function builtInTitlePresets(): SceneTemplate[] {
  sequence = 0;
  return [
    logoHeadline(),
    breakingDark(),
    breakingBlock(),
    breakingTwoBars(),
    breakingUnderline(),
    liveBadge(),
  ];
}
