import assert from "node:assert/strict";
import test from "node:test";
import {
  sceneFormatSchema,
  sceneNodeSchema,
  sceneTemplateSchema,
  sceneTiming,
  sceneTrack,
  type SceneFormat,
  type SceneNode,
  type SceneTemplate,
} from "@gruber/contracts";
import { drawScene, measureSceneText } from "./draw.js";
import { RecordingSurface } from "./recording-surface.js";
import { fitSampleText, joinTickerItems, resolveText } from "./text.js";
import type { SceneDrawInput } from "./surface.js";

/* -------------------------------- текст ---------------------------------- */

test("a clock follows on-air time, not the renderer's own wall clock", () => {
  // Рендерер следующего ролика стартует заранее. По системным часам он
  // нарисовал бы будущее — тот же капкан, что у нынешних экранных часов.
  const at = (airEpochSeconds: number, timeSeconds: number) => resolveText(
    { kind: "clock", format: "HH:MM:SS", timezoneOffsetMinutes: 0 },
    input({ airEpochSeconds, timeSeconds }),
  );
  assert.equal(at(3 * 3600 + 25 * 60 + 10, 0), "03:25:10");
  assert.equal(at(3 * 3600 + 25 * 60 + 10, 5), "03:25:15");
});

test("a timezone offset shifts the clock without touching the machine's zone", () => {
  const text = resolveText(
    { kind: "clock", format: "HH:MM", timezoneOffsetMinutes: 180 },
    input({ airEpochSeconds: 0, timeSeconds: 0 }),
  );
  assert.equal(text, "03:00");
});

test("a countdown reaches zero and stops there", () => {
  const at = (timeSeconds: number) => resolveText(
    { kind: "countdown", format: "MM:SS", source: "fixed", seconds: 90 },
    input({ timeSeconds }),
  );
  assert.equal(at(0), "01:30");
  assert.equal(at(89), "00:01");
  // Уйти в минус нельзя: отсчёт замирает на нуле, а не показывает «-00:01».
  assert.equal(at(120), "00:00");
});

test("a countdown to the end of the clip uses the clip, not a fixed number", () => {
  const text = resolveText(
    { kind: "countdown", format: "MM:SS", source: "clip-remaining", seconds: 60 },
    input({ timeSeconds: 10, clipRemainingSeconds: 300 }),
  );
  assert.equal(text, "04:50");
});

test("a plate is measured by the widest value the field will ever show", () => {
  // Цифры часов меняются каждую секунду, и плашка, посаженная по текущему
  // значению, дёргалась бы вместе с ними.
  const sample = fitSampleText(
    { kind: "clock", format: "HH:MM:SS", timezoneOffsetMinutes: 0 },
    input({}),
  );
  assert.equal(sample, "99:59:59");
});

test("ticker messages join into one line and close the loop with the separator", () => {
  assert.equal(joinTickerItems(["Первое", "Второе"], " • "), "Первое • Второе • ");
  assert.equal(joinTickerItems(["Одно"], " • "), "Одно");
  assert.equal(joinTickerItems(["  ", ""], " • "), "");
});


/* ------------------------------- градиенты ------------------------------- */

test("a linear gradient is built in the node's own box, not in frame fractions", () => {
  const surface = new RecordingSurface();
  const template = sceneTemplateSchema.parse({
    id: "tpl", name: "Плашка", targets: ["hd"],
    director: { inSeconds: 0.5, outSeconds: 0.4 },
    nodes: [node({
      id: "plate", name: "Подложка", kind: "rect",
      rectStyle: {
        fill: "#000000", fillOpacity: 1, fillKind: "linear",
        gradient: {
          fromX: 0, fromY: 0.5, toX: 1, toY: 0.5,
          stops: [
            { offset: 0, color: "#FF0000", opacity: 1 },
            { offset: 1, color: "#0000FF", opacity: 0 },
          ],
        },
      },
    })],
  });
  drawScene(surface, template, hd(), sceneTiming(template.director, 5), input({ timeSeconds: 3 }));

  const built = surface.calls.find((call) => call.op === "createLinearGradient");
  assert.ok(built, "градиент не построен");
  // Узел стоит на 6 % ширины и занимает 30 %: доли считаются от его коробки,
  // иначе градиент не поедет вместе с узлом при смене раскладки.
  assert.ok(Math.abs(built.args[0]! - 0.06 * 1920) < 1, "начало не по левому краю узла");
  assert.ok(Math.abs(built.args[2]! - 0.36 * 1920) < 1, "конец не по правому краю узла");
  // По вертикали — середина узла: y 0.76, высота 0.11.
  assert.ok(Math.abs(built.args[1]! - built.args[3]!) < 1e-9, "линия не горизонтальна");
});

