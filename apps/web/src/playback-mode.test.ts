import assert from "node:assert/strict";
import test from "node:test";
import type { StartPlayoutRequest } from "@gruber/contracts";
import {
  applyPlaybackDraft,
  formatClockDuration,
  playbackDraftFrom,
  playbackStart,
  playbackWindow,
  withPlaybackMode,
} from "./playback-mode.js";
import type { MediaAsset, ScheduleMetadata } from "./types.js";

// Понедельник, 07.09.2026 09:50 — неделя, которую оператор выставил в окне.
const weekStart = new Date(2026, 8, 7, 9, 50);
const hours = (value: number) => value * 3_600_000;

test("недельное поднимается только с того места, что идёт сейчас по часам", () => {
  // Суть режима: зритель ждёт передачу в своё время, и старт «с любого места»
  // дал бы эфир, сдвинутый до конца недели.
  const playlist = [clip("a", 3_600), clip("b", 3_600), clip("c", 3_600)];
  const gate = playbackStart(playlist, weekly(), "current", new Date(weekStart.getTime() + hours(1.5)));
  assert.equal(gate.kind, "on-air");
  if (gate.kind === "on-air") {
    assert.equal(gate.point.assetId, "b");
    assert.equal(gate.point.itemOffsetSeconds, 1_800);
  }
});

test("до начала недели и после её конца эфир не поднимается", () => {
  const playlist = [clip("a", 3_600)];
  assert.equal(playbackStart(playlist, weekly(), "current", new Date(weekStart.getTime() - 60_000)).kind, "not-started");
  // Ровно через неделю в то же время неделя уже кончилась.
  assert.equal(playbackStart(playlist, weekly(), "current", new Date(2026, 8, 14, 9, 50)).kind, "ended");
  // Неделя идёт, а ролики кончились раньше: поднимать эфир не с чего.
  assert.equal(playbackStart(playlist, weekly(), "current", new Date(weekStart.getTime() + hours(5))).kind, "schedule-short");
});

test("у планируемого начало и конец задают время, которое эфир обязан заполнить", () => {
  const metadata = planned();
  assert.equal(metadata.targetDurationSeconds, 8 * 3_600);
  const { startsAt, endsAt } = playbackWindow(metadata, "current");
  assert.deepEqual([startsAt.getHours(), endsAt.getHours()], [10, 18]);

  // Старт с любого ролика и в любой момент до конца — ограничений нет.
  const playlist = [clip("a", 3_600)];
  assert.equal(playbackStart(playlist, metadata, "current", new Date(2026, 8, 7, 9, 0)).kind, "any-clip");
  assert.equal(playbackStart(playlist, metadata, "current", new Date(2026, 8, 7, 12, 0)).kind, "any-clip");
  // После конца план уже не заполнить.
  assert.equal(playbackStart(playlist, metadata, "current", new Date(2026, 8, 7, 18, 0)).kind, "ended");
});

test("эфир кончается в конце окна, а не через «столько-то» от старта", () => {
  const request = { repeatPlaylist: false, scheduleDurationSeconds: 604_800 } as StartPlayoutRequest;

  const free = withPlaybackMode(request, { ...weekly(), playbackMode: "free" });
  assert.equal(free.repeatPlaylist, true);
  assert.equal(free.scheduleDurationSeconds, null);

  // Опоздали на полчаса — эфир всё равно кончится в 18:00, в заданный конец:
  // дальше идёт следующая программа.
  const late = withPlaybackMode(request, planned(), "current", new Date(2026, 8, 7, 10, 30));
  assert.equal(late.repeatPlaylist, false);
  assert.equal(late.scheduleDurationSeconds, 7.5 * 3_600);

  // Недельное — до конца недели от этой минуты: два дня прошло, пять осталось.
  const wednesday = withPlaybackMode(request, weekly(), "current", new Date(weekStart.getTime() + hours(48)));
  assert.equal(wednesday.scheduleDurationSeconds, 5 * 86_400);

  // Форма не выбрана — запрос не трогается: повтор решает кнопка «Повтор».
  assert.equal(withPlaybackMode(request, { ...weekly(), playbackMode: undefined }), request);
});

test("конец недели — то же время суток через семь дней", () => {
  const metadata = applyPlaybackDraft(null, {
    mode: "weekly", startDate: "2026-09-07", startTime: "09:50", endDate: "", endTime: "",
  });
  assert.equal(metadata.startTime, "09:50:00.00");
  assert.equal(metadata.targetDurationSeconds, 604_800);
  const { endsAt } = playbackWindow(metadata, "current");
  assert.deepEqual([endsAt.getDate(), endsAt.getMonth(), endsAt.getHours(), endsAt.getMinutes()], [14, 8, 9, 50]);
  // У списка без расписания метаданные заводятся вместе с формой: иначе её
  // негде хранить, и после перезапуска она терялась бы.
  assert.equal(metadata.sourceFilePath, "");
});

test("окно открывается с формы, которую подсказывает само расписание", () => {
  const playlist = [clip("a", 5_400), clip("b", 1_800)];

  // Расписание из файла знает свой старт — это недельное с его днём и часом.
  const imported = playbackDraftFrom({ ...weekly(), playbackMode: undefined }, playlist);
  assert.deepEqual([imported.mode, imported.startDate, imported.startTime], ["weekly", "2026-09-07", "09:50:00"]);

  // Просто список — произвольное; окно, если его выберут, — с этой минуты, а
  // конец по умолчанию там, где кончится сам список.
  const plain = playbackDraftFrom(null, playlist, new Date(2026, 8, 11, 14, 37, 12));
  assert.deepEqual(
    [plain.mode, plain.startDate, plain.startTime, plain.endDate, plain.endTime],
    ["free", "2026-09-11", "14:37:00", "2026-09-11", "16:37:00"],
  );

  // Выбранное планируемое открывается тем окном, которое задали.
  const reopened = playbackDraftFrom(planned(), playlist);
  assert.deepEqual([reopened.mode, reopened.startTime, reopened.endTime], ["planned", "10:00:00", "18:00:00"]);
});

test("время заполнения показывается часами больше суток", () => {
  assert.equal(formatClockDuration(604_800), "168:00:00");
  assert.equal(formatClockDuration(5_400), "01:30:00");
});

function weekly(): ScheduleMetadata {
  return {
    sourceFilePath: "/air/week.txt",
    sourceName: "week.txt",
    encoding: "utf-8",
    startTime: "09:50:00.00",
    anchorDate: "2026-09-07",
    delaySeconds: 0,
    targetDurationSeconds: 604_800,
    warnings: [],
    playbackMode: "weekly",
  };
}

function planned(): ScheduleMetadata {
  return applyPlaybackDraft(null, {
    mode: "planned", startDate: "2026-09-07", startTime: "10:00:00", endDate: "2026-09-07", endTime: "18:00:00",
  });
}

function clip(id: string, seconds: number): MediaAsset {
  return {
    id,
    name: `${id}.mp4`,
    filePath: `/air/${id}.mp4`,
    duration: "01:00:00",
    durationSeconds: seconds,
    declaredDurationSeconds: seconds,
    status: "analyzed",
  } as MediaAsset;
}
