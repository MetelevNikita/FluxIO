import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduleTimeline, scheduleCatchUpPoint } from "./schedule-timeline.js";
import type { MediaAsset, ScheduleMetadata } from "./types.js";

test("schedule timeline anchors current rundown to Monday and crosses midnight", () => {
  const timeline = buildScheduleTimeline(
    [asset("one", 1_800), asset("two", 43_200), asset("three", 60)],
    metadata("2026-08-03", "12:00:00.00", 0),
    "current",
  );

  assert.deepEqual(
    timeline.map(({ startTime, dayLabel, dateLabel, startsNewDay }) => ({
      startTime,
      dayLabel,
      dateLabel,
      startsNewDay,
    })),
    [
      { startTime: "12:00:00", dayLabel: "Понедельник", dateLabel: "03.08.2026", startsNewDay: true },
      { startTime: "12:30:00", dayLabel: "Понедельник", dateLabel: "03.08.2026", startsNewDay: false },
      { startTime: "00:30:00", dayLabel: "Вторник", dateLabel: "04.08.2026", startsNewDay: true },
    ],
  );
});

test("schedule timeline includes schedule delay in the first on-air time", () => {
  const [entry] = buildScheduleTimeline(
    [asset("delayed", 10)],
    metadata("2026-08-10", "12:00:00.00", 5),
    "future",
  );
  assert.equal(entry?.startTime, "12:00:05");
  assert.equal(entry?.dayLabel, "Понедельник");
});

test("catch-up point answers where the schedule would be right now", () => {
  // 12:00 старт, ролики по получасу; сейчас 13:10 — идёт третий, 10 минут его.
  const point = scheduleCatchUpPoint(
    [asset("one", 1_800), asset("two", 1_800), asset("three", 1_800)],
    metadata("2026-08-03", "12:00:00.00", 0),
    "current",
    new Date(2026, 7, 3, 13, 10, 0),
  );
  assert.equal(point?.assetId, "three");
  assert.equal(point?.itemIndex, 2);
  assert.equal(Math.round(point?.itemOffsetSeconds ?? -1), 600);
});

test("catch-up point counts the schedule delay before the first clip", () => {
  const point = scheduleCatchUpPoint(
    [asset("one", 600)],
    metadata("2026-08-03", "12:00:00.00", 60),
    "current",
    new Date(2026, 7, 3, 12, 2, 0),
  );
  assert.equal(point?.assetId, "one");
  assert.equal(Math.round(point?.itemOffsetSeconds ?? -1), 60);
});

test("catch-up point is empty before the start and after the end of the schedule", () => {
  const playlist = [asset("one", 600)];
  const early = scheduleCatchUpPoint(
    playlist, metadata("2026-08-03", "12:00:00.00", 0), "current",
    new Date(2026, 7, 3, 11, 59, 0),
  );
  const late = scheduleCatchUpPoint(
    playlist, metadata("2026-08-03", "12:00:00.00", 0), "current",
    new Date(2026, 7, 3, 12, 30, 0),
  );
  assert.equal(early, null);
  assert.equal(late, null);
});

test("catch-up point never lands on the last hundredth of a clip", () => {
  const point = scheduleCatchUpPoint(
    [asset("one", 600), asset("two", 600)],
    metadata("2026-08-03", "12:00:00.00", 0),
    "current",
    // 12:09:59.99 — конец первого ролика: подъём обязан остаться в нём, но не
    // в последних сотых, иначе в линию уйдёт обрывок вместо передачи.
    new Date(2026, 7, 3, 12, 9, 59, 990),
  );
  assert.equal(point?.assetId, "one");
  assert.ok((point?.itemOffsetSeconds ?? 0) <= 600 - 0.04);
});

test("catch-up point uses the declared duration, like the rundown does", () => {
  // Ролик из импортированного расписания: длительность файла ещё не известна,
  // а объявленная в расписании — известна.
  const declared: MediaAsset = { ...asset("one", 0), declaredDurationSeconds: 1_800 };
  const point = scheduleCatchUpPoint(
    [declared, asset("two", 600)],
    metadata("2026-08-03", "12:00:00.00", 0),
    "current",
    new Date(2026, 7, 3, 12, 20, 0),
  );
  assert.equal(point?.assetId, "one");
  assert.equal(Math.round(point?.itemOffsetSeconds ?? -1), 1_200);
});

test("a schedule row without its file shifts everything below it earlier", () => {
  // Ролик, файла которого нет, эфирного времени не занимает: следующая
  // передача выходит на его месте, а не после него.
  const missing: MediaAsset = { ...asset("gone", 600), status: "error" };
  const timeline = buildScheduleTimeline(
    [asset("one", 600), missing, asset("three", 600)],
    metadata("2026-08-03", "12:00:00.00", 0),
    "current",
  );
  assert.deepEqual(timeline.map((entry) => entry.startTime), [
    "12:00:00",
    "12:10:00",
    "12:10:00",
  ]);

  // По часам догон тоже идёт мимо пропавшего ролика.
  const point = scheduleCatchUpPoint(
    [asset("one", 600), missing, asset("three", 600)],
    metadata("2026-08-03", "12:00:00.00", 0),
    "current",
    new Date(2026, 7, 3, 12, 15, 0),
  );
  assert.equal(point?.assetId, "three");
});

function asset(id: string, durationSeconds: number): MediaAsset {
  return {
    id,
    name: `${id}.mp4`,
    duration: "00:00:00:00",
    durationSeconds,
    codec: "H.264",
    codecFamily: "H.264",
    codecProfile: "High",
    resolution: "1920x1080",
    fps: "25",
    bitrate: "10.5 Mbps",
    size: "1 MB",
    status: "analyzed",
    preview: "preview.png",
    filePath: `/${id}.mp4`,
    colorSpace: "BT.709",
    audio: "MP2",
    sha256: id,
  };
}

function metadata(anchorDate: string, startTime: string, delaySeconds: number): ScheduleMetadata {
  return {
    anchorDate,
    delaySeconds,
    encoding: "utf-8",
    sourceFilePath: "/schedule.air",
    sourceName: "schedule.air",
    startTime,
    targetDurationSeconds: 604_800,
    warnings: [],
  };
}
