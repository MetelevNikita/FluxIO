import assert from "node:assert/strict";
import test from "node:test";
import {
  sceneFormatSchema,
  sceneTemplateSchema,
  sceneTrack,
  type SceneFormat,
  type SceneTemplate,
} from "@gruber/contracts";
import {
  addNode,
  applyBoxDrag,
  applyLayoutEdit,
  applyPreset,
  clearLayoutOverride,
  createSceneNode,
  declareField,
  duplicateNode,
  fieldKeyFromLabel,
  moveKeyframe,
  removeField,
  removeKeyframe,
  removeNode,
  reorderNode,
  sampleFieldValues,
  sceneGuides,
  sceneIssues,
  setKeyframe,
  snapCoordinate,
  snapThreshold,
  titleSafeInset,
  trackIsAnimated,
  updateNode,
} from "./scene-edit.js";

function blank(): SceneTemplate {
  return sceneTemplateSchema.parse({ id: "t", name: "Шаблон", targets: ["hd"] });
}

function hd(): SceneFormat {
  return sceneFormatSchema.parse({
    layout: "hd", width: 1_920, height: 1_080, drawRate: 25, scan: "progressive",
  });
}

/* ------------------------------ состав дерева ----------------------------- */

test("a new node lands in the middle of the frame, large enough to grab", () => {
  const node = createSceneNode(blank(), "rect");
  const { x, y, width, height } = node.transform;
  assert.ok(Math.abs(x.value + width.value / 2 - 0.5) < 1e-9, "не по центру по горизонтали");
  assert.ok(Math.abs(y.value + height.value / 2 - 0.5) < 1e-9, "не по центру по вертикали");
  // Узел в два процента кадра оператор не найдёт мышью.
  assert.ok(width.value > 0.1 && height.value > 0.1, "узел слишком мелкий");
});

test("adding a node puts it on top, because the list is the stacking order", () => {
  let template = blank();
  const first = createSceneNode(template, "rect");
  template = addNode(template, first);
  const second = createSceneNode(template, "text");
  template = addNode(template, second);
  assert.deepEqual(template.nodes.map((n) => n.id), [first.id, second.id]);
});

test("removing a node takes its children and clears bindings that pointed at it", () => {
  let template = blank();
  const plate = createSceneNode(template, "rect");
  template = addNode(template, plate);
  const title = createSceneNode(template, "text");
  template = addNode(template, title);
  const child = { ...createSceneNode(template, "rect"), parentId: title.id };
  template = addNode(template, child);
  // Плашка тянется по тексту — ровно то соглашение, ради которого живёт fitToText.
  template = updateNode(template, plate.id, (node) => ({
    ...node, fitToText: { nodeId: title.id, padX: 0.02, padY: 0.01, axis: "x" as const, anchor: "grow" as const },
  }));

  const cleaned = removeNode(template, title.id);
  assert.deepEqual(cleaned.nodes.map((n) => n.id), [plate.id], "потомок остался сиротой");
  // Осиротевшая привязка — самая тихая поломка: плашка молча выходит в эфир
  // шаблонной ширины.
  assert.equal(cleaned.nodes[0]!.fitToText, null);
});

test("a duplicate is offset and never inherits the original's text binding", () => {
  let template = blank();
  const title = createSceneNode(template, "text");
  template = addNode(template, title);
  const plate = createSceneNode(template, "rect");
  template = addNode(template, plate);
  template = updateNode(template, plate.id, (node) => ({
    ...node, fitToText: { nodeId: title.id, padX: 0.02, padY: 0.01, axis: "x" as const, anchor: "grow" as const },
  }));

  const copied = duplicateNode(template, plate.id);
  const copy = copied.nodes[copied.nodes.length - 1]!;
  assert.notEqual(copy.id, plate.id);
  assert.ok(copy.transform.x.value > plate.transform.x.value, "копия легла ровно под оригинал");
  // Две плашки на одном тексте — вторая молча накрыла бы первую.
  assert.equal(copy.fitToText, null);
});

test("reordering moves a node in the stack without touching the rest", () => {
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "rect"); template = addNode(template, b);
  const c = createSceneNode(template, "rect"); template = addNode(template, c);

  assert.deepEqual(reorderNode(template, c.id, a.id).nodes.map((n) => n.id), [c.id, a.id, b.id]);
  assert.deepEqual(reorderNode(template, a.id, null).nodes.map((n) => n.id), [b.id, c.id, a.id]);
  assert.deepEqual(reorderNode(template, a.id, a.id).nodes.map((n) => n.id), [a.id, b.id, c.id]);
});

