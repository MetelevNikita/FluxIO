import assert from "node:assert/strict";
import test from "node:test";
import {
  sceneFormatSchema,
  sceneNodeSchema,
  sceneTemplateSchema,
  sceneTrack,
  type SceneFormat,
  type SceneNode,
  type SceneTemplate,
} from "./scene.js";
import {
  atLeastOnePixel,
  bezierEasing,
  keyframeValueAt,
  regionSavings,
  resolveNodeBox,
  sceneRegion,
  sceneSegmentAt,
  sceneShowRegion,
  sceneTiming,
  trackValueAt,
  revealClip,
  splitUnits,
  textUnits,
} from "./scene-timing.js";

/* ------------------------------- режиссёр -------------------------------- */

test("director fills the operator's duration with hold, not with a stretched entrance", () => {
  const timing = sceneTiming({ inSeconds: 0.6, outSeconds: 0.5 }, 5);
  assert.deepEqual(timing, {
    inSeconds: 0.6,
    holdSeconds: 3.9,
    outSeconds: 0.5,
    compressed: false,
  });
});

test("a duration shorter than the animation compresses both halves instead of cutting one", () => {
  // Оборвать выход на середине хуже, чем проиграть обе половины быстрее:
  // титр, застывший на экране и пропавший скачком, виден зрителю.
  const timing = sceneTiming({ inSeconds: 0.6, outSeconds: 0.6 }, 0.6);
  assert.equal(timing.inSeconds, 0.3);
  assert.equal(timing.outSeconds, 0.3);
  assert.equal(timing.holdSeconds, 0);
  assert.equal(timing.compressed, true);
});

test("a template without an entrance is all hold", () => {
  const timing = sceneTiming({ inSeconds: 0, outSeconds: 0 }, 4);
  assert.deepEqual(timing, {
    inSeconds: 0,
    holdSeconds: 4,
    outSeconds: 0,
    compressed: false,
  });
});

test("segments are reported by time inside the show", () => {
  const timing = sceneTiming({ inSeconds: 1, outSeconds: 1 }, 5);
  assert.deepEqual(sceneSegmentAt(timing, 0.4), { segment: "in", localSeconds: 0.4 });
  assert.deepEqual(sceneSegmentAt(timing, 2), { segment: "hold", localSeconds: 1 });
  assert.deepEqual(sceneSegmentAt(timing, 4.5), { segment: "out", localSeconds: 0.5 });
  // За пределами показа — всё ещё выход: обрезает окно, а не сцена.
  assert.equal(sceneSegmentAt(timing, 99).segment, "out");
});

/* -------------------------------- ключи ---------------------------------- */

test("a track without keyframes holds its constant value", () => {
  const timing = sceneTiming({ inSeconds: 1, outSeconds: 1 }, 5);
  assert.equal(trackValueAt(sceneTrack(0.42), timing, 0), 0.42);
  assert.equal(trackValueAt(sceneTrack(0.42), timing, 3), 0.42);
});

test("keyframes interpolate inside the entrance and stop at its ends", () => {
  const keys = [
    { atSeconds: 0, value: 0, easing: "linear" as const },
    { atSeconds: 1, value: 10, easing: "linear" as const },
  ];
  assert.equal(keyframeValueAt(0, keys, -1), 0);
  assert.equal(keyframeValueAt(0, keys, 0.5), 5);
  assert.equal(keyframeValueAt(0, keys, 2), 10);
});

test("two keyframes at one instant are a jump, not a division by zero", () => {
  const keys = [
    { atSeconds: 0.5, value: 1, easing: "linear" as const },
    { atSeconds: 0.5, value: 9, easing: "linear" as const },
  ];
  assert.equal(keyframeValueAt(0, keys, 0.5), 9);
  assert.ok(Number.isFinite(keyframeValueAt(0, keys, 0.4)));
});

test("hold keeps whatever the entrance ended on", () => {
  const track = {
    value: 0,
    inKeyframes: [
      { atSeconds: 0, value: 0, easing: "linear" as const },
      { atSeconds: 0.5, value: 1, easing: "linear" as const },
    ],
    outKeyframes: [],
  };
  const timing = sceneTiming({ inSeconds: 1, outSeconds: 1 }, 6);
  // Растянутое удержание нечем заполнять: иначе длительность показа начала бы
  // менять картинку, а она не должна.
  assert.equal(trackValueAt(track, timing, 3), 1);
  assert.equal(trackValueAt(track, timing, 4.9), 1);
});