test("a radial gradient takes its radius from the distance between the two points", () => {
  const surface = new RecordingSurface();
  const template = sceneTemplateSchema.parse({
    id: "tpl", name: "Круг", targets: ["hd"],
    director: { inSeconds: 0.5, outSeconds: 0.4 },
    nodes: [node({
      id: "dot", name: "Точка", kind: "ellipse",
      rectStyle: {
        fill: "#000000", fillOpacity: 1, fillKind: "radial",
        gradient: {
          fromX: 0.5, fromY: 0.5, toX: 1, toY: 0.5,
          stops: [
            { offset: 0, color: "#FFFFFF", opacity: 1 },
            { offset: 1, color: "#FFFFFF", opacity: 0 },
          ],
        },
      },
    })],
  });
  drawScene(surface, template, hd(), sceneTiming(template.director, 5), input({ timeSeconds: 3 }));

  const built = surface.calls.find((call) => call.op === "createRadialGradient");
  assert.ok(built, "радиальный градиент не построен");
  assert.equal(built.args[2], 0, "внутренний радиус должен быть нулевым");
  // Половина ширины узла: от центра до правого края.
  assert.ok(Math.abs(built.args[5]! - 0.15 * 1920) < 1, "радиус не по расстоянию до второй точки");
});

test("gradient stops carry the node opacity and go in ascending order", () => {
  const surface = new RecordingSurface();
  const template = sceneTemplateSchema.parse({
    id: "tpl", name: "Плашка", targets: ["hd"],
    director: { inSeconds: 0.5, outSeconds: 0.4 },
    nodes: [node({
      id: "plate", name: "Подложка", kind: "rect",
      rectStyle: {
        fill: "#000000", fillOpacity: 0.5, fillKind: "linear",
        gradient: {
          fromX: 0, fromY: 0, toX: 1, toY: 0,
          // Нарочно не по порядку: канва точки не сортирует, и поставленная
          // раньше своей очереди у части реализаций просто теряется.
          stops: [
            { offset: 1, color: "#0000FF", opacity: 1 },
            { offset: 0, color: "#FF0000", opacity: 1 },
          ],
        },
      },
    })],
  });
  drawScene(surface, template, hd(), sceneTiming(template.director, 5), input({ timeSeconds: 3 }));

  const style = surface.calls.find((call) => call.op === "fill")?.style ?? "";
  assert.ok(style.startsWith("linear("), "заливка не градиентом");
  const stops = style.split(";").slice(1);
  assert.equal(stops[0], "0:rgba(255, 0, 0, 0.500)", "первой обязана идти нулевая точка");
  assert.equal(stops[1], "1:rgba(0, 0, 255, 0.500)");
});

/* ------------------------------- отрисовка ------------------------------- */

test("nodes are drawn in the order the operator put them in", () => {
  const surface = new RecordingSurface();
  const template = lowerThird();
  drawScene(surface, template, hd(), sceneTiming(template.director, 5), input({ timeSeconds: 3 }));

  const painted = surface.calls
    .filter((call) => call.op === "fill" || call.op === "fillText")
    .map((call) => call.op);
  // Плашка, потом круг, потом надпись: сортировать порядок нельзя, его задал
  // человек — то же правило, что в библиотеке эффектов.
  assert.deepEqual(painted, ["fill", "fill", "fillText"]);
});

test("a plate bound to text is drawn wide enough for the string it backs", () => {
  const format = hd();
  const template = lowerThird();
  const timing = sceneTiming(template.director, 5);

  const short = plateWidth(template, format, timing, "Иван");
  const long = plateWidth(template, format, timing, "Александр Константинопольский");
  assert.ok(long > short, "плашка не выросла под длинный текст");

  // И то и другое посчитано по реальной ширине строки, а не по значению из
  // шаблона: свойство узла вместо соглашения `fit:` с промером снаружи.
  const widths = measureSceneText(
    new RecordingSurface(), template, format,
    input({ fields: { title: "Иван" } }),
  );
  assert.ok(Math.abs(short - widths.title! - 2 * 0.02 * format.height) < 1e-6);
});

test("the same scene keeps its proportions from 576 to 2160", () => {
  const template = lowerThird();
  const timing = sceneTiming(template.director, 5);
  const relative = [format("sd-16x9", 720, 576), format("hd", 1920, 1080), format("uhd", 3840, 2160)]
    .map((f) => {
      const surface = new RecordingSurface();
      drawScene(surface, template, f, timing, input({ timeSeconds: 3 }));
      const text = surface.ops("fillText")[0]!;
      return { x: text.args[0]! / f.width, y: text.args[1]! / f.height };
    });
  for (const point of relative.slice(1)) {
    assert.ok(Math.abs(point.x - relative[0]!.x) < 1e-9, "надпись уехала по горизонтали");
    assert.ok(Math.abs(point.y - relative[0]!.y) < 1e-9, "надпись уехала по вертикали");
  }
});

