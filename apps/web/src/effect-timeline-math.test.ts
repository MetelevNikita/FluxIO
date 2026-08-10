import assert from "node:assert/strict";
import test from "node:test";
import { moveEffectLayerWindow } from "./effect-timeline-math.js";

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