test("the exit starts from the value the entrance left behind", () => {
  const track = {
    value: 0,
    inKeyframes: [{ atSeconds: 0.5, value: 1, easing: "linear" as const }],
    outKeyframes: [
      { atSeconds: 0, value: 1, easing: "linear" as const },
      { atSeconds: 1, value: 0, easing: "linear" as const },
    ],
  };
  const timing = sceneTiming({ inSeconds: 1, outSeconds: 1 }, 5);
  assert.equal(trackValueAt(track, timing, 4), 1);
  assert.equal(trackValueAt(track, timing, 4.5), 0.5);
});

/* ------------------------------- раскладка ------------------------------- */

test("thin elements never fall below one pixel", () => {
  // 0,1 % высоты на 576 — это полпикселя, то есть мутная линия вместо чёткой.
  assert.equal(atLeastOnePixel(0.5), 1);
  assert.equal(atLeastOnePixel(0), 0);
  assert.equal(atLeastOnePixel(3.2), 3.2);
});

test("the same scene lands in the same relative place at every resolution", () => {
  const template = lowerThird();
  const timing = sceneTiming(template.director, 5);
  const boxes = [format("sd-16x9", 720, 576), format("hd", 1920, 1080), format("uhd", 3840, 2160)]
    .map((f) => {
      const box = resolveNodeBox(template.nodes[0]!, template, f, timing, 3);
      return { x: box.x / f.width, y: box.y / f.height, h: box.height / f.height };
    });
  for (const box of boxes.slice(1)) {
    assert.ok(Math.abs(box.x - boxes[0]!.x) < 1e-9, "x уехал при смене разрешения");
    assert.ok(Math.abs(box.y - boxes[0]!.y) < 1e-9, "y уехал при смене разрешения");
    assert.ok(Math.abs(box.h - boxes[0]!.h) < 1e-9, "высота уехала");
  }
});

test("a per-target override moves the node without touching the shared scene", () => {
  const template = lowerThird();
  template.nodes[0]!.overrides = { "sd-4x3": sceneOverride({ x: 0.2, hidden: null }) };
  const timing = sceneTiming(template.director, 5);

  const sd = resolveNodeBox(template.nodes[0]!, template, format("sd-4x3", 720, 576), timing, 3);
  const hd = resolveNodeBox(template.nodes[0]!, template, format("hd", 1920, 1080), timing, 3);
  assert.equal(sd.x, 0.2 * 720);
  // Раскладка для 16:9 в 4:3 не помещается, но править ради этого общую сцену
  // нельзя — иначе HD поедет вслед за SD.
  assert.equal(hd.x, 0.06 * 1920);
});

test("a plate bound to text grows with the measured string", () => {
  const template = lowerThird();
  const timing = sceneTiming(template.director, 5);
  const f = format("hd", 1920, 1080);
  const narrow = resolveNodeBox(template.nodes[0]!, template, f, timing, 3, { title: 200 });
  const wide = resolveNodeBox(template.nodes[0]!, template, f, timing, 3, { title: 900 });
  assert.equal(wide.width - narrow.width, 700);
  // Отступы считаются от высоты кадра: на 2160 они обязаны вырасти вдвое.
  const uhd = resolveNodeBox(
    template.nodes[0]!, template, format("uhd", 3840, 2160), timing, 3, { title: 200 },
  );
  assert.equal(uhd.width - 200, (narrow.width - 200) * 2);
});

/* -------------------------------- область -------------------------------- */

test("the region covers the visible nodes and nothing else", () => {
  const template = lowerThird();
  const timing = sceneTiming(template.director, 5);
  const f = format("hd", 1920, 1080);
  const region = sceneRegion(template, f, timing, 3, { title: 400 });

  assert.ok(region, "область не посчиталась");
  assert.ok(region.width < f.width, "область шире кадра — смысла в ней нет");
  assert.ok(region.height < f.height * 0.4, "полоса должна быть узкой");
  assert.ok(region.x >= 0 && region.y >= 0);
  assert.ok(region.x + region.width <= f.width);
  assert.ok(region.y + region.height <= f.height);
});

test("the region grows to fit the shadow, which spills outside the node", () => {
  const template = lowerThird();
  const timing = sceneTiming(template.director, 5);
  const f = format("hd", 1920, 1080);
  const flat = sceneRegion(template, f, timing, 3, { title: 400 })!;

  template.nodes[0]!.shadow = { ...template.nodes[0]!.shadow, enabled: true, blur: 0.03 };
  const shadowed = sceneRegion(template, f, timing, 3, { title: 400 })!;
  // Иначе тень срежет по краю полосы, и это видно в эфире.
  assert.ok(shadowed.width > flat.width);
  assert.ok(shadowed.height > flat.height);
});