test("the text appears together with its plate, because they share one clock", () => {
  const template = lowerThird();
  // Вход прозрачности у обоих узлов одинаковый — это и есть сцена.
  for (const node of template.nodes) {
    node.transform.opacity = {
      value: 0,
      inKeyframes: [
        { atSeconds: 0, value: 0, easing: "linear" },
        { atSeconds: 0.6, value: 1, easing: "linear" },
      ],
      outKeyframes: [],
    };
  }
  const timing = sceneTiming(template.director, 5);

  const atStart = new RecordingSurface();
  drawScene(atStart, template, hd(), timing, input({ timeSeconds: 0 }));
  // В нулевой момент не появляется ничего: ни плашки, ни надписи. Сегодняшний
  // баг — надпись, висящая полторы секунды без подложки, — здесь невозможен.
  assert.equal(atStart.ops("fill").length, 0);
  assert.equal(atStart.ops("fillText").length, 0);

  const settled = new RecordingSurface();
  drawScene(settled, template, hd(), timing, input({ timeSeconds: 3 }));
  assert.ok(settled.ops("fill").length > 0);
  assert.equal(settled.ops("fillText").length, 1);
});

test("drawing a band shifts the origin instead of moving the scene", () => {
  const surface = new RecordingSurface();
  const template = lowerThird();
  drawScene(
    surface, template, hd(), sceneTiming(template.director, 5),
    input({ timeSeconds: 3, originX: 0, originY: 810 }),
  );
  // Полотно меньше кадра, но координаты узлов остаются кадровыми: иначе сцена
  // считалась бы дважды — раз для редактора, раз для полосы.
  assert.deepEqual(surface.ops("translate")[0]!.args, [-0, -810]);
});

test("a hidden node on one target does not draw there and still draws elsewhere", () => {
  const template = lowerThird();
  template.nodes[1]!.overrides = {
    "sd-4x3": {
      x: null, y: null, width: null, height: null, fontSize: null, hidden: true,
    },
  };
  const timing = sceneTiming(template.director, 5);

  const sd = new RecordingSurface();
  drawScene(sd, template, format("sd-4x3", 720, 576), timing, input({ timeSeconds: 3 }));
  const hdSurface = new RecordingSurface();
  drawScene(hdSurface, template, hd(), timing, input({ timeSeconds: 3 }));

  assert.equal(sd.ops("fill").length, 1, "скрытый круг всё равно нарисовался");
  assert.equal(hdSurface.ops("fill").length, 2);
});

test("a ticker is clipped to its own box so it cannot run past the plate", () => {
  const template = lowerThird();
  template.nodes[2]!.text = {
    kind: "ticker",
    items: ["Срочные новости"],
    separator: " • ",
    speed: 0.06,
    direction: "left",
  };
  const surface = new RecordingSurface();
  drawScene(surface, template, hd(), sceneTiming(template.director, 5), input({ timeSeconds: 3 }));
  // `drawtext` в нынешнем движке обрезать по краю не умеет, и ради этого строке
  // рисуют отдельный холст. Здесь обрезка — штатная операция.
  assert.equal(surface.ops("clip").length, 1);
});

test("an empty field draws nothing at all", () => {
  const surface = new RecordingSurface();
  const template = lowerThird();
  drawScene(
    surface, template, hd(), sceneTiming(template.director, 5),
    input({ timeSeconds: 3, fields: { title: "" } }),
  );
  assert.equal(surface.ops("fillText").length, 0);
});

/* ------------------------------- фикстуры -------------------------------- */

function input(patch: Partial<SceneDrawInput> = {}): SceneDrawInput {
  return {
    frameWidth: 1920,
    frameHeight: 1080,
    originX: 0,
    originY: 0,
    timeSeconds: 0,
    fields: { title: "Александр Петров" },
    images: {},
    airEpochSeconds: 0,
    clipRemainingSeconds: 600,
    ...patch,
  };
}

function format(layout: SceneFormat["layout"], width: number, height: number): SceneFormat {
  return sceneFormatSchema.parse({ layout, width, height, drawRate: 25 });
}

function hd(): SceneFormat {
  return format("hd", 1920, 1080);
}

