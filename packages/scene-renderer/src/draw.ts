import {
  atLeastOnePixel,
  fromHeight,
  resolveNodeBox,
  sceneSegmentAt,
  trackValueAt,
  type SceneFormat,
  type SceneNode,
  type SceneTemplate,
  type SceneTiming,
} from "@gruber/contracts";
import type { SceneDrawInput, SceneSurface } from "./surface.js";
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

/** Цвет с прозрачностью в том виде, в каком его понимает Canvas 2D. */
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

  if (node.textStyle.strokeWidth > 0) {
    surface.lineWidth = atLeastOnePixel(fromHeight(node.textStyle.strokeWidth, format) * 2);
    surface.lineJoin = "round";
    surface.strokeStyle = node.textStyle.strokeColor;
    surface.strokeText(content, x, y);
  }
  surface.fillStyle = node.textStyle.color;
  surface.fillText(content, x, y);

  if (isTicker) surface.restore();
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
    surface.fillStyle = rgba(node.rectStyle.fill, node.rectStyle.fillOpacity);
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
    surface.fillStyle = rgba(node.rectStyle.fill, node.rectStyle.fillOpacity);
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
    drawText(surface, node, format, input, box);
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