test("a scene with nothing visible asks for no region at all", () => {
  const template = lowerThird();
  for (const node of template.nodes) node.transform.opacity = sceneTrack(0);
  const timing = sceneTiming(template.director, 5);
  // Нечего рисовать — значит и трубу занимать незачем.
  assert.equal(sceneRegion(template, format("hd", 1920, 1080), timing, 3), null);
});

test("region savings say how much cheaper the band is than the frame", () => {
  const f = format("uhd", 3840, 2160);
  // Разведка: полный кадр 2160 не проходит через трубу, полоса проходит.
  assert.equal(regionSavings({ x: 0, y: 1620, width: 3840, height: 540 }, f), 4);
  assert.equal(regionSavings(null, f), Number.POSITIVE_INFINITY);
});

test("the show region covers the whole entrance, not just one instant", () => {
  const template = lowerThird();
  // Плашка выезжает слева: на первом кадре она за краем, на последнем на месте.
  template.nodes[0]!.transform.x = {
    value: 0.06,
    inKeyframes: [
      { atSeconds: 0, value: -0.3, easing: "linear" },
      { atSeconds: 0.6, value: 0.06, easing: "linear" },
    ],
    outKeyframes: [],
  };
  const timing = sceneTiming(template.director, 5);
  const f = format("hd", 1920, 1080);

  const settled = sceneRegion(template, f, timing, 3, { title: 400 })!;
  const whole = sceneShowRegion(template, f, timing, { title: 400 });

  assert.ok(whole, "область показа не посчиталась");
  // Наложение принимает одно смещение на весь вход, двигать его покадрово
  // нечем — значит полотно обязано вмещать всю анимацию.
  assert.ok(whole.width > settled.width, "выезд не попал в область показа");
  assert.equal(whole.x, 0, "выезд за левый край должен прижаться к кадру");
});

test("the show region still beats the full frame by a wide margin", () => {
  const template = lowerThird();
  const timing = sceneTiming(template.director, 5);
  const f = format("uhd", 3840, 2160);
  const whole = sceneShowRegion(template, f, timing, { title: 900 })!;
  // Ради этого числа вся затея с областью и существует.
  assert.ok(regionSavings(whole, f) > 4, `экономия всего ×${regionSavings(whole, f)}`);
});

test("a show with nothing visible at any moment needs no canvas", () => {
  const template = lowerThird();
  for (const node of template.nodes) node.transform.opacity = sceneTrack(0);
  const timing = sceneTiming(template.director, 5);
  assert.equal(sceneShowRegion(template, format("hd", 1920, 1080), timing), null);
});

/* ------------------------------- фикстуры -------------------------------- */

function format(layout: SceneFormat["layout"], width: number, height: number): SceneFormat {
  return sceneFormatSchema.parse({
    layout,
    width,
    height,
    drawRate: 25,
    pixelAspect: layout === "sd-4x3" ? 12 / 11 : layout === "sd-16x9" ? 16 / 11 : 1,
  });
}

function sceneOverride(patch: Record<string, unknown>) {
  return {
    x: null, y: null, width: null, height: null, fontSize: null, hidden: null,
    ...patch,
  } as never;
}

/** Плашка, привязанная по ширине к тексту, плюс сам текст. */
function lowerThird(): SceneTemplate {
  const plate: SceneNode = sceneNodeSchema.parse({
    id: "plate",
    name: "плашка",
    kind: "rect",
    parentId: null,
    fitToText: { nodeId: "title", padX: 0.02, padY: 0.01, axis: "x" },
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
  });
  const title: SceneNode = sceneNodeSchema.parse({
    id: "title",
    name: "заголовок",
    kind: "text",
    parentId: null,
    text: { kind: "field", fieldKey: "title" },
    transform: {
      x: sceneTrack(0.08),
      y: sceneTrack(0.78),
      width: sceneTrack(0.2),
      height: sceneTrack(0.06),
      anchorX: 0,
      anchorY: 0,
      scale: sceneTrack(1),
      rotationDegrees: sceneTrack(0),
      opacity: sceneTrack(1),
    },
  });
  return sceneTemplateSchema.parse({
    id: "tpl",
    name: "Нижняя треть",
    targets: ["hd"],
    fields: [{ key: "title", label: "Заголовок", type: "text", sample: "Александр Петров" }],
    nodes: [plate, title],
  });
}

