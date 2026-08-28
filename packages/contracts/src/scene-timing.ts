import type {
  SceneBezier,
  SceneTextAnimator,
  SceneEasing,
  SceneFormat,
  SceneKeyframe,
  SceneNode,
  SceneTemplate,
  SceneTrack,
} from "./scene.js";

/* -------------------------------------------------------------------------- *
 * Чистые функции сцены: раскладка режиссёра, значение свойства в момент t
 * и область отрисовки. Ничего не рисуют — их можно прогнать тестом без
 * растеризатора, и именно они держат совпадение редактора с эфиром.
 * ------------------------------------------------------------------------- */

/** Какой отрезок режиссёра играет в данный момент. */
export type SceneSegment = "in" | "hold" | "out";

export interface SceneTiming {
  /** Сколько на самом деле длится вход после укладки в заданную длительность. */
  inSeconds: number;
  /** Сколько длится удержание; может быть нулём. */
  holdSeconds: number;
  outSeconds: number;
  /** Пришлось ли сжать вход и выход, чтобы уложиться. */
  compressed: boolean;
}

/**
 * Укладывает вход, удержание и выход в заданную оператором длительность.
 *
 * Оператор задаёт только момент показа и длительность, а как титр появляется и
 * уходит — дело шаблона. Если длительности не хватает даже на вход с выходом,
 * они сжимаются пропорционально: оборвать анимацию на середине хуже, чем
 * проиграть её быстрее. Удержания в этом случае просто нет.
 */
export function sceneTiming(
  director: { inSeconds: number; outSeconds: number },
  durationSeconds: number,
): SceneTiming {
  const duration = Math.max(0, durationSeconds);
  const declared = director.inSeconds + director.outSeconds;
  if (declared <= 0) {
    return { inSeconds: 0, holdSeconds: duration, outSeconds: 0, compressed: false };
  }
  if (declared <= duration) {
    return {
      inSeconds: director.inSeconds,
      holdSeconds: duration - declared,
      outSeconds: director.outSeconds,
      compressed: false,
    };
  }
  const scale = duration / declared;
  return {
    inSeconds: director.inSeconds * scale,
    holdSeconds: 0,
    outSeconds: director.outSeconds * scale,
    compressed: true,
  };
}

/** Где мы внутри показа: отрезок и время от его начала. */
export function sceneSegmentAt(
  timing: SceneTiming,
  timeSeconds: number,
): { segment: SceneSegment; localSeconds: number } {
  const t = Math.max(0, timeSeconds);
  if (t < timing.inSeconds) return { segment: "in", localSeconds: t };
  const holdEnd = timing.inSeconds + timing.holdSeconds;
  if (t < holdEnd) return { segment: "hold", localSeconds: t - timing.inSeconds };
  return { segment: "out", localSeconds: t - holdEnd };
}

export function applyEasing(
  easing: SceneEasing,
  progress: number,
  bezier?: SceneBezier,
): number {
  const p = Math.min(1, Math.max(0, progress));
  if (easing === "linear") return p;
  if (easing === "in") return p * p * p;
  if (easing === "out") return 1 - Math.pow(1 - p, 3);
  if (easing === "bezier") return bezierEasing(bezier ?? defaultBezier, p);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

const defaultBezier: SceneBezier = { x1: 0.4, y1: 0, x2: 0.2, y2: 1 };

/**
 * Кубическая кривая Безье в единичном квадрате: та же математика, что у
 * `cubic-bezier()` в CSS.
 *
 * Кривая задана параметрически, а нужна как функция «время → значение»,
 * поэтому по X сначала решается уравнение относительно параметра. Ньютон
 * сходится за несколько шагов, но на плоских участках производная уходит в
 * ноль — там он расходится, и подстраховкой идёт деление отрезка пополам.
 */
export function bezierEasing(curve: SceneBezier, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const t = solveBezierParameter(curve.x1, curve.x2, x);
  return bezierAt(curve.y1, curve.y2, t);
}

/** Значение кубической кривой с концами в 0 и 1 при параметре `t`. */
function bezierAt(a: number, b: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
}

function bezierSlope(a: number, b: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
}

function solveBezierParameter(x1: number, x2: number, x: number): number {
  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const error = bezierAt(x1, x2, t) - x;
    if (Math.abs(error) < 1e-6) return t;
    const slope = bezierSlope(x1, x2, t);
    // Плоский участок: производная около нуля, шаг Ньютона улетает.
    if (Math.abs(slope) < 1e-6) break;
    t -= error / slope;
  }
  let low = 0;
  let high = 1;
  t = x;
  for (let i = 0; i < 24; i += 1) {
    const value = bezierAt(x1, x2, t);
    if (Math.abs(value - x) < 1e-6) return t;
    if (value > x) high = t; else low = t;
    t = (low + high) / 2;
  }
  return t;
}

