import assert from "node:assert/strict";
import test from "node:test";
import { moveEffectLayerWindow, removeEffectLayerById } from "./effect-timeline-math.js";

test("effect layer drag preserves duration and clamps to both clip edges", () => {
  assert.deepEqual(
    moveEffectLayerWindow({
      deltaSeconds: 3,
      durationSeconds: 20,
      endSeconds: 7,
      startSeconds: 2,
    }),
    { startSeconds: 5, endSeconds: 10 },
  );
  assert.deepEqual(
    moveEffectLayerWindow({
      deltaSeconds: -10,
      durationSeconds: 20,
      endSeconds: 7,
      startSeconds: 2,
    }),
    { startSeconds: 0, endSeconds: 5 },
  );
  assert.deepEqual(
    moveEffectLayerWindow({
      deltaSeconds: 50,
      durationSeconds: 20,
      endSeconds: 7,
      startSeconds: 2,
    }),
    { startSeconds: 15, endSeconds: 20 },
  );
});

test("removing one assigned FX keeps the remaining layer order", () => {
  const layers = [
    { id: "lower", name: "Lower third" },
    { id: "title", name: "Title" },
    { id: "bug", name: "Corner bug" },
  ];
  assert.deepEqual(removeEffectLayerById(layers, "title"), [layers[0], layers[2]]);
  assert.deepEqual(layers.map((layer) => layer.id), ["lower", "title", "bug"]);
});