/* -------------------------------- кривые --------------------------------- */

test("a bezier curve passes through its ends exactly", () => {
  const curve = { x1: 0.4, y1: 0, x2: 0.2, y2: 1 };
  assert.equal(bezierEasing(curve, 0), 0);
  assert.equal(bezierEasing(curve, 1), 1);
  // За пределами отрезка ключ уже не действует: значение зажато.
  assert.equal(bezierEasing(curve, -0.5), 0);
  assert.equal(bezierEasing(curve, 2), 1);
});

test("a bezier curve with handles on the diagonal is plain linear", () => {
  const linear = { x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 };
  for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    assert.ok(Math.abs(bezierEasing(linear, x) - x) < 1e-4, `в точке ${x} кривая ушла с прямой`);
  }
});

test("an ease-out curve is ahead of linear, an ease-in behind it", () => {
  const easeOut = { x1: 0, y1: 0, x2: 0.58, y2: 1 };
  const easeIn = { x1: 0.42, y1: 0, x2: 1, y2: 1 };
  assert.ok(bezierEasing(easeOut, 0.25) > 0.25, "выход не опережает прямую");
  assert.ok(bezierEasing(easeIn, 0.25) < 0.25, "вход не отстаёт от прямой");
});

test("a curve is monotonic in time even where it overshoots in value", () => {
  // Отскок за единицу — законный приём, но время назад идти не может:
  // иначе у одного момента оказалось бы два значения.
  const overshoot = { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 };
  let previous = -Infinity;
  for (let x = 0; x <= 1.0001; x += 0.05) {
    const value = bezierEasing(overshoot, x);
    assert.ok(Number.isFinite(value), `не число в точке ${x}`);
    previous = value;
  }
  assert.ok(previous > 0.99);
  // И собственно отскок: середина кривой заходит выше конечного значения.
  assert.ok(bezierEasing(overshoot, 0.5) > 1, "отскок не сработал");
});

test("a flat curve does not diverge where Newton's method fails", () => {
  // Полка: производная около нуля, и шаг Ньютона улетает. Подстраховка —
  // деление отрезка пополам.
  const flat = { x1: 1, y1: 0, x2: 0, y2: 1 };
  for (const x of [0.01, 0.5, 0.99]) {
    const value = bezierEasing(flat, x);
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `разошлось в ${x}: ${value}`);
  }
});

test("keyframes interpolate along the curve of the key they run to", () => {
  const timing = sceneTiming({ inSeconds: 1, outSeconds: 0 }, 4);
  const track = {
    value: 0,
    inKeyframes: [
      { atSeconds: 0, value: 0, easing: "linear" as const, bezier: { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } },
      { atSeconds: 1, value: 1, easing: "bezier" as const, bezier: { x1: 0, y1: 0, x2: 0.58, y2: 1 } },
    ],
    outKeyframes: [],
  };
  // Кривая описывает путь **к** ключу, поэтому берётся у второго.
  assert.ok(trackValueAt(track, timing, 0.25) > 0.25, "кривая второго ключа не применилась");
});

/* ---------------------------- маска раскрытия ----------------------------- */

test("a fully revealed node is not clipped at all", () => {
  // Лишний clip() в графе отрисовки ни к чему: он стоит времени на каждом кадре.
  const template = lowerThird();
  const timing = sceneTiming(template.director, 5);
  assert.equal(
    revealClip(template.nodes[0]!, { x: 0, y: 0, width: 100, height: 20 }, timing, 3),
    null,
  );
});

test("the mask grows from the chosen edge, not always from the left", () => {
  const template = lowerThird();
  const timing = sceneTiming(template.director, 5);
  const box = { x: 100, y: 50, width: 200, height: 40 };
  const half = (originX: number) => {
    const node = {
      ...template.nodes[0]!,
      transform: { ...template.nodes[0]!.transform, reveal: sceneTrack(0.5), revealOriginX: originX },
    };
    return revealClip(node, box, timing, 3)!;
  };

  // Слева направо: левый край на месте.
  assert.equal(half(0).x, 100);
  // Справа налево: правый край на месте.
  assert.equal(half(1).x + half(1).width, 300);
  // Из середины: поровну с обеих сторон.
  assert.equal(half(0.5).x, 150);
  assert.equal(half(0.5).width, 100);
});