/**
 * Значение дорожки ключей в момент `localSeconds`.
 *
 * Сглаживание берётся у ключа, **к которому** идём: так дизайнер задаёт характер
 * прихода в точку, а не ухода из неё — привычнее и совпадает с тем, как это
 * устроено в анимационных пакетах.
 */
export function keyframeValueAt(
  base: number,
  keyframes: readonly SceneKeyframe[],
  localSeconds: number,
): number {
  if (keyframes.length === 0) return base;
  const sorted = [...keyframes].sort((left, right) => left.atSeconds - right.atSeconds);

  // Последний ключ, который уже прошёл. Именно последний, а не первый
  // подходящий: если несколько ключей стоят в одной точке, дизайнер имел в виду
  // скачок к последнему из них.
  let passed = -1;
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index]!.atSeconds > localSeconds) break;
    passed = index;
  }

  if (passed < 0) return sorted[0]!.value;
  const from = sorted[passed]!;
  if (passed === sorted.length - 1) return from.value;

  const to = sorted[passed + 1]!;
  const span = to.atSeconds - from.atSeconds;
  if (span <= 0) return to.value;
  // Кривая берётся у **следующего** ключа: она описывает путь к нему.
  const eased = applyEasing(to.easing, (localSeconds - from.atSeconds) / span, to.bezier);
  return from.value + (to.value - from.value) * eased;
}

/**
 * Значение свойства в момент показа.
 *
 * На удержании дорожки молчат: держится то, чем закончился вход. Иначе
 * растянутое удержание пришлось бы чем-то заполнять, и длительность показа
 * начала бы менять картинку.
 */
export function trackValueAt(
  track: SceneTrack,
  timing: SceneTiming,
  timeSeconds: number,
): number {
  const { segment, localSeconds } = sceneSegmentAt(timing, timeSeconds);
  if (segment === "in") return keyframeValueAt(track.value, track.inKeyframes, localSeconds);
  if (segment === "out") {
    return keyframeValueAt(endOfIn(track), track.outKeyframes, localSeconds);
  }
  return endOfIn(track);
}

/** Чем закончился вход — оно же значение на удержании. */
function endOfIn(track: SceneTrack): number {
  const last = track.inKeyframes[track.inKeyframes.length - 1];
  return last ? last.value : track.value;
}

/* ------------------------------ раскладка -------------------------------- */

export interface ResolvedNodeBox {
  nodeId: string;
  /** Пиксели кадра, уже с учётом поправок на раскладочную цель. */
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  hidden: boolean;
}

/**
 * Минимальная толщина в пикселях.
 *
 * 0,1 % высоты на 576 — это полпикселя, то есть мутная линия вместо чёткой.
 * Всё, что тоньше пикселя, прижимается к пикселю.
 */
export function atLeastOnePixel(value: number): number {
  return value > 0 && value < 1 ? 1 : value;
}

