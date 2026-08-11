import assert from "node:assert/strict";
import test from "node:test";
import { mediaRequestTimeoutMs } from "./media-request-timeout.js";

test("weekly playout preparation does not inherit the ten-second API timeout", () => {
  assert.equal(mediaRequestTimeoutMs("/api/playout/start"), 30 * 60_000);
  assert.equal(mediaRequestTimeoutMs("/api/playout/take"), 30 * 60_000);
  assert.equal(mediaRequestTimeoutMs("/api/media/probe"), 10 * 60_000);
  assert.equal(mediaRequestTimeoutMs("/api/playout/status"), 10_000);
});
