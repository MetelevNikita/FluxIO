import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLottiePropertyOverrides,
  updateLinkedScaleVector,
} from "./lottie-properties.js";

test("linked Lottie scale keeps X and Y together without changing Z", () => {
  assert.deepEqual(updateLinkedScaleVector([100, 90, 75], 0, 125, true), [125, 125, 75]);
  assert.deepEqual(updateLinkedScaleVector([100, 90, 75], 1, 80, false), [100, 80, 75]);
});

test("live Lottie preview applies an escaped Essential Graphics text slot path", () => {
  const source = {
    slots: {
      "Programme/Title": {
        p: { k: [{ s: { t: "Before" }, t: 0 }] },
      },
    },
  };
  const result = applyLottiePropertyOverrides(source, [{
    animated: false,
    group: "Title · Slot Programme/Title",
    id: "slot-title",
    label: "Text",
    overridden: true,
    textBox: null,
    fitSample: null,
    path: "/slots/Programme~1Title/p/k/0/s/t",
    type: "text",
    value: "After",
  }]);
  const text = (((((result.slots as Record<string, unknown>)["Programme/Title"] as Record<string, unknown>)
    .p as Record<string, unknown>).k as Array<{ s: { t: string } }>)[0]!.s.t);
  assert.equal(text, "After");
});
