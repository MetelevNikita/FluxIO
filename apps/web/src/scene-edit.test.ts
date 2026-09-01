import assert from "node:assert/strict";
import test from "node:test";
import {
  sceneFormatSchema,
  resolveNodeBox,
  sceneTemplateSchema,
  containerClip,
  revealClip,
  revealShift,
  sceneTiming,
  sceneTrack,
  type SceneFormat,
  type SceneTemplate,
} from "@gruber/contracts";
import {
  addNode,
  absoluteKeyframeTime,
  applyBoxDrag,
  applyLayoutEdit,
  applyPreset,
  clearLayoutOverride,
  copyNode,
  createSceneNode,
  declareField,
  duplicateNode,
  editTrackAt,
  fieldKeyFromLabel,
  groupChildren,
  groupNodes,
  moveKeyframe,
  moveKeyframes,
  moveNode,
  pasteNode,
  removeField,
  removeKeyframe,
  removeNode,
  reorderNode,
  reparentNode,
  setGroupContainer,
  setNodeAnchor,
  setRevealOrigin,
  sampleFieldValues,
  sceneGuides,
  sceneIssues,
  setKeyframe,
  snapCoordinate,
  snapKeyframeTime,
  snapThreshold,
  textAnimatorPresets,
  titleSafeInset,
  trackIsAnimated,
  ungroupNode,
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

test("copying one layer keeps it in its group", () => {
  let template = blank();
  const plate = createSceneNode(template, "rect"); template = addNode(template, plate);
  const label = createSceneNode(template, "text"); template = addNode(template, label);
  const grouped = groupNodes(template, [plate.id, label.id]);
  const clipboard = copyNode(grouped.template, label.id)!;
  const pasted = pasteNode(grouped.template, clipboard, "copy");
  assert.equal(pasted.template.nodes.find((node) => node.id === pasted.nodeId)?.parentId, grouped.groupId);
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

/* -------------------------------- группы --------------------------------- */

test("grouping needs at least two nodes: a group of one is not a group", () => {
  let template = blank();
  const node = createSceneNode(template, "rect");
  template = addNode(template, node);
  assert.equal(groupNodes(template, [node.id]).groupId, null);
  assert.equal(groupNodes(template, []).groupId, null);
});

test("a group takes the place of the topmost member, not the top of the stack", () => {
  // Порядок в списке — порядок наложения. Всплытие группы наверх переставило
  // бы слои и изменило картинку.
  let template = blank();
  const bottom = createSceneNode(template, "rect"); template = addNode(template, bottom);
  const middle = createSceneNode(template, "text"); template = addNode(template, middle);
  const top = createSceneNode(template, "rect"); template = addNode(template, top);

  const { template: grouped, groupId } = groupNodes(template, [bottom.id, middle.id]);
  const order = grouped.nodes.map((entry) => entry.id);
  assert.equal(order.indexOf(groupId!), order.indexOf(middle.id) + 1);
  assert.ok(order.indexOf(groupId!) < order.indexOf(top.id), "группа всплыла выше верхнего слоя");
});

test("members point at the group and non-members are untouched", () => {
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const c = createSceneNode(template, "rect"); template = addNode(template, c);

  const { template: grouped, groupId } = groupNodes(template, [a.id, b.id]);
  assert.equal(grouped.nodes.find((n) => n.id === a.id)?.parentId, groupId);
  assert.equal(grouped.nodes.find((n) => n.id === b.id)?.parentId, groupId);
  assert.equal(grouped.nodes.find((n) => n.id === c.id)?.parentId, null);
  assert.deepEqual(groupChildren(grouped, groupId!).map((n) => n.id), [a.id, b.id]);
});

test("ungrouping keeps the children and their order", () => {
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const { template: grouped, groupId } = groupNodes(template, [a.id, b.id]);

  const loose = ungroupNode(grouped, groupId!);
  assert.equal(loose.nodes.length, 2);
  assert.deepEqual(loose.nodes.map((n) => n.id), [a.id, b.id]);
  assert.equal(loose.nodes[0]?.parentId, null);
});

test("removing a group takes its children with it", () => {
  // Иначе дети остались бы сиротами со ссылкой на несуществующего родителя,
  // и их положение считалось бы от него.
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const { template: grouped, groupId } = groupNodes(template, [a.id, b.id]);
  assert.deepEqual(removeNode(grouped, groupId!).nodes, []);
});

test("a group moves its children, which is the whole point of it", () => {
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const { template: grouped, groupId } = groupNodes(template, [a.id, b.id]);

  const format = hd();
  const timing = sceneTiming(grouped.director, 5);
  const before = resolveNodeBox(grouped.nodes.find((n) => n.id === a.id)!, grouped, format, timing, 2);

  const group = grouped.nodes.find((n) => n.id === groupId)!;
  const moved = updateNode(grouped, groupId!, (node) => ({
    ...node,
    transform: {
      ...node.transform,
      x: sceneTrack(group.transform.x.value + 0.1),
      opacity: sceneTrack(0.5),
    },
  }));
  const after = resolveNodeBox(moved.nodes.find((n) => n.id === a.id)!, moved, format, timing, 2);

  assert.ok(Math.abs(after.x - (before.x + 0.1 * format.width)) < 1e-6, "ребёнок не поехал за группой");
  // Прозрачности перемножаются: группа притеняет всех детей сразу.
  assert.ok(Math.abs(after.opacity - before.opacity * 0.5) < 1e-9);
});

test("grouping wraps the members and leaves the picture where it was", () => {
  // Коробка группы — рамка обрезки и точка отсчёта поворота: группа размером в
  // целый кадр не годится ни на то, ни на другое. При этом сборка в группу не
  // перемещение — ни один узел не имеет права сдвинуться.
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const format = hd();
  const timing = sceneTiming(template.director, 5);
  const before = [a, b].map((node) => resolveNodeBox(node, template, format, timing, 2));

  const { template: grouped, groupId } = groupNodes(template, [a.id, b.id]);
  const group = grouped.nodes.find((n) => n.id === groupId)!;
  const groupBox = resolveNodeBox(group, grouped, format, timing, 2);
  const after = [a, b].map((node) =>
    resolveNodeBox(grouped.nodes.find((n) => n.id === node.id)!, grouped, format, timing, 2));

  for (const [index, box] of after.entries()) {
    assert.ok(Math.abs(box.x - before[index]!.x) < 1e-6, "узел сдвинулся при сборке в группу");
    assert.ok(Math.abs(box.y - before[index]!.y) < 1e-6, "узел сдвинулся при сборке в группу");
    assert.ok(box.x >= groupBox.x - 1e-6 && box.y >= groupBox.y - 1e-6, "узел вне рамки группы");
    assert.ok(
      box.x + box.width <= groupBox.x + groupBox.width + 1e-6 &&
        box.y + box.height <= groupBox.y + groupBox.height + 1e-6,
      "узел вне рамки группы",
    );
  }
  // Рамка не во весь кадр — иначе маска раскрытия выезжала бы из-за края экрана.
  assert.ok(groupBox.width < format.width);
});

test("ungrouping leaves the picture where it was too", () => {
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const format = hd();
  const timing = sceneTiming(template.director, 5);
  const before = resolveNodeBox(a, template, format, timing, 2);

  const { template: grouped, groupId } = groupNodes(template, [a.id, b.id]);
  const loose = ungroupNode(grouped, groupId!);
  const after = resolveNodeBox(loose.nodes.find((n) => n.id === a.id)!, loose, format, timing, 2);
  assert.ok(Math.abs(after.x - before.x) < 1e-6, "роспуск утащил содержимое");
  assert.ok(Math.abs(after.y - before.y) < 1e-6, "роспуск утащил содержимое");
});

test("a group's frame follows its contents instead of living on its own", () => {
  // Собственный прямоугольник у группы стоял там, где его однажды растянули, а
  // содержимое ехало отдельно: обрезка резала по пустому месту, а маска
  // выезжала из-за края кадра, а не из-за края плашки.
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const { template: grouped, groupId } = groupNodes(template, [a.id, b.id]);

  const format = hd();
  const timing = sceneTiming(grouped.director, 5);
  const boxOf = (t: SceneTemplate, id: string) =>
    resolveNodeBox(t.nodes.find((n) => n.id === id)!, t, format, timing, 3);

  const before = boxOf(grouped, groupId!);
  const child = boxOf(grouped, a.id);
  assert.ok(before.x <= child.x + 1e-6 && before.y <= child.y + 1e-6, "рамка не обхватила ребёнка");
  assert.ok(before.width < format.width, "рамка группы во весь кадр");

  // Отодвинули ребёнка — рамка обязана поехать за ним.
  const widened = updateNode(grouped, a.id, (node) => ({
    ...node,
    transform: { ...node.transform, x: sceneTrack(node.transform.x.value + 0.2) },
  }));
  const after = boxOf(widened, groupId!);
  assert.ok(after.width > before.width, "рамка не пошла за содержимым");
});

test("dragging a group's handle scales its contents, not an unused width", () => {
  // Ширина группы не рисуется, и правка в неё растягивала бы рамку над
  // неподвижной картинкой.
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const { template: grouped, groupId } = groupNodes(template, [a.id, b.id]);

  const format = hd();
  const timing = sceneTiming(grouped.director, 5);
  const group = grouped.nodes.find((n) => n.id === groupId)!;
  const drawnPx = resolveNodeBox(group, grouped, format, timing, 3);
  const drawn = {
    x: drawnPx.x / format.width, y: drawnPx.y / format.height,
    width: drawnPx.width / format.width, height: drawnPx.height / format.height,
  };

  const stretched = applyBoxDrag(group, null, { dw: drawn.width * 0.5 }, drawn);
  assert.ok(stretched.transform.scale.value > 1, "масштаб не вырос");
  assert.equal(stretched.transform.width.value, group.transform.width.value, "правка ушла в ширину");
});

test("dragging a node into a group changes nesting, not its place in the frame", () => {
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const loner = createSceneNode(template, "ellipse"); template = addNode(template, loner);
  const { template: grouped, groupId } = groupNodes(template, [a.id, b.id]);

  const format = hd();
  const timing = sceneTiming(grouped.director, 5);
  const before = resolveNodeBox(loner, grouped, format, timing, 2);

  const inside = reparentNode(grouped, loner.id, groupId!);
  assert.equal(inside.nodes.find((n) => n.id === loner.id)?.parentId, groupId);
  const after = resolveNodeBox(inside.nodes.find((n) => n.id === loner.id)!, inside, format, timing, 2);
  assert.ok(Math.abs(after.x - before.x) < 1e-6, "перенос в группу сдвинул узел");
  assert.ok(Math.abs(after.y - before.y) < 1e-6, "перенос в группу сдвинул узел");

  // И обратно наружу — тем же способом.
  const out = reparentNode(inside, loner.id, null);
  assert.equal(out.nodes.find((n) => n.id === loner.id)?.parentId, null);
  const back = resolveNodeBox(out.nodes.find((n) => n.id === loner.id)!, out, format, timing, 2);
  assert.ok(Math.abs(back.x - before.x) < 1e-6, "вынос из группы сдвинул узел");
});

test("a group cannot be dropped into its own child", () => {
  // Кольцо в цепочке родителей увело бы раскладку в бесконечный обход.
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const loner = createSceneNode(template, "ellipse"); template = addNode(template, loner);
  const inner = groupNodes(template, [a.id, b.id]);
  const outer = groupNodes(inner.template, [inner.groupId!, loner.id]);
  assert.equal(
    reparentNode(outer.template, outer.groupId!, inner.groupId!),
    outer.template,
  );
});

test("moving a group moves its complete block in the layer stack", () => {
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const top = createSceneNode(template, "ellipse"); template = addNode(template, top);
  const grouped = groupNodes(template, [a.id, b.id]);

  const moved = moveNode(grouped.template, grouped.groupId!, null, top.id);
  const order = moved.nodes.map((node) => node.id);
  assert.deepEqual(order.slice(-3), [a.id, b.id, grouped.groupId]);
  assert.equal(order[0], top.id);
});

test("duplicating a group copies its contents and rebinds them to the copy", () => {
  // Копия пустого узла-родителя — не то, чего ждёт человек, нажавший
  // «дублировать» на собранной плашке.
  let template = blank();
  const plate = createSceneNode(template, "rect"); template = addNode(template, plate);
  const label = createSceneNode(template, "text"); template = addNode(template, label);
  template = updateNode(template, plate.id, (node) => ({
    ...node,
    fitToText: { nodeId: label.id, axis: "x", anchor: "grow", padX: 0.01, padY: 0.01 },
  }));
  const { template: grouped, groupId } = groupNodes(template, [plate.id, label.id]);

  const copied = duplicateNode(grouped, groupId!);
  assert.equal(copied.nodes.length, 6);
  const copyGroup = copied.nodes.find(
    (n) => n.kind === "group" && n.id !== groupId,
  )!;
  const children = copied.nodes.filter((n) => n.parentId === copyGroup.id);
  assert.equal(children.length, 2);
  // Привязка внутри группы ведёт на копию текста, а не на исходный узел:
  // иначе плашка копии тянулась бы по чужой строке.
  const copiedPlate = children.find((n) => n.kind === "rect")!;
  const copiedLabel = children.find((n) => n.kind === "text")!;
  assert.equal(copiedPlate.fitToText?.nodeId, copiedLabel.id);
  assert.notEqual(copiedLabel.id, label.id);
});

test("a wipe on a group becomes a reveal: its width is a clip frame, not a picture", () => {
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const { template: grouped, groupId } = groupNodes(template, [a.id, b.id]);
  const group = grouped.nodes.find((n) => n.id === groupId)!;

  const animated = applyPreset(group, "wipe", 0.6, 0.5);
  assert.equal(animated.transform.width.inKeyframes.length, 0);
  assert.ok(animated.transform.reveal.inKeyframes.length > 0);
});

test("a group's reveal clips its children without the container switch", () => {
  // Кнопка, которая ставит ключи и молча ничего не меняет, хуже отсутствующей.
  let template = blank();
  const a = createSceneNode(template, "rect"); template = addNode(template, a);
  const b = createSceneNode(template, "text"); template = addNode(template, b);
  const { template: grouped, groupId } = groupNodes(template, [a.id, b.id]);
  const opening = updateNode(grouped, groupId!, (node) =>
    applyPreset(node, "wipe", grouped.director.inSeconds, grouped.director.outSeconds));

  const format = hd();
  const timing = sceneTiming(opening.director, 5);
  const child = opening.nodes.find((n) => n.id === a.id)!;
  const half = containerClip(child, opening, format, timing, opening.director.inSeconds / 2);
  assert.ok(half, "раскрытие группы не режет содержимое");
  const whole = resolveNodeBox(
    opening.nodes.find((n) => n.id === groupId)!, opening, format, timing, 3,
  );
  assert.ok(half!.width < whole.width, "маска открыта целиком там, где вход ещё идёт");
  // На удержании маска открыта полностью и не режет ничего.
  assert.equal(containerClip(child, opening, format, timing, 3), null);
});

test("the reveal preset slides the picture out from under its own edge", () => {
  // «Раскрытие» — выезд, а не шторка: окно стоит рамкой узла, а картинка
  // выползает из-за её края. Шторка осталась «Развёрткой» — две разные
  // картинки под одной кнопкой оператор различить не смог бы.
  let template = blank();
  const plate = createSceneNode(template, "rect");
  template = addNode(template, plate);
  const opened = updateNode(template, plate.id, (node) =>
    applyPreset(node, "reveal", template.director.inSeconds, template.director.outSeconds));
  const node = opened.nodes[0]!;
  assert.equal(node.transform.revealMode, "slide");

  const format = hd();
  const timing = sceneTiming(opened.director, 5);
  const box = resolveNodeBox(node, opened, format, timing, opened.director.inSeconds / 2);
  // Рамка не сужается: режет она, а едет картинка.
  const clip = revealClip(node, box, timing, opened.director.inSeconds / 2)!;
  assert.ok(clip, "выезд не обрезал узел по его рамке");
  assert.ok(Math.abs(clip.width - box.width) < 1e-6, "выезд сузил рамку вместо картинки");
  const shift = revealShift(node, box, timing, opened.director.inSeconds / 2);
  assert.ok(shift.dx !== 0 || shift.dy !== 0, "картинка не поехала");
  // На удержании выезд закончился: ни обрезки, ни сдвига.
  assert.equal(revealClip(node, box, timing, 3), null);
  assert.deepEqual(revealShift(node, box, timing, 3), { dx: 0, dy: 0 });
});

test("a slide comes from the side its cut point sits on", () => {
  let template = blank();
  const plate = createSceneNode(template, "rect");
  template = addNode(template, plate);
  const slid = (originX: number) => {
    const node = { ...plate, transform: { ...plate.transform, revealMode: "slide" as const, revealOriginX: originX, reveal: { value: 0.5, inKeyframes: [], outKeyframes: [] } } };
    return revealShift(node, { width: 400, height: 100 }, sceneTiming(template.director, 5), 3).dx;
  };
  // Слева — картинка убрана влево и приезжает вправо; справа — наоборот.
  assert.ok(slid(0) < 0);
  assert.ok(slid(1) > 0);
  // Из середины выезжать некуда: остаётся проявление под маской.
  assert.equal(slid(0.5), 0);
});

test("moving the anchor leaves a following tail attached to the plate", () => {
  // Примыкание задаёт левый край хвоста правым краем источника, и от точки
  // отсчёта поворота оно зависеть не имеет права.
  let template = blank();
  const plate = createSceneNode(template, "rect"); template = addNode(template, plate);
  const tail = createSceneNode(template, "rect"); template = addNode(template, tail);
  template = updateNode(template, tail.id, (node) => ({
    ...node,
    fitToText: { nodeId: plate.id, axis: "x", anchor: "follow", padX: 0, padY: 0 },
  }));

  const format = hd();
  const timing = sceneTiming(template.director, 5);
  const before = resolveNodeBox(template.nodes[1]!, template, format, timing, 3);
  const moved = updateNode(template, tail.id, (node) =>
    setNodeAnchor(node, 1, 0.5, { width: before.width / format.width, height: before.height / format.height }));
  const after = resolveNodeBox(moved.nodes[1]!, moved, format, timing, 3);
  assert.ok(Math.abs(after.x - before.x) < 1e-6, "хвост оторвался от плашки");
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

test("an exit key reports its position on the whole-show timeline", () => {
  const timing = sceneTiming({ inSeconds: 1, outSeconds: 2 }, 10);
  assert.equal(absoluteKeyframeTime("in", 0.5, timing), 0.5);
  assert.equal(absoluteKeyframeTime("out", 0.5, timing), 8.5);
});

test("editing an animated property at another time creates the next keyframe", () => {
  let track = setKeyframe(sceneTrack(1), "in", 0, 1);
  track = editTrackAt(track, "in", 0.8, 0);
  assert.deepEqual(track.inKeyframes.map(({ atSeconds, value }) => ({ atSeconds, value })), [
    { atSeconds: 0, value: 1 },
    { atSeconds: 0.8, value: 0 },
  ]);
  assert.equal(editTrackAt(sceneTrack(1), "in", 0.8, 0).value, 0);
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

test("moving selected keyframes together does not overwrite either key", () => {
  let track = setKeyframe(sceneTrack(0), "in", 0.2, 2);
  track = setKeyframe(track, "in", 0.4, 4);
  track = moveKeyframes(track, "in", [
    { fromSeconds: 0.2, toSeconds: 0.4 },
    { fromSeconds: 0.4, toSeconds: 0.6 },
  ]);
  assert.deepEqual(track.inKeyframes.map(({ atSeconds, value }) => ({ atSeconds, value })), [
    { atSeconds: 0.4, value: 2 },
    { atSeconds: 0.6, value: 4 },
  ]);
});

test("a dragged keyframe snaps only to a nearby neighbour", () => {
  assert.deepEqual(snapKeyframeTime(0.48, [0.2, 0.5, 0.9], 0.03), { value: 0.5, snapped: true });
  assert.deepEqual(snapKeyframeTime(0.44, [0.2, 0.5, 0.9], 0.03), { value: 0.44, snapped: false });
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

/* --------------------------- точка привязки ------------------------------- */

test("moving the anchor does not move the node on screen", () => {
  // Дизайнер выбирает точку отсчёта, а не двигает элемент. Узел, уехавший
  // от смены привязки, — это не то, чего он ждёт.
  const node = createSceneNode(blank(), "rect");
  const format = hd();
  const timing = sceneTiming(blank().director, 5);
  const before = resolveNodeBox(node, { ...blank(), nodes: [node] }, format, timing, 2);

  const box = { width: node.transform.width.value, height: node.transform.height.value };
  const moved = setNodeAnchor(node, 0.5, 0.5, box);
  const after = resolveNodeBox(moved, { ...blank(), nodes: [moved] }, format, timing, 2);

  assert.ok(Math.abs(after.x - before.x) < 1e-9, "узел уехал по горизонтали");
  assert.ok(Math.abs(after.y - before.y) < 1e-9, "узел уехал по вертикали");
  assert.equal(moved.transform.anchorX, 0.5);
  assert.equal(moved.transform.anchorY, 0.5);
});

test("the anchor compensation follows the drawn width, not the base value", () => {
  // У плашки, привязанной к тексту, ширина считается по тексту: поправка от
  // базового значения увела бы её тем дальше, чем длиннее заголовок.
  const node = createSceneNode(blank(), "rect");
  const wide = setNodeAnchor(node, 1, 0, { width: 0.8, height: 0.14 });
  const narrow = setNodeAnchor(node, 1, 0, { width: 0.2, height: 0.14 });
  assert.ok(
    wide.transform.x.value - node.transform.x.value >
    narrow.transform.x.value - node.transform.x.value,
  );
});

test("moving the anchor of an animated node carries the whole track", () => {
  const node = applyPreset(createSceneNode(blank(), "text"), "slide-left", 0.6, 0.5);
  const keys = node.transform.x.inKeyframes.map((key) => key.value);
  const moved = setNodeAnchor(node, 0.5, 0, { width: 0.36, height: 0.08 });
  const shift = moved.transform.x.value - node.transform.x.value;
  assert.deepEqual(
    moved.transform.x.inKeyframes.map((key) => key.value),
    keys.map((value) => value + shift),
    "ключи не поехали за привязкой — анимация оторвалась",
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

/* ------------------------------ контейнер --------------------------------- */

test("a container takes its size from the plate, not from the frame", () => {
  let template = blank();
  const plate = { ...createSceneNode(template, "rect"), id: "plate", name: "Подложка" };
  const label = { ...createSceneNode(template, "text"), id: "label", name: "Надпись" };
  template = addNode(addNode(template, plate), label);
  const grouped = groupNodes(template, ["plate", "label"]);
  assert.ok(grouped.groupId, "группа не создана");
  template = setGroupContainer(grouped.template, grouped.groupId, "plate");
  const container = template.nodes.find((node) => node.id === grouped.groupId);
  assert.equal(container?.fitToNodeId, "plate");
  assert.equal(container?.clipsChildren, true, "контейнер обязан резать содержимое");

  const timing = sceneTiming(template.director, 4);
  const plateBox = resolveNodeBox(
    template.nodes.find((node) => node.id === "plate")!, template, hd(), timing, 2,
  );
  const clip = containerClip(
    template.nodes.find((node) => node.id === "label")!, template, hd(), timing, 2,
  );
  assert.ok(clip, "ребёнок не получил обрезки");
  assert.ok(Math.abs(clip.width - plateBox.width) < 1e-6, "ширина не с подложки");
  assert.ok(Math.abs(clip.height - plateBox.height) < 1e-6, "высота не с подложки");
});

test("revealing the container hides its children, not just itself", () => {
  let template = blank();
  const plate = { ...createSceneNode(template, "rect"), id: "plate", name: "Подложка" };
  const label = { ...createSceneNode(template, "text"), id: "label", name: "Надпись" };
  template = addNode(addNode(template, plate), label);
  const grouped = groupNodes(template, ["plate", "label"]);
  const groupId = grouped.groupId!;
  template = setGroupContainer(grouped.template, groupId, "plate");
  template = updateNode(template, groupId, (node) => ({
    ...node,
    transform: {
      ...node.transform,
      // Шторка задана явно: у контейнера проверяется именно растущее окно.
      revealMode: "wipe",
      reveal: {
        value: 1,
        inKeyframes: [
          { atSeconds: 0, value: 0, easing: "linear" },
          { atSeconds: 1, value: 1, easing: "linear" },
        ],
        outKeyframes: [],
      },
      revealOriginX: 0,
    },
  }));

  const timing = sceneTiming(template.director, 4);
  const child = template.nodes.find((node) => node.id === "label")!;
  const closed = containerClip(child, template, hd(), timing, 0);
  const open = containerClip(child, template, hd(), timing, timing.inSeconds);
  assert.ok(closed, "закрытый контейнер не режет");
  assert.ok(open, "раскрытый контейнер не режет");
  assert.ok(closed.width < open.width, "раскрытие не расширяет окно для детей");
  assert.ok(closed.width < 1e-6, "в начале входа контейнер обязан быть закрыт");
});

test("dropping the source node makes the group stop clipping", () => {
  let template = blank();
  const plate = { ...createSceneNode(template, "rect"), id: "plate", name: "Подложка" };
  const label = { ...createSceneNode(template, "text"), id: "label", name: "Надпись" };
  template = addNode(addNode(template, plate), label);
  const grouped = groupNodes(template, ["plate", "label"]);
  const groupId = grouped.groupId!;
  template = setGroupContainer(grouped.template, groupId, "plate");
  template = setGroupContainer(template, groupId, null);
  const after = template.nodes.find((node) => node.id === groupId);
  assert.equal(after?.fitToNodeId, null);
  assert.equal(after?.clipsChildren, false, "без источника резать нечем");
});

/* --------------------------- появления текста ----------------------------- */

test("every text preset is switched on and distinct", () => {
  assert.ok(textAnimatorPresets.length >= 5, "набор слишком мал, чтобы им пользоваться");
  const seen = new Set<string>();
  for (const preset of textAnimatorPresets) {
    assert.equal(preset.animator.enabled, true, `${preset.nameEn} выключён`);
    const signature = [
      preset.animator.unit, preset.animator.effect, preset.animator.direction,
    ].join("/");
    assert.ok(!seen.has(signature), `${preset.nameEn} повторяет другой набор`);
    seen.add(signature);
    assert.ok(preset.animator.stagger > 0, `${preset.nameEn} без разноса — это не волна`);
  }
});

/* ------------------------------ точка среза ------------------------------- */

test("the reveal cut point rides along with the anchor", () => {
  const node = createSceneNode(blank(), "rect");
  const moved = setNodeAnchor(node, 1, 0.5, { width: 0.4, height: 0.1 });
  assert.equal(moved.transform.revealOriginX, 1, "срез не поехал за привязкой");
  assert.equal(moved.transform.revealOriginY, 0.5);
});

test("moving the anchor re-syncs a cut point left over from an older template", () => {
  // У шаблонов прежних версий срез стоит по старому умолчанию, а не на
  // привязке. Проверка «не увели ли его вручную» молча не сработала бы ровно
  // там, где перенос привязки и нужен.
  const node = createSceneNode(blank(), "rect");
  const legacy = setRevealOrigin(node, 0, 0.5);
  const moved = setNodeAnchor(legacy, 1, 1, { width: 0.4, height: 0.1 });
  assert.equal(moved.transform.revealOriginX, 1);
  assert.equal(moved.transform.revealOriginY, 1);
});

test("the cut point can still be moved on its own after the anchor", () => {
  const node = createSceneNode(blank(), "rect");
  const moved = setNodeAnchor(node, 1, 1, { width: 0.4, height: 0.1 });
  const bespoke = setRevealOrigin(moved, 0.5, 0);
  assert.equal(bespoke.transform.revealOriginX, 0.5);
  assert.equal(bespoke.transform.revealOriginY, 0);
  assert.equal(bespoke.transform.anchorX, 1, "привязку трогать не должно");
  assert.equal(bespoke.transform.anchorY, 1);
});

test("a reveal from the point opens both sides at once", () => {
  let node = createSceneNode(blank(), "rect");
  node = setRevealOrigin(node, 0.5, 0.5);
  node = {
    ...node,
    transform: {
      ...node.transform,
      revealAxis: "point",
      revealMode: "wipe",
      reveal: {
        value: 1,
        inKeyframes: [
          { atSeconds: 0, value: 0, easing: "linear" },
          { atSeconds: 1, value: 1, easing: "linear" },
        ],
        outKeyframes: [],
      },
    },
  };
  const timing = sceneTiming({ inSeconds: 1, outSeconds: 1 }, 4);
  const box = { x: 0.2, y: 0.4, width: 0.4, height: 0.2 };
  const half = revealClip(node, box, timing, 0.5);
  assert.ok(half, "маска не наложилась");
  assert.ok(Math.abs(half.width - 0.2) < 1e-6, "ширина не половинная");
  assert.ok(Math.abs(half.height - 0.1) < 1e-6, "высота обязана открываться тоже");
  // Из середины — в обе стороны: центр маски совпадает с центром узла.
  assert.ok(Math.abs(half.x + half.width / 2 - (box.x + box.width / 2)) < 1e-6);
  assert.ok(Math.abs(half.y + half.height / 2 - (box.y + box.height / 2)) < 1e-6);
});

test("a reveal by width keeps the full height", () => {
  let node = createSceneNode(blank(), "rect");
  node = setRevealOrigin(node, 0, 0);
  node = {
    ...node,
    transform: {
      ...node.transform,
      revealAxis: "x",
      reveal: {
        value: 1,
        inKeyframes: [
          { atSeconds: 0, value: 0, easing: "linear" },
          { atSeconds: 1, value: 1, easing: "linear" },
        ],
        outKeyframes: [],
      },
    },
  };
  const timing = sceneTiming({ inSeconds: 1, outSeconds: 1 }, 4);
  const box = { x: 0.2, y: 0.4, width: 0.4, height: 0.2 };
  const half = revealClip(node, box, timing, 0.5);
  assert.ok(half);
  assert.ok(Math.abs(half.height - box.height) < 1e-6, "полоса плашки обязана остаться во всю высоту");
  assert.ok(Math.abs(half.x - box.x) < 1e-6, "маска растёт не от левого края");
});

test("moving a group anchor does not drag its contents across the frame", () => {
  let template = blank();
  const plate = { ...createSceneNode(template, "rect"), id: "plate", name: "Подложка" };
  const label = { ...createSceneNode(template, "text"), id: "label", name: "Надпись" };
  template = addNode(addNode(template, plate), label);
  const grouped = groupNodes(template, ["plate", "label"]);
  const groupId = grouped.groupId!;
  template = setGroupContainer(grouped.template, groupId, "plate");
  const group = template.nodes.find((node) => node.id === groupId)!;

  const before = { x: group.transform.x.value, y: group.transform.y.value };
  const moved = setNodeAnchor(group, 1, 1, { width: 0.4, height: 0.1 });
  assert.equal(moved.transform.anchorX, 1, "привязка не переехала");
  assert.equal(moved.transform.revealOriginX, 1, "срез не поехал за привязкой");
  // Сдвиг группы складывается с детьми: поправка утащила бы всё содержимое.
  assert.equal(moved.transform.x.value, before.x, "группа уехала по горизонтали");
  assert.equal(moved.transform.y.value, before.y, "группа уехала по вертикали");
});
