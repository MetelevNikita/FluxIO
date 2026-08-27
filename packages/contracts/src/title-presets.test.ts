import assert from "node:assert/strict";
import test from "node:test";
import { builtInTitlePresets } from "./title-presets.js";
import { sceneFormatSchema, type SceneFormat } from "./scene.js";
import { resolveNodeBox, sceneTiming } from "./scene-timing.js";

const hd: SceneFormat = sceneFormatSchema.parse({
  layout: "hd", width: 1_920, height: 1_080, drawRate: 25, scan: "progressive",
});

/** Зона надписей по EBU R 95: за ней приёмник зрителя режет. */
const titleSafe = 0.05;

test("the set ships six titles with distinct ids and names", () => {
  const presets = builtInTitlePresets();
  assert.equal(presets.length, 6);
  assert.equal(new Set(presets.map((preset) => preset.id)).size, 6);
  assert.equal(new Set(presets.map((preset) => preset.name)).size, 6);
});

test("every node id inside a preset is unique", () => {
  // Два узла с одним id — это потерянная привязка подложки к тексту, и
  // заметно это только в эфире.
  for (const preset of builtInTitlePresets()) {
    const ids = preset.nodes.map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length, `${preset.name}: id узлов повторяются`);
  }
});

test("every text bound to a field has that field declared with a sample", () => {
  for (const preset of builtInTitlePresets()) {
    const keys = new Set(preset.fields.map((field) => field.key));
    for (const node of preset.nodes) {
      if (node.text?.kind !== "field") continue;
      assert.ok(keys.has(node.text.fieldKey), `${preset.name}: поле ${node.text.fieldKey} не объявлено`);
    }
    for (const field of preset.fields) {
      // Без образца привязанной подложке нечем мерить ширину.
      assert.ok(field.sample.length > 0, `${preset.name}: у поля ${field.key} нет образца`);
    }
  }
});

test("every binding points at a node of the same preset and never at itself", () => {
  for (const preset of builtInTitlePresets()) {
    const ids = new Set(preset.nodes.map((node) => node.id));
    const textIds = new Set(preset.nodes.filter((node) => node.kind === "text").map((node) => node.id));
    for (const node of preset.nodes) {
      if (!node.fitToText) continue;
      assert.ok(ids.has(node.fitToText.nodeId), `${preset.name}: «${node.name}» ссылается в никуда`);
      assert.notEqual(node.fitToText.nodeId, node.id, `${preset.name}: «${node.name}» привязан сам к себе`);
      // Растянуться по тексту можно только по текстовому узлу; примыкать
      // к правому краю — к любому, в том числе к подложке.
      if (node.fitToText.anchor === "grow") {
        assert.ok(
          textIds.has(node.fitToText.nodeId),
          `${preset.name}: «${node.name}» тянется не по текстовому узлу`,
        );
      }
    }
  }
});

test("a follow chain resolves and does not loop", () => {
  // Кольцо «A следует за B, B за A» повесило бы расчёт кадра посреди эфира.
  for (const preset of builtInTitlePresets()) {
    for (const node of preset.nodes) {
      const seen = new Set<string>([node.id]);
      let current = node;
      while (current.fitToText?.anchor === "follow") {
        const next = preset.nodes.find((entry) => entry.id === current.fitToText?.nodeId);
        if (!next) break;
        assert.ok(!seen.has(next.id), `${preset.name}: кольцо привязок у «${node.name}»`);
        seen.add(next.id);
        current = next;
      }
    }
  }
});

test("nothing sits outside the title-safe area at rest", () => {
  // Собранная с нуля плашка почти всегда оказывается за зоной надписей —
  // поставляемый набор обязан быть образцом, а не тем же граблями.
  for (const preset of builtInTitlePresets()) {
    const timing = sceneTiming(preset.director, 6);
    // Момент удержания: вход и выход намеренно выводят элементы за край.
    const at = timing.inSeconds + timing.holdSeconds / 2;
    for (const node of preset.nodes) {
      const box = resolveNodeBox(node, preset, hd, timing, at);
      const left = box.x / hd.width;
      const top = box.y / hd.height;
      const right = (box.x + box.width) / hd.width;
      const bottom = (box.y + box.height) / hd.height;
      assert.ok(left >= titleSafe - 1e-6, `${preset.name}/${node.name}: левый край ${left.toFixed(3)}`);
      assert.ok(top >= titleSafe - 1e-6, `${preset.name}/${node.name}: верх ${top.toFixed(3)}`);
      assert.ok(right <= 1 - titleSafe + 1e-6, `${preset.name}/${node.name}: правый край ${right.toFixed(3)}`);
      assert.ok(bottom <= 1 - titleSafe + 1e-6, `${preset.name}/${node.name}: низ ${bottom.toFixed(3)}`);
    }
  }
});

test("an exit starts where the entrance ended, so nothing jumps", () => {
  for (const preset of builtInTitlePresets()) {
    for (const node of preset.nodes) {
      for (const [name, track] of Object.entries(node.transform)) {
        if (typeof track !== "object" || track === null || !("inKeyframes" in track)) continue;
        const entrance = track.inKeyframes.at(-1);
        const exit = track.outKeyframes.at(0);
        if (!entrance || !exit) continue;
        assert.ok(
          Math.abs(entrance.value - exit.value) < 1e-9,
          `${preset.name}/${node.name}/${name}: выход начинается не там, где кончился вход`,
        );
      }
    }
  }
});

test("every preset animates: a title that just appears reads as a glitch", () => {
  for (const preset of builtInTitlePresets()) {
    assert.ok(preset.director.inSeconds > 0, `${preset.name}: нет входа`);
    assert.ok(preset.director.outSeconds > 0, `${preset.name}: нет выхода`);
    const animated = preset.nodes.some((node) =>
      Object.values(node.transform).some((track) =>
        typeof track === "object" && track !== null && "inKeyframes" in track &&
        (track.inKeyframes.length > 0 || track.outKeyframes.length > 0)));
    assert.ok(animated, `${preset.name}: ни один узел не анимирован`);
  }
});

test("the set is stable between calls, so it can be compared and shipped", () => {
  assert.deepEqual(builtInTitlePresets(), builtInTitlePresets());
});