/**
 * Доля высоты кадра в пикселях. Кегли, толщины и радиусы считаются только так —
 * от высоты, — иначе при смене соотношения сторон круг перестал бы быть кругом.
 */
export function fromHeight(share: number, format: SceneFormat): number {
  return share * format.height;
}

/**
 * Прямоугольник узла в пикселях кадра на момент `timeSeconds`.
 *
 * `textWidths` приходит снаружи: измерить строку без шрифта нельзя, а тянуть
 * растеризатор в чистую функцию незачем. Редактор и эфирный процесс передают
 * сюда то, что намерили сами, — и получают одинаковую геометрию.
 */
export function resolveNodeBox(
  node: SceneNode,
  template: SceneTemplate,
  format: SceneFormat,
  timing: SceneTiming,
  timeSeconds: number,
  textWidths: Readonly<Record<string, number>> = {},
  /** Глубина цепочки привязок: защита от кольца «A следует за B, B за A». */
  depth = 0,
): ResolvedNodeBox {
  const override = node.overrides[format.layout];
  const pick = (fixed: number | null | undefined, animated: number) =>
    fixed == null ? animated : fixed;

  let width = pick(override?.width, trackValueAt(node.transform.width, timing, timeSeconds)) *
    format.width;
  let height = pick(override?.height, trackValueAt(node.transform.height, timing, timeSeconds)) *
    format.height;

  // Группа берёт размер от узла-подложки: без собственных границ контейнер
  // нечем резать, и раскрытие пряталось бы за краем кадра, а не плашки.
  if (node.fitToNodeId && depth < 4) {
    const source = template.nodes.find((entry) => entry.id === node.fitToNodeId);
    if (source) {
      const sourceBox = resolveNodeBox(
        source, template, format, timing, timeSeconds, textWidths, depth + 1,
      );
      return {
        nodeId: node.id,
        x: sourceBox.x,
        y: sourceBox.y,
        width: sourceBox.width,
        height: sourceBox.height,
        opacity: trackValueAt(node.transform.opacity, timing, timeSeconds),
        hidden: override?.hidden === true,
      };
    }
  }

  // Привязка к тексту — то, ради чего сейчас живёт соглашение `fit:`.
  let followOffset = 0;
  if (node.fitToText) {
    const source = template.nodes.find((entry) => entry.id === node.fitToText?.nodeId);
    const padX = fromHeight(node.fitToText.padX, format) * 2;
    const padY = fromHeight(node.fitToText.padY, format) * 2;

    if (node.fitToText.anchor === "follow") {
      // Узел встаёт вплотную к правому краю источника, сохраняя свою ширину:
      // так держится хвост плашки. Источником может быть и сама подложка —
      // тогда хвост примыкает к ней, а не к тексту внутри неё, и не
      // отрывается на величину её же отступа.
      //
      // Промер здесь не нужен и не проверяется: источник может быть не
      // текстовым, и требование промера отключало бы привязку целиком.
      if (source && depth < 4) {
        const sourceBox = resolveNodeBox(
          source, template, format, timing, timeSeconds, textWidths, depth + 1,
        );
        followOffset = sourceBox.x + sourceBox.width + padX -
          pick(override?.x, trackValueAt(node.transform.x, timing, timeSeconds)) * format.width;
      }
    } else {
      const measured = textWidths[node.fitToText.nodeId];
      if (measured != null) {
        if (node.fitToText.axis !== "y") width = measured + padX;
        if (node.fitToText.axis !== "x" && source) {
          const size = pick(
            source.overrides[format.layout]?.fontSize,
            source.textStyle.size,
          );
          height = fromHeight(size, format) * source.textStyle.lineHeight + padY;
        }
      }
    }
  }

  const scale = trackValueAt(node.transform.scale, timing, timeSeconds);
  width *= scale;
  height *= scale;

  const x = pick(override?.x, trackValueAt(node.transform.x, timing, timeSeconds)) * format.width -
    width * node.transform.anchorX + followOffset;
  const y = pick(override?.y, trackValueAt(node.transform.y, timing, timeSeconds)) * format.height -
    height * node.transform.anchorY;

  // Группа складывается с ребёнком: её сдвиг и прозрачность действуют на всех
  // детей сразу. Ради этого группа и нужна — чтобы плашка с текстом и маркером
  // ехала как одно целое, а не тремя одинаковыми наборами ключей, которые
  // рано или поздно разъедутся.
  let opacity = trackValueAt(node.transform.opacity, timing, timeSeconds);
  let x2 = x;
  let y2 = y;
  let parentId = node.parentId;
  for (let step = 0; parentId && step < 8; step += 1) {
    const parent: SceneNode | undefined = template.nodes.find((entry) => entry.id === parentId);
    if (!parent) break;
    const parentOverride = parent.overrides[format.layout];
    x2 += pick(parentOverride?.x, trackValueAt(parent.transform.x, timing, timeSeconds)) * format.width;
    y2 += pick(parentOverride?.y, trackValueAt(parent.transform.y, timing, timeSeconds)) * format.height;
    opacity *= trackValueAt(parent.transform.opacity, timing, timeSeconds);
    if (parentOverride?.hidden === true) opacity = 0;
    parentId = parent.parentId;
  }

  return {
    nodeId: node.id,
    x: x2,
    y: y2,
    width,
    height,
    opacity,
    hidden: override?.hidden === true,
  };
}

