import {
  ancestorRevealShift,
  ancestorTransforms,
  atLeastOnePixel,
  fromHeight,
  containerClip,
  resolveNodeBox,
  revealClip,
  revealShift,
  sceneSegmentAt,
  textUnits,
  trackValueAt,
  type SceneFormat,
  type SceneNode,
  type SceneTemplate,
  type SceneTiming,
} from "@gruber/contracts";
import type { SceneDrawInput, SceneGradientHandle, SceneSurface } from "./surface.js";
import { fitSampleText, fontSpec, measureNodeText, resolveText, singleLine } from "./text.js";

/* -------------------------------------------------------------------------- *
 * Отрисовка сцены.
 *
 * Эту функцию вызывают из двух мест: редактор в Electron и графический процесс
 * в эфире. Кода два раза не существует — поэтому предпросмотр не может
 * разойтись с выходом, а текст не может появиться раньше своей плашки.
 *
 * Ничего своего о времени функция не знает: и время, и значения полей приходят
 * снаружи. Предзапущенный рендерер обязан получить `timeSeconds` из номера
 * кадра, а не из системных часов.
 * ------------------------------------------------------------------------- */

/**
 * Заливка узла: цвет или градиент.
 *
 * Точки градиента заданы долями коробки узла, а не кадра, — он принадлежит
 * узлу и обязан ехать вместе с ним при смене раскладки. У радиального центр
 * берётся из первой точки, а радиус — расстоянием до второй: одна пара точек
 * на оба вида, чтобы переключение вида не сбрасывало настройку.
 */
function fillStyleFor(
  surface: SceneSurface,
  node: SceneNode,
  box: { x: number; y: number; width: number; height: number },
): string | SceneGradientHandle {
  const style = node.rectStyle;
  if (style.fillKind === "solid") return rgba(style.fill, style.fillOpacity);

  const fromX = box.x + box.width * style.gradient.fromX;
  const fromY = box.y + box.height * style.gradient.fromY;
  const toX = box.x + box.width * style.gradient.toX;
  const toY = box.y + box.height * style.gradient.toY;

  const gradient = style.fillKind === "linear"
    ? surface.createLinearGradient(fromX, fromY, toX, toY)
    : surface.createRadialGradient(
        fromX, fromY, 0,
        fromX, fromY, Math.max(1, Math.hypot(toX - fromX, toY - fromY)),
      );

  // Точки идут по возрастанию доли: канва не сортирует их сама, и точка,
  // поставленная раньше своей очереди, у части реализаций просто теряется.
  for (const stop of [...style.gradient.stops].sort((a, b) => a.offset - b.offset)) {
    gradient.addColorStop(stop.offset, rgba(stop.color, stop.opacity * style.fillOpacity));
  }
  return gradient;
}

function rgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

const blendOperations: Record<string, string> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  add: "lighter",
};

function roundedRectPath(
  surface: SceneSurface,
  x: number, y: number, width: number, height: number, radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  surface.beginPath();
  if (r <= 0) {
    surface.rect(x, y, width, height);
    surface.closePath();
    return;
  }
  surface.moveTo(x + r, y);
  surface.arcTo(x + width, y, x + width, y + height, r);
  surface.arcTo(x + width, y + height, x, y + height, r);
  surface.arcTo(x, y + height, x, y, r);
  surface.arcTo(x, y, x + width, y, r);
  surface.closePath();
}

/**
 * Ширины строк всех текстовых узлов — то, чем привязанные плашки меряют себя.
 *
 * Считается до отрисовки и одним проходом: плашка рисуется раньше текста,
 * а знать его ширину обязана заранее.
 */
export function measureSceneText(
  surface: SceneSurface,
  template: SceneTemplate,
  format: SceneFormat,
  input: SceneDrawInput,
): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const node of template.nodes) {
    if (node.kind !== "text" || !node.text) continue;
    const size = fromHeight(
      node.overrides[format.layout]?.fontSize ?? node.textStyle.size,
      format,
    );
    // Меряем по образцу, а не по текущему значению: у часов оно меняется
    // каждую секунду, и плашка дёргалась бы вместе с цифрами.
    widths[node.id] = measureNodeText(
      surface, node, fitSampleText(node.text, input), size, node.textStyle.fontFamily,
    );
  }
  return widths;
}