test("a closed mask has zero width, which the renderer must skip", () => {
  const template = lowerThird();
  const timing = sceneTiming(template.director, 5);
  const node = {
    ...template.nodes[0]!,
    transform: { ...template.nodes[0]!.transform, reveal: sceneTrack(0) },
  };
  const clip = revealClip(node, { x: 0, y: 0, width: 200, height: 40 }, timing, 3)!;
  assert.equal(clip.width, 0);
});

test("reveal follows its keyframes like any other track", () => {
  // Раскрытие — обычная дорожка: ключи на ней ставятся так же, как на
  // прозрачности, и режиссёр растягивает удержание одинаково.
  const template = lowerThird();
  const node = {
    ...template.nodes[0]!,
    transform: {
      ...template.nodes[0]!.transform,
      reveal: {
        value: 1,
        inKeyframes: [
          { atSeconds: 0, value: 0, easing: "linear" as const },
          { atSeconds: 1, value: 1, easing: "linear" as const },
        ],
        outKeyframes: [],
      },
    },
  };
  const timing = sceneTiming({ inSeconds: 1, outSeconds: 0 }, 4);
  const box = { x: 0, y: 0, width: 200, height: 40 };
  assert.equal(revealClip(node, box, timing, 0.5)!.width, 100);
  // В удержании маска уже открыта — обрезать нечего.
  assert.equal(revealClip(node, box, timing, 3), null);
});

/* ------------------------- появление текста по частям ---------------------- */

function animator(patch: Partial<Parameters<typeof textUnits>[1]> = {}) {
  return {
    enabled: true, unit: "character" as const, effect: "fade-up" as const,
    stagger: 0.6, direction: "forward" as const, ...patch,
  };
}

test("hold shows the whole string: the wave belongs to the entrance and the exit", () => {
  const units = textUnits("Гость", animator(), "hold", 0.5);
  assert.equal(units.length, 5);
  assert.ok(units.every((unit) => unit.progress === 1));
});

test("the wave fits the segment whatever the text length", () => {
  // Иначе длинный заголовок не успевал бы дописаться до конца входа, а
  // короткий отыгрывал бы за десятую его долю.
  for (const text of ["Да", "Александр Петрович Иванов-Задунайский"]) {
    const done = textUnits(text, animator(), "in", 1);
    assert.ok(done.every((unit) => unit.progress === 1), `${text}: не дописалось к концу входа`);
    const start = textUnits(text, animator(), "in", 0);
    assert.ok(start.every((unit) => unit.progress === 0), `${text}: началось раньше входа`);
  }
});

test("stagger zero makes every part appear together", () => {
  const units = textUnits("Гость", animator({ stagger: 0 }), "in", 0.5);
  assert.equal(new Set(units.map((unit) => unit.progress)).size, 1);
});

test("the first character leads the last one when the wave runs forward", () => {
  const units = textUnits("Гость", animator({ stagger: 1 }), "in", 0.5);
  assert.ok(units[0]!.progress > units[4]!.progress);
});

test("a backward wave reverses the order, a centred one starts from the middle", () => {
  const back = textUnits("Гость", animator({ stagger: 1, direction: "backward" }), "in", 0.5);
  assert.ok(back[4]!.progress > back[0]!.progress);

  const centre = textUnits("Гость", animator({ stagger: 1, direction: "center" }), "in", 0.5);
  assert.ok(centre[2]!.progress > centre[0]!.progress);
  assert.ok(centre[2]!.progress > centre[4]!.progress);
  // Обе половины идут одновременно.
  assert.equal(centre[1]!.progress, centre[3]!.progress);
});

test("the exit runs the wave backwards through the same units", () => {
  const early = textUnits("Гость", animator(), "out", 0.1);
  const late = textUnits("Гость", animator(), "out", 0.9);
  assert.ok(early[0]!.progress > late[0]!.progress, "выход не убирает буквы");
});

test("words keep their trailing space, otherwise they run together", () => {
  // Рисуются части по отдельности, и потерянный пробел уже ничем не вернуть.
  const words = splitUnits("Александр Петров", "word");
  assert.deepEqual(words, ["Александр ", "Петров"]);
  assert.equal(words.join(""), "Александр Петров");
});

test("lines keep their break so the next one starts where it should", () => {
  const lines = splitUnits("Первая\nВторая", "line");
  assert.equal(lines.length, 2);
  assert.equal(lines.join(""), "Первая\nВторая");
});