/* ----------------------------- направляющие ------------------------------ */

test("guides cover the safe areas and every other node's edges", () => {
  let template = blank();
  const node = createSceneNode(template, "rect");
  template = addNode(template, node);
  const other = createSceneNode(template, "text");
  template = addNode(template, other);

  const guides = sceneGuides(template, node.id);
  assert.ok(guides.some((g) => g.kind === "safe" && g.at === titleSafeInset));
  assert.ok(guides.some((g) => g.kind === "center" && g.at === 0.5));
  // Собственные края в список не попадают: узел прилипал бы сам к себе.
  assert.ok(!guides.some((g) => g.nodeId === node.id));
  assert.ok(guides.some((g) => g.nodeId === other.id));
});

test("a coordinate snaps to the nearest guide and reports which one", () => {
  const guides = sceneGuides(blank(), null);
  // Левый край в 0,048 — почти зона надписей.
  const snapped = snapCoordinate(0.048, [0.048], guides, "x", 0.01);
  assert.equal(snapped.value, titleSafeInset);
  assert.equal(snapped.guide?.kind, "safe");

  // Далеко — не трогаем, иначе узел начнёт прыгать сам по себе.
  const free = snapCoordinate(0.3, [0.3], guides, "x", 0.01);
  assert.equal(free.value, 0.3);
  assert.equal(free.guide, null);
});

test("the snap threshold is measured in screen pixels, not frame fractions", () => {
  // Полпроцента кадра на мелком предпросмотре — меньше пикселя, и прилипание
  // перестало бы срабатывать именно там, где оно нужнее всего.
  assert.ok(snapThreshold(6, 480) > snapThreshold(6, 1_920));
  assert.equal(snapThreshold(6, 600), 0.01);
  assert.equal(snapThreshold(6, 0), 0);
});

test("the right edge snaps too, not only the origin", () => {
  const guides = sceneGuides(blank(), null);
  // Узел шириной 0,4: левый край 0,101, правый 0,501 — прилипнуть должен правый.
  const snapped = snapCoordinate(0.101, [0.101, 0.501], guides, "x", 0.01);
  assert.ok(Math.abs(snapped.value - 0.1) < 1e-9, "правый край не притянулся к середине");
  assert.equal(snapped.guide?.kind, "center");
});

/* -------------------------------- ключи ---------------------------------- */

test("a keyframe at the same instant replaces instead of piling up", () => {
  let track = sceneTrack(1);
  track = setKeyframe(track, "in", 0.5, 0.3);
  track = setKeyframe(track, "in", 0.5, 0.9);
  assert.equal(track.inKeyframes.length, 1);
  assert.equal(track.inKeyframes[0]!.value, 0.9);
});

test("keyframes stay sorted by time however they were entered", () => {
  let track = sceneTrack(0);
  track = setKeyframe(track, "in", 0.8, 1);
  track = setKeyframe(track, "in", 0.2, 0);
  track = setKeyframe(track, "in", 0.5, 0.5);
  assert.deepEqual(track.inKeyframes.map((k) => k.atSeconds), [0.2, 0.5, 0.8]);
});

test("in and out keyframes are separate: the exit has its own clock", () => {
  let track = sceneTrack(1);
  track = setKeyframe(track, "in", 0.5, 1);
  track = setKeyframe(track, "out", 0.5, 0);
  assert.equal(track.inKeyframes.length, 1);
  assert.equal(track.outKeyframes.length, 1);
  assert.equal(removeKeyframe(track, "in", 0.5).outKeyframes.length, 1);
});

test("moving a keyframe keeps its value and easing", () => {
  let track = setKeyframe(sceneTrack(0), "in", 0.2, 0.7, "linear");
  track = moveKeyframe(track, "in", 0.2, 0.9);
  assert.equal(track.inKeyframes.length, 1);
  assert.deepEqual(track.inKeyframes[0], { atSeconds: 0.9, value: 0.7, easing: "linear" });
});