export interface SceneRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Область, которую достаточно нарисовать и передать эфиру.
 *
 * Разведка Ф0 показала: полный кадр 2160 не проходит через трубу в реальном
 * времени — 39 мс из 40 уходит на перекладывание пикселей ещё до кодировщика, —
 * а полоса под титром проходит с трёхкратным запасом. Поэтому область считается
 * всегда, а не когда-нибудь потом.
 *
 * Границы расширяются на размытие тени и прижимаются к кадру. `null` означает
 * «рисовать нечего»: ни одного видимого узла в этот момент нет.
 */
export function sceneRegion(
  template: SceneTemplate,
  format: SceneFormat,
  timing: SceneTiming,
  timeSeconds: number,
  textWidths: Readonly<Record<string, number>> = {},
): SceneRegion | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const node of template.nodes) {
    if (node.kind === "group") continue;
    const box = resolveNodeBox(node, template, format, timing, timeSeconds, textWidths);
    if (box.hidden || box.opacity <= 0 || box.width <= 0 || box.height <= 0) continue;
    // Тень выходит за прямоугольник узла и обязана попасть в область, иначе
    // её срежет по краю полосы.
    const spread = node.shadow.enabled ? fromHeight(node.shadow.blur, format) * 1.5 : 0;
    const shift = node.shadow.enabled ? fromHeight(node.shadow.offsetY, format) : 0;
    left = Math.min(left, box.x - spread);
    top = Math.min(top, box.y - spread + Math.min(0, shift));
    right = Math.max(right, box.x + box.width + spread);
    bottom = Math.max(bottom, box.y + box.height + spread + Math.max(0, shift));
  }

  if (!Number.isFinite(left) || right <= left || bottom <= top) return null;

  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  return {
    x,
    y,
    width: Math.min(format.width - x, Math.ceil(right) - x),
    height: Math.min(format.height - y, Math.ceil(bottom) - y),
  };
}

/**
 * Во сколько раз область дешевле полного кадра. Нужна и в замерах, и в
 * редакторе: дизайнер должен видеть, во что обходится титр на весь экран.
 */
export function regionSavings(region: SceneRegion | null, format: SceneFormat): number {
  if (!region) return Number.POSITIVE_INFINITY;
  const area = region.width * region.height;
  return area > 0 ? (format.width * format.height) / area : Number.POSITIVE_INFINITY;
}

