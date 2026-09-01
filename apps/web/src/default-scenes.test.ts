import assert from "node:assert/strict";
import test from "node:test";
import { sceneTemplateSchema } from "@gruber/contracts";
import { defaultSceneTemplate, editableSceneTemplate } from "./default-scenes.js";

const sceneKinds = ["dynamic-title", "next-program", "clock-countdown", "ticker-crawl"] as const;

function savedTitle(id: string) {
  return sceneTemplateSchema.parse({
    id,
    name: "Плашка канала",
    targets: ["hd"],
    director: { inSeconds: 0.5, outSeconds: 0.5 },
    fields: [],
    nodes: [],
  });
}

test("a saved title opens again, or the effect on air has nothing left to edit it with", () => {
  const saved = savedTitle("scene-2f7a1c");

  for (const kind of sceneKinds) {
    assert.equal(editableSceneTemplate(kind, saved), saved);
  }
});

test("the factory design still opens a blank canvas: the operator has not touched it", () => {
  const english = (_russian: string, value: string) => value;

  for (const kind of sceneKinds) {
    const factory = defaultSceneTemplate(kind);
    assert.ok(factory);
    assert.equal(editableSceneTemplate(kind, factory), null);
    // Опознаватель плашки собран из переведённого названия: эффект, созданный
    // на английском интерфейсе, — та же заводская сцена.
    const translated = defaultSceneTemplate(kind, english);
    assert.ok(translated);
    assert.equal(editableSceneTemplate(kind, translated), null);
  }
});

test("a kind with no factory design keeps whatever scene it was given", () => {
  const saved = savedTitle("scene-9c1");

  assert.equal(defaultSceneTemplate("stinger-transition"), null);
  assert.equal(editableSceneTemplate("stinger-transition", null), null);
  assert.equal(editableSceneTemplate("stinger-transition", saved), saved);
});