test("an entrance preset leaves the exit starting where the entrance ended", () => {
  const node = applyPreset(createSceneNode(blank(), "text"), "slide-left", 0.6, 0.5);
  const x = node.transform.x;
  assert.ok(trackIsAnimated(x));
  const entranceEnd = x.inKeyframes[x.inKeyframes.length - 1]!.value;
  const exitStart = x.outKeyframes[0]!.value;
  // Расхождение здесь — это прыжок узла в момент перехода к выходу.
  assert.equal(entranceEnd, exitStart);
});

test("applying a preset twice does not double the keyframes", () => {
  const once = applyPreset(createSceneNode(blank(), "text"), "fade", 0.6, 0.5);
  const twice = applyPreset(once, "fade", 0.6, 0.5);
  assert.equal(twice.transform.opacity.inKeyframes.length, once.transform.opacity.inKeyframes.length);
});

/* -------------------------------- поля ----------------------------------- */

test("a field key is derived from the label, including Cyrillic", () => {
  assert.equal(fieldKeyFromLabel("Имя гостя", []), "imya_gostya");
  assert.equal(fieldKeyFromLabel("Next title", []), "next_title");
  assert.equal(fieldKeyFromLabel("!!!", []), "field");
});

test("a colliding key gets a suffix instead of overwriting", () => {
  assert.equal(fieldKeyFromLabel("Имя", ["imya"]), "imya_2");
  assert.equal(fieldKeyFromLabel("Имя", ["imya", "imya_2"]), "imya_3");
});

test("declaring a field binds the node and keeps its text as the sample", () => {
  let template = blank();
  const title = { ...createSceneNode(template, "text"), text: { kind: "static" as const, text: "Александр Петров" } };
  template = addNode(template, title);
  template = declareField(template, title.id, "Имя гостя");

  const field = template.fields[0]!;
  assert.equal(field.key, "imya_gostya");
  // Образец нужен привязанной плашке: без него ей нечем мерить ширину.
  assert.equal(field.sample, "Александр Петров");
  assert.deepEqual(template.nodes[0]!.text, { kind: "field", fieldKey: "imya_gostya" });
});

test("removing a field returns bound nodes to plain text, not to emptiness", () => {
  let template = blank();
  const title = { ...createSceneNode(template, "text"), text: { kind: "static" as const, text: "Гость" } };
  template = addNode(template, title);
  template = declareField(template, title.id, "Имя");
  template = removeField(template, "imya");

  assert.deepEqual(template.fields, []);
  assert.deepEqual(template.nodes[0]!.text, { kind: "static", text: "Гость" });
});

test("sample values are what the editor previews with", () => {
  let template = blank();
  const title = { ...createSceneNode(template, "text"), text: { kind: "static" as const, text: "Гость" } };
  template = addNode(template, title);
  template = declareField(template, title.id, "Имя");
  assert.deepEqual(sampleFieldValues(template), { imya: "Гость" });
});

/* ------------------------------ поправки --------------------------------- */

test("editing with no target selected changes the shared scene", () => {
  const node = applyLayoutEdit(createSceneNode(blank(), "rect"), null, { x: 0.1 });
  assert.equal(node.transform.x.value, 0.1);
  assert.deepEqual(node.overrides, {});
});

test("editing inside a target lands as an override, leaving the shared scene alone", () => {
  const base = createSceneNode(blank(), "rect");
  const node = applyLayoutEdit(base, "sd-4x3", { x: 0.2 });
  // Доводка SD не должна утянуть за собой HD.
  assert.equal(node.transform.x.value, base.transform.x.value);
  assert.equal(node.overrides["sd-4x3"]?.x, 0.2);
  assert.equal(node.overrides["sd-4x3"]?.y, null);

  const cleared = clearLayoutOverride(node, "sd-4x3");
  assert.equal(cleared.overrides["sd-4x3"], undefined);
});

test("dragging an animated node moves its whole animation, not just the base", () => {
  // Холст рисует значение **с ключей**. Записать дельту в одно базовое
  // значение — значит увести узел мимо места, куда его положили: ровно этим
  // перетаскивание и ломалось.
  const node = applyPreset(createSceneNode(blank(), "text"), "slide-left", 0.6, 0.5);
  const beforeBase = node.transform.x.value;
  const beforeKeys = node.transform.x.inKeyframes.map((key) => key.value);

  const dragged = applyBoxDrag(node, null, { dx: 0.1 }, { x: 0.3, y: 0.4, width: 0.36, height: 0.08 });

  assert.ok(Math.abs(dragged.transform.x.value - (beforeBase + 0.1)) < 1e-9);
  assert.deepEqual(
    dragged.transform.x.inKeyframes.map((key) => key.value),
    beforeKeys.map((value) => value + 0.1),
    "ключи не поехали вместе с узлом — анимация оторвалась от него",
  );
});