/**
 * Область на весь показ: объединение областей всех кадров.
 *
 * Область одного кадра меняется — плашка выезжает, растёт по тексту, круг
 * масштабируется, — а наложение в FFmpeg принимает **одно** смещение на весь
 * вход. Двигать его покадрово нечем, поэтому полотно берётся с запасом на всю
 * анимацию, а смещение остаётся постоянным.
 *
 * Выигрыш от этого не пропадает: нижняя треть занимает полосу, а не экран,
 * каким бы ни был её выезд.
 *
 * `textWidths` считается по образцу поля, а не по текущему значению, поэтому
 * от кадра не зависит и передаётся один раз.
 */
export function sceneShowRegion(
  template: SceneTemplate,
  format: SceneFormat,
  timing: SceneTiming,
  textWidths: Readonly<Record<string, number>> = {},
  /** Сколько моментов опросить. Больше — точнее, но дороже; хватает частоты кадров. */
  samples = 64,
): SceneRegion | null {
  const duration = timing.inSeconds + timing.holdSeconds + timing.outSeconds;
  const steps = Math.max(2, Math.min(512, Math.round(samples)));

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  // Границы отрезков опрашиваются обязательно: именно там анимация
  // разворачивается, и пропустить их — значит срезать край выезда.
  const moments = new Set<number>([
    0,
    timing.inSeconds,
    timing.inSeconds + timing.holdSeconds,
    Math.max(0, duration - 1e-6),
  ]);
  for (let step = 0; step <= steps; step += 1) moments.add((duration * step) / steps);

  for (const moment of moments) {
    const region = sceneRegion(template, format, timing, moment, textWidths);
    if (!region) continue;
    left = Math.min(left, region.x);
    top = Math.min(top, region.y);
    right = Math.max(right, region.x + region.width);
    bottom = Math.max(bottom, region.y + region.height);
  }

  if (!Number.isFinite(left) || right <= left || bottom <= top) return null;
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  return {
    x,
    y,
    width: Math.min(format.width - x, Math.ceil(right) - x),
    height: Math.min(format.height - y, Math.ceil(bottom) - y),
  };
}

/* -------------------------------------------------------------------------- *
 * Маска раскрытия.
 * ------------------------------------------------------------------------- */

/**
 * Прямоугольник, которым узел обрезан в этот момент.
 *
 * `null` — обрезать нечего: узел виден целиком, и лишний `clip()` в графе
 * отрисовки ни к чему.
 *
 * Раскрытие идёт **от точки среза**: при `originX = 0` маска растёт слева
 * направо, при `1` — справа налево, при `0.5` — из середины в обе стороны.
 * Точка среза по умолчанию стоит там же, где привязка узла, и едет вместе с
 * ней: дизайнер выбрал точку отсчёта, и появление обязано идти оттуда же.
 *
 * `revealAxis` решает, чем маска открывается. «Из точки» открывает обе стороны
 * сразу — так узел действительно выезжает из своей точки. «По ширине»
 * оставляет высоту целой: полоса плашки уезжает вбок во всю высоту, и это
 * по-прежнему нужно чаще всего остального.
 *
 * Это обрезка готовой картинки, а не изменение размера: анимировать ширину у
 * текста нельзя, буквы поедут и сожмутся.
 */
export function revealClip(
  node: SceneNode,
  box: { x: number; y: number; width: number; height: number },
  timing: SceneTiming,
  timeSeconds: number,
): { x: number; y: number; width: number; height: number } | null {
  const amount = Math.min(1, Math.max(0, trackValueAt(node.transform.reveal, timing, timeSeconds)));
  if (amount >= 1) return null;
  const axis = node.transform.revealAxis;
  const width = axis === "y" ? box.width : box.width * amount;
  const height = axis === "x" ? box.height : box.height * amount;
  return {
    x: box.x + (box.width - width) * node.transform.revealOriginX,
    y: box.y + (box.height - height) * node.transform.revealOriginY,
    width,
    height,
  };
}