function drawText(
  surface: SceneSurface,
  node: SceneNode,
  format: SceneFormat,
  input: SceneDrawInput,
  box: { x: number; y: number; width: number; height: number },
  timing?: SceneTiming,
  baseAlpha = 1,
): void {
  if (!node.text) return;
  const raw = resolveText(node.text, input);
  if (!raw) return;

  const size = fromHeight(
    node.overrides[format.layout]?.fontSize ?? node.textStyle.size,
    format,
  );
  surface.font = fontSpec(size, node.textStyle.fontFamily);
  surface.textBaseline = "alphabetic";

  // Сужаем тип один раз: дальше нужны и скорость, и направление.
  const ticker = node.text.kind === "ticker" ? node.text : null;
  const isTicker = ticker !== null;
  const content = isTicker ? singleLine(raw) : raw;
  const width = measureNodeText(surface, node, content, size, node.textStyle.fontFamily);

  let x = box.x;
  if (ticker) {
    // Бегущая строка едет по своей области с постоянной скоростью: период
    // круга равен (ширина области + ширина строки) / скорость, поэтому длинный
    // и короткий текст едут одинаково.
    const speed = ticker.speed * format.width;
    const cycle = box.width + width;
    const travelled = (input.timeSeconds * speed) % (cycle || 1);
    x = ticker.direction === "left"
      ? box.x + box.width - travelled
      : box.x - width + travelled;
  } else if (node.textStyle.align === "center") {
    x = box.x + (box.width - width) / 2;
  } else if (node.textStyle.align === "right") {
    x = box.x + box.width - width;
  }

  // Базовая линия по середине прямоугольника узла: так надпись садится туда же,
  // куда её поставил дизайнер, независимо от кегля.
  const y = box.y + box.height / 2 + size * 0.35;

  if (isTicker) {
    // Строка обязана обрезаться по своей области, иначе она уезжает за плашку
    // и снаружи это выглядит как «текст не подставился».
    surface.save();
    surface.beginPath();
    surface.rect(box.x, box.y, box.width, box.height);
    surface.clip();
  }

  const stroke = node.textStyle.strokeWidth > 0
    ? atLeastOnePixel(fromHeight(node.textStyle.strokeWidth, format) * 2)
    : 0;

  const paint = (piece: string, atX: number, atY: number) => {
    if (stroke > 0) {
      surface.lineWidth = stroke;
      surface.lineJoin = "round";
      surface.strokeStyle = node.textStyle.strokeColor;
      surface.strokeText(piece, atX, atY);
    }
    surface.fillStyle = node.textStyle.color;
    surface.fillText(piece, atX, atY);
  };

  // Появление по частям. Бегущую строку не трогаем: она едет целиком, и
  // разбирать её на буквы значит сломать саму механику прокрутки.
  if (node.textAnimator.enabled && !isTicker && timing) {
    const at = sceneSegmentAt(timing, input.timeSeconds);
    const length = at.segment === "in" ? timing.inSeconds
      : at.segment === "out" ? timing.outSeconds : 1;
    const progress = length > 0 ? at.localSeconds / length : 1;
    const units = textUnits(content, node.textAnimator, at.segment, progress);

    let cursor = x;
    for (const unit of units) {
      const unitWidth = surface.measureText(unit.text).width;
      if (unit.progress > 0) {
        const shift = animatorShift(node.textAnimator.effect, unit.progress, size);
        surface.save();
        surface.globalAlpha = baseAlpha * shift.alpha;
        if (shift.scale !== 1) {
          // Масштаб части — вокруг её собственной середины, иначе буквы
          // разъезжаются по строке вместо того, чтобы расти на месте.
          const pivotX = cursor + unitWidth / 2;
          surface.translate(pivotX, y);
          surface.scale(shift.scale, shift.scale);
          surface.translate(-pivotX, -y);
        }
        paint(unit.text, cursor + shift.dx, y + shift.dy);
        surface.restore();
      }
      cursor += unitWidth;
    }
    if (isTicker) surface.restore();
    return;
  }

  paint(content, x, y);

  if (isTicker) surface.restore();
}

/** Сдвиг и прозрачность одной части по её доле отыгранности. */
function animatorShift(
  effect: SceneNode["textAnimator"]["effect"],
  progress: number,
  size: number,
): { alpha: number; dx: number; dy: number; scale: number } {
  const rest = 1 - progress;
  if (effect === "typewriter") {
    // Резкий выход: печатная машинка не проявляет букву, она её ставит.
    return { alpha: progress >= 1 ? 1 : 0, dx: 0, dy: 0, scale: 1 };
  }
  if (effect === "fade-up") return { alpha: progress, dx: 0, dy: rest * size * 0.55, scale: 1 };
  if (effect === "slide") return { alpha: progress, dx: rest * size * 0.9, dy: 0, scale: 1 };
  if (effect === "scale") return { alpha: progress, dx: 0, dy: 0, scale: 0.4 + progress * 0.6 };
  return { alpha: progress, dx: 0, dy: 0, scale: 1 };
}