test("dragging inside a layout target pins the drawn box, not the base value", () => {
  // Поправка заменяет анимацию целиком, поэтому в неё пишется то, что видно.
  const node = applyPreset(createSceneNode(blank(), "text"), "fade", 0.6, 0.5);
  const dragged = applyBoxDrag(node, "sd-4x3", { dx: 0.1, dy: -0.05 }, { x: 0.3, y: 0.4, width: 0.36, height: 0.08 });

  assert.ok(Math.abs((dragged.overrides["sd-4x3"]?.x ?? 0) - 0.4) < 1e-9);
  assert.ok(Math.abs((dragged.overrides["sd-4x3"]?.y ?? 0) - 0.35) < 1e-9);
  // Общая сцена при этом не тронута.
  assert.equal(dragged.transform.x.value, node.transform.x.value);
});

test("a resize drag carries width and height the same way", () => {
  const node = applyPreset(createSceneNode(blank(), "rect"), "wipe", 0.6, 0.5);
  const keys = node.transform.width.inKeyframes.map((key) => key.value);
  const dragged = applyBoxDrag(node, null, { dw: 0.05 }, { x: 0.35, y: 0.43, width: 0.3, height: 0.14 });
  assert.deepEqual(
    dragged.transform.width.inKeyframes.map((key) => key.value),
    keys.map((value) => value + 0.05),
  );
});

/* ------------------------------- проверки -------------------------------- */

test("a binding to a deleted node is an error, not a silent no-op", () => {
  let template = blank();
  const plate = createSceneNode(template, "rect");
  template = addNode(template, plate);
  template = updateNode(template, plate.id, (node) => ({
    ...node, fitToText: { nodeId: "gone", padX: 0.02, padY: 0.01, axis: "x" as const, anchor: "grow" as const },
  }));
  const issues = sceneIssues(template, hd());
  assert.ok(issues.some((issue) => issue.severity === "error" && /несуществующий узел/.test(issue.message)));
});

test("a text bound to an undeclared field is an error", () => {
  let template = blank();
  const title = { ...createSceneNode(template, "text"), text: { kind: "field" as const, fieldKey: "nope" } };
  template = addNode(template, title);
  const issues = sceneIssues(template, hd());
  assert.ok(issues.some((issue) => issue.severity === "error" && /не объявлено/.test(issue.message)));
});

test("a text node without a font file is a warning about Cyrillic", () => {
  let template = blank();
  template = addNode(template, createSceneNode(template, "text"));
  const issues = sceneIssues(template, hd());
  // Шрифт без кириллицы отдаёт пустые прямоугольники, и видно это только в эфире.
  assert.ok(issues.some((issue) => /кириллица/.test(issue.message)));
});

test("text outside the title-safe area is flagged before it reaches air", () => {
  let template = blank();
  const node = createSceneNode(template, "text");
  template = addNode(template, { ...node, transform: { ...node.transform, x: sceneTrack(0.01) } });
  const issues = sceneIssues(template, hd());
  assert.ok(issues.some((issue) => /зону надписей/.test(issue.message)));
});

test("a plate outside the safe area is not flagged: it bleeds on purpose", () => {
  // Полоса бегущей строки идёт во весь кадр по замыслу. Предупреждение на
  // каждую такую — шум, который приучает не читать список.
  let template = blank();
  const node = createSceneNode(template, "rect");
  template = addNode(template, {
    ...node,
    transform: { ...node.transform, x: sceneTrack(0), width: sceneTrack(1) },
  });
  assert.deepEqual(
    sceneIssues(template, hd()).filter((issue) => /зону надписей/.test(issue.message)),
    [],
  );
});

test("editing a layout the template does not declare is flagged", () => {
  const issues = sceneIssues(blank(), sceneFormatSchema.parse({
    layout: "sd-4x3", width: 720, height: 576, drawRate: 50, scan: "interlaced",
  }));
  assert.ok(issues.some((issue) => /не заявлена/.test(issue.message)));
});

test("a clean template reports nothing", () => {
  let template = blank();
  const node = createSceneNode(template, "rect");
  template = addNode(template, node);
  assert.deepEqual(sceneIssues(template, hd()), []);
});