/**
 * Обрезка, которую накладывают контейнеры-предки узла.
 *
 * Группа с `clipsChildren` режет детей по своим границам — с учётом своей же
 * маски раскрытия. Ради этого группа и становится контейнером: «спрятать
 * содержимое за краем плашки» иначе выразить нечем.
 *
 * `null` — резать нечего.
 */
export function containerClip(
  node: SceneNode,
  template: SceneTemplate,
  format: SceneFormat,
  timing: SceneTiming,
  timeSeconds: number,
  textWidths: Readonly<Record<string, number>> = {},
): { x: number; y: number; width: number; height: number } | null {
  let result: { x: number; y: number; width: number; height: number } | null = null;
  let parentId = node.parentId;
  for (let step = 0; parentId && step < 8; step += 1) {
    const parent: SceneNode | undefined = template.nodes.find((entry) => entry.id === parentId);
    if (!parent) break;
    if (parent.clipsChildren) {
      const box = resolveNodeBox(parent, template, format, timing, timeSeconds, textWidths);
      const clip = revealClip(parent, box, timing, timeSeconds) ?? box;
      result = result ? intersect(result, clip) : clip;
    }
    parentId = parent.parentId;
  }
  return result;
}

function intersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

/* -------------------------------------------------------------------------- *
 * Появление текста по частям.
 * ------------------------------------------------------------------------- */

/** Одна часть строки: сама подстрока и её собственная доля отыгранности. */
export interface TextUnit {
  text: string;
  /** 0 — часть ещё не появилась, 1 — отыграла целиком. */
  progress: number;
}

/**
 * Разбирает строку на части и раздаёт каждой её долю отыгранности.
 *
 * Волна укладывается в длину отрезка при любом числе частей: доля, а не
 * секунды. Иначе длинный заголовок не успевал бы дописаться до конца входа, а
 * короткий отыгрывал бы за десятую его долю.
 */
export function textUnits(
  text: string,
  animator: SceneTextAnimator,
  segment: "in" | "hold" | "out",
  segmentProgress: number,
): TextUnit[] {
  const parts = splitUnits(text, animator.unit);
  if (parts.length === 0) return [];
  // В удержании текст стоит целиком: волна принадлежит входу и выходу.
  if (segment === "hold") return parts.map((part) => ({ text: part, progress: 1 }));

  const wave = Math.min(1, Math.max(0, segment === "out" ? 1 - segmentProgress : segmentProgress));
  const count = parts.length;
  const spread = animator.stagger * (count - 1);

  return parts.map((part, index) => {
    const order = unitOrder(index, count, animator.direction);
    // Форма записи без деления туда-обратно: последняя часть обязана дойти
    // ровно до единицы к концу отрезка. Через ширину окна ошибка округления
    // оставляла её на 0,9999999, и длинный заголовок не дописывался.
    const local = wave * (1 + spread) - order * animator.stagger;
    return { text: part, progress: Math.min(1, Math.max(0, local)) };
  });
}

/** Порядковый номер части в волне: он и решает, кто появится первым. */
function unitOrder(index: number, count: number, direction: SceneTextAnimator["direction"]): number {
  if (direction === "backward") return count - 1 - index;
  if (direction === "center") {
    // От середины к краям: обе половины идут одновременно.
    const middle = (count - 1) / 2;
    return Math.abs(index - middle);
  }
  return index;
}

/**
 * Делит строку, сохраняя пробелы внутри частей.
 *
 * Пробел обязан ехать вместе со словом, иначе слова слипаются: рисуются они
 * по отдельности, и потерянный пробел уже ничем не вернуть.
 */
export function splitUnits(text: string, unit: SceneTextAnimator["unit"]): string[] {
  if (unit === "character") return [...text];
  if (unit === "line") return text.split("\n").map((line, index, all) => (index < all.length - 1 ? `${line}\n` : line));
  return text.split(/(?<=\s)/);
}