function drawNode(
  surface: SceneSurface,
  node: SceneNode,
  template: SceneTemplate,
  format: SceneFormat,
  timing: SceneTiming,
  input: SceneDrawInput,
  widths: Readonly<Record<string, number>>,
): void {
  if (node.kind === "group") return;

  const box = resolveNodeBox(node, template, format, timing, input.timeSeconds, widths);
  if (box.hidden || box.opacity <= 0 || box.width <= 0 || box.height <= 0) return;

  surface.save();
  surface.globalAlpha = box.opacity;
  surface.globalCompositeOperation = blendOperations[node.blend] ?? "source-over";

  // Масштаб и поворот групп-предков. Идут **первыми**: они преобразуют и саму
  // картинку узла, и обрезку контейнера, поэтому повёрнутая группа режет своих
  // детей повёрнутой же рамкой. Сдвиг и прозрачность группы сюда не попадают —
  // они уже сложены с ребёнком в `resolveNodeBox`.
  for (const step of ancestorTransforms(
    node, template, format, timing, input.timeSeconds, widths,
  )) {
    surface.translate(step.pivotX, step.pivotY);
    if (step.scaleX !== 1 || step.scaleY !== 1) surface.scale(step.scaleX, step.scaleY);
    if (step.rotationDegrees !== 0) surface.rotate((step.rotationDegrees * Math.PI) / 180);
    surface.translate(-step.pivotX, -step.pivotY);
  }

  // Контейнер режет содержимое по своим границам: ради этого группа и нужна —
  // «спрятать текст за краем плашки» иначе выразить нечем. Обрезка предков
  // идёт первой: она ограничивает всё, что узел нарисует дальше.
  const container = containerClip(node, template, format, timing, input.timeSeconds, widths);
  if (container) {
    if (container.width <= 0 || container.height <= 0) { surface.restore(); return; }
    surface.beginPath();
    surface.rect(container.x, container.y, container.width, container.height);
    surface.clip();
  }

  // Маска раскрытия. Обрезка идёт до всего остального: она открывает уже
  // готовую картинку узла, а не меняет его размер.
  const clip = revealClip(node, box, timing, input.timeSeconds);
  if (clip) {
    if (clip.width <= 0 || clip.height <= 0) { surface.restore(); return; }
    surface.beginPath();
    surface.rect(clip.x, clip.y, clip.width, clip.height);
    surface.clip();
  }

  // Выезд. Идёт **после** всех обрезок и до самой отрисовки: маска стоит на
  // месте, а картинка едет под ней — иначе двигалась бы и рамка, и открывать
  // было бы нечего. Сдвиг предков прибавляется здесь же: выезжающая группа
  // обязана везти содержимое, а не одну свою рамку.
  const ownShift = revealShift(node, box, timing, input.timeSeconds);
  const inherited = ancestorRevealShift(
    node, template, format, timing, input.timeSeconds, widths,
  );
  const shiftX = ownShift.dx + inherited.dx;
  const shiftY = ownShift.dy + inherited.dy;
  if (shiftX !== 0 || shiftY !== 0) {
    // Уехавший за маску узел не рисуется вовсе. Полотно всё равно отсекло бы
    // его целиком, но выезд начинается с нуля на каждом показе, и считать
    // невидимое — работа, которой в реальном времени взяться неоткуда.
    const visible = clip ?? container ?? box;
    const moved = { x: box.x + shiftX, y: box.y + shiftY, width: box.width, height: box.height };
    const overlaps = moved.x < visible.x + visible.width && moved.x + moved.width > visible.x &&
      moved.y < visible.y + visible.height && moved.y + moved.height > visible.y;
    if (!overlaps) { surface.restore(); return; }
    surface.translate(shiftX, shiftY);
  }

  // Наклон и раздельный масштаб по осям — вокруг точки привязки, как поворот:
  // иначе узел уезжает тем дальше, чем он крупнее.
  const skew = trackValueAt(node.transform.skewDegrees, timing, input.timeSeconds);
  const scaleY = trackValueAt(node.transform.scaleY, timing, input.timeSeconds);
  if (skew !== 0 || scaleY !== 1) {
    const pivotX = box.x + box.width * node.transform.anchorX;
    const pivotY = box.y + box.height * node.transform.anchorY;
    surface.translate(pivotX, pivotY);
    if (scaleY !== 1) surface.scale(1, scaleY);
    if (skew !== 0) {
      // Наклон — сдвиг по горизонтали, пропорциональный высоте. Своего вызова
      // у канвы для него нет, поэтому считаем через тангенс.
      surface.transform(1, 0, Math.tan((skew * Math.PI) / 180), 1, 0, 0);
    }
    surface.translate(-pivotX, -pivotY);
  }

  // Размытие. Доля от высоты кадра: два пикселя на 576 заметны, на 2160 — нет.
  const blur = fromHeight(trackValueAt(node.transform.blur, timing, input.timeSeconds), format);
  if (blur > 0.5) surface.filter = `blur(${blur.toFixed(2)}px)`;

  const rotation = trackValueAt(node.transform.rotationDegrees, timing, input.timeSeconds);
  if (rotation !== 0) {
    // Поворот вокруг точки привязки, а не вокруг левого верха: иначе узел
    // уезжает тем дальше, чем он крупнее.
    const pivotX = box.x + box.width * node.transform.anchorX;
    const pivotY = box.y + box.height * node.transform.anchorY;
    surface.translate(pivotX, pivotY);
    surface.rotate((rotation * Math.PI) / 180);
    surface.translate(-pivotX, -pivotY);
  }

  if (node.shadow.enabled) {
    surface.shadowColor = rgba(node.shadow.color, node.shadow.opacity);
    surface.shadowBlur = fromHeight(node.shadow.blur, format);
    surface.shadowOffsetX = 0;
    surface.shadowOffsetY = fromHeight(node.shadow.offsetY, format);
  }

  if (node.kind === "rect") {
    roundedRectPath(
      surface, box.x, box.y, box.width, box.height,
      fromHeight(node.rectStyle.cornerRadius, format),
    );
    surface.fillStyle = fillStyleFor(surface, node, box);
    surface.fill();
    if (node.rectStyle.strokeWidth > 0) {
      surface.lineWidth = atLeastOnePixel(fromHeight(node.rectStyle.strokeWidth, format));
      surface.strokeStyle = node.rectStyle.strokeColor;
      surface.stroke();
    }
  } else if (node.kind === "ellipse") {
    surface.beginPath();
    surface.ellipse(
      box.x + box.width / 2, box.y + box.height / 2,
      box.width / 2, box.height / 2, 0, 0, Math.PI * 2,
    );
    surface.closePath();
    surface.fillStyle = fillStyleFor(surface, node, box);
    surface.fill();
    if (node.rectStyle.strokeWidth > 0) {
      surface.lineWidth = atLeastOnePixel(fromHeight(node.rectStyle.strokeWidth, format));
      surface.strokeStyle = node.rectStyle.strokeColor;
      surface.stroke();
    }
  } else if (node.kind === "image" || node.kind === "video") {
    const source = input.images[node.id];
    if (source) {
      const scale = node.media.fit === "stretch"
        ? null
        : node.media.fit === "cover"
          ? Math.max(box.width / source.width, box.height / source.height)
          : Math.min(box.width / source.width, box.height / source.height);
      const width = scale == null ? box.width : source.width * scale;
      const height = scale == null ? box.height : source.height * scale;
      surface.drawImage(
        source.image,
        box.x + (box.width - width) / 2,
        box.y + (box.height - height) / 2,
        width, height,
      );
    }
  } else if (node.kind === "text") {
    // Тень на тексте отдельно от плашки: включённая тень плашки размазала бы
    // и буквы, а это разные решения дизайнера.
    if (!node.shadow.enabled) surface.shadowBlur = 0;
    drawText(surface, node, format, input, box, timing, box.opacity);
  }

  surface.restore();
}

/**
 * Рисует кадр сцены на поверхности.
 *
 * Порядок узлов в шаблоне — порядок наложения: как в библиотеке эффектов,
 * его задал человек, и сортировать его нельзя.
 */
export function drawScene(
  surface: SceneSurface,
  template: SceneTemplate,
  format: SceneFormat,
  timing: SceneTiming,
  input: SceneDrawInput,
  /**
   * Заранее посчитанные ширины строк. Их обязан передать тот, кто считал по ним
   * область отрисовки: если померить здесь заново, а область посчитать без
   * промера, длинная надпись окажется срезанной по краю полосы.
   */
  measured?: Readonly<Record<string, number>>,
): void {
  surface.save();
  // Полотно меньше кадра, координаты остаются кадровыми: разницу снимает сдвиг.
  surface.translate(-input.originX, -input.originY);

  const widths = measured ?? measureSceneText(surface, template, format, input);
  for (const node of template.nodes) {
    drawNode(surface, node, template, format, timing, input, widths);
  }

  surface.restore();
}

/** Отрезок режиссёра в момент показа — нужен редактору для подсветки дорожки. */
export function segmentAt(timing: SceneTiming, timeSeconds: number): string {
  return sceneSegmentAt(timing, timeSeconds).segment;
}
