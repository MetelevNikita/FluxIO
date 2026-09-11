import assert from "node:assert/strict";
import test from "node:test";
import type { PlayoutStatus } from "@gruber/contracts";
import { statusBarView } from "./status-bar.js";

test("остановленный эфир не выглядит идущим, даже если служба помнит последний ролик", () => {
  // Служба после остановки оставляет поля последней сессии: с ними строка
  // рисовала «×1.00 скорость» и отсчёт у станции, которая стоит.
  const stopped = statusBarView(status({ state: "idle" }));
  assert.equal(stopped.onAir, false);
  assert.equal(stopped.clipName, null);
  assert.equal(stopped.lastClipName, "chop — test programme.mp4");
  assert.equal(stopped.progressPercent, 0);
  assert.equal(stopped.remainingSeconds, null);
  assert.equal(stopped.speed, null);
  // Упавший и доигравший эфир — тоже не эфир.
  assert.equal(statusBarView(status({ state: "failed" })).speed, null);
  assert.equal(statusBarView(status({ state: "completed" })).onAir, false);
  assert.equal(statusBarView(null).onAir, false);
});

test("идущий эфир показывает ролик, прогресс, остаток и скорость", () => {
  const live = statusBarView(status({ state: "running" }));
  assert.equal(live.onAir, true);
  assert.equal(live.clipName, "chop — test programme.mp4");
  assert.equal(live.progressPercent, 18.8);
  assert.equal(live.remainingSeconds, 29);
  assert.equal(live.speed, 1);
});

function status(patch: Partial<PlayoutStatus>): PlayoutStatus {
  return {
    state: "running",
    currentItemName: "chop — test programme.mp4",
    progressPercent: 18.8,
    totalDurationSeconds: 36,
    outTimeSeconds: 7,
    speed: 1,
    ...patch,
  } as PlayoutStatus;
}