function plateWidth(
  template: SceneTemplate,
  fmt: SceneFormat,
  timing: ReturnType<typeof sceneTiming>,
  title: string,
): number {
  const surface = new RecordingSurface();
  drawScene(surface, template, fmt, timing, input({ timeSeconds: 3, fields: { title } }));
  const corners = surface.ops("arcTo");
  const left = Math.min(...corners.map((call) => call.args[2]!));
  const right = Math.max(...corners.map((call) => call.args[0]!));
  return right - left;
}

function node(patch: Record<string, unknown>): SceneNode {
  return sceneNodeSchema.parse({
    parentId: null,
    transform: {
      x: sceneTrack(0.06),
      y: sceneTrack(0.76),
      width: sceneTrack(0.3),
      height: sceneTrack(0.11),
      anchorX: 0,
      anchorY: 0,
      scale: sceneTrack(1),
      rotationDegrees: sceneTrack(0),
      opacity: sceneTrack(1),
    },
    ...patch,
  });
}

/** Плашка, круг-маркер и привязанный к плашке заголовок. */
function lowerThird(): SceneTemplate {
  return sceneTemplateSchema.parse({
    id: "tpl",
    name: "Нижняя треть",
    targets: ["hd"],
    director: { inSeconds: 0.6, outSeconds: 0.5 },
    fields: [{ key: "title", label: "Заголовок", type: "text", sample: "Александр Петров" }],
    nodes: [
      node({
        id: "plate",
        name: "плашка",
        kind: "rect",
        fitToText: { nodeId: "title", padX: 0.02, padY: 0.01, axis: "x" },
        rectStyle: { fill: "#233742", fillOpacity: 1, cornerRadius: 0.018, strokeWidth: 0, strokeColor: "#FFFFFF" },
      }),
      node({
        id: "marker",
        name: "маркер",
        kind: "ellipse",
        transform: {
          x: sceneTrack(0.05), y: sceneTrack(0.77), width: sceneTrack(0.05), height: sceneTrack(0.09),
          anchorX: 0, anchorY: 0, scale: sceneTrack(1), rotationDegrees: sceneTrack(0), opacity: sceneTrack(1),
        },
        rectStyle: { fill: "#E97F2C", fillOpacity: 1, cornerRadius: 0, strokeWidth: 0, strokeColor: "#FFFFFF" },
      }),
      node({
        id: "title",
        name: "заголовок",
        kind: "text",
        text: { kind: "field", fieldKey: "title" },
        textStyle: { size: 0.05, color: "#FFFFFF", align: "left", fontFamily: "SceneSans" },
      }),
    ],
  });
}

/* ---------------------------- маска раскрытия ----------------------------- */

test("a reveal mask clips the node instead of resizing it", () => {
  // Анимировать ширину у текста нельзя: буквы поедут и сожмутся вместе с ней.
  // Маска открывает уже готовую надпись, поэтому её кегль и место не меняются.
  const template = lowerThird();
  const masked: SceneTemplate = {
    ...template,
    nodes: template.nodes.map((entry) => (entry.kind === "text"
      ? { ...entry, transform: { ...entry.transform, reveal: sceneTrack(0.5), revealOriginX: 0 } }
      : entry)),
  };
  const surface = new RecordingSurface();
  drawScene(surface, masked, hd(), sceneTiming(masked.director, 5), input({ timeSeconds: 3 }));

  assert.ok(surface.ops("clip").length > 0, "маска не обрезала узел");
  assert.ok(surface.ops("fillText").length > 0, "текст не нарисован под маской");
});

test("a fully closed mask draws nothing at all", () => {
  const template = lowerThird();
  const closed: SceneTemplate = {
    ...template,
    nodes: template.nodes.map((entry) => (entry.kind === "text"
      ? { ...entry, transform: { ...entry.transform, reveal: sceneTrack(0) } }
      : entry)),
  };
  const surface = new RecordingSurface();
  drawScene(surface, closed, hd(), sceneTiming(closed.director, 5), input({ timeSeconds: 3 }));
  assert.equal(surface.ops("fillText").length, 0);
});

test("the mask does not move the text it opens", () => {
  // Место надписи обязано совпасть с местом без маски: раскрытие — обрезка,
  // а не сдвиг.
  const template = lowerThird();
  const open = new RecordingSurface();
  drawScene(open, template, hd(), sceneTiming(template.director, 5), input({ timeSeconds: 3 }));

  const masked: SceneTemplate = {
    ...template,
    nodes: template.nodes.map((entry) => (entry.kind === "text"
      ? { ...entry, transform: { ...entry.transform, reveal: sceneTrack(0.5) } }
      : entry)),
  };
  const half = new RecordingSurface();
  drawScene(half, masked, hd(), sceneTiming(masked.director, 5), input({ timeSeconds: 3 }));

  assert.deepEqual(half.ops("fillText")[0]?.args, open.ops("fillText")[0]?.args);
});
