import assert from "node:assert/strict";
import test from "node:test";
import { airDurationSeconds } from "./clip-duration.js";

test("air duration is the shorter of the file and the schedule", () => {
  assert.equal(airDurationSeconds({ declaredDurationSeconds: 90, durationSeconds: 120 }), 90);
  assert.equal(airDurationSeconds({ declaredDurationSeconds: 150, durationSeconds: 120 }), 120);
});

test("a clip whose file is not analysed yet keeps its scheduled duration", () => {
  // Ноль означает «файл ещё не разобран», а не «ролик нулевой длины». Раньше
  // Math.min давал ноль, и всё, что отсчитывается от конца ролика, уезжало
  // в самое начало.
  assert.equal(airDurationSeconds({ declaredDurationSeconds: 3_600, durationSeconds: 0 }), 3_600);
});

test("without a schedule the analysed file wins, and an empty clip stays zero", () => {
  assert.equal(airDurationSeconds({ declaredDurationSeconds: null, durationSeconds: 42 }), 42);
  assert.equal(airDurationSeconds({ durationSeconds: 42 }), 42);
  assert.equal(airDurationSeconds({ declaredDurationSeconds: 0, durationSeconds: 0 }), 0);
});
