import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduleTimeline } from "./schedule-timeline.js";
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
