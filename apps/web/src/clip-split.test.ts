import assert from "node:assert/strict";
import test from "node:test";
import {
  commentRowPath,
  evenSplitDraft,
  formatSplitTimecode,
  moveSplitPoint,
  parseSplitTimecode,
  splitAssetRows,
  splitDraftIssues,
  splitGroupsFromSchedule,
  splitRange,
} from "./clip-split.js";
import type { MediaAsset } from "./types.js";

test("ролик делится поровну по целым секундам, с пометкой между частями", () => {
  const draft = evenSplitDraft(movie(), 3);

  assert.deepEqual(draft.parts.map((part) => [part.startSeconds, part.endSeconds]), [
    [0, 1_800], [1_800, 3_600], [3_600, 5_400],
  ]);
  assert.equal(draft.parts[1]?.name, "Фильм.mp4 · часть 2");
  assert.deepEqual(draft.comments, ["Рекламный блок", "Рекламный блок"]);
});

test("конец части становится началом следующей и зажат длиной ролика", () => {
  const range = splitRange(movie());
  let draft = evenSplitDraft(movie(), 3);

  draft = moveSplitPoint(draft, range, 0, "end", 1_500);
  assert.deepEqual(draft.parts.map((part) => [part.startSeconds, part.endSeconds]), [
    [0, 1_500], [1_500, 3_600], [3_600, 5_400],
  ]);

  // Срез за соседний не уходит: следующей части остаётся хотя бы секунда.
  draft = moveSplitPoint(draft, range, 0, "end", 4_000);
  assert.equal(draft.parts[0]?.endSeconds, 3_599);
  assert.equal(draft.parts[1]?.startSeconds, 3_599);

  // И за конец файла тоже.
  draft = moveSplitPoint(draft, range, 2, "end", 9_000);
  assert.equal(draft.parts[2]?.endSeconds, 5_400);
});

test("начало части можно увести позже среза, но не раньше", () => {
  const range = splitRange(movie());
  let draft = evenSplitDraft(movie(), 2);

  // Позже — вырезанный кусок: титры внутри фильма в эфир не идут.
  draft = moveSplitPoint(draft, range, 1, "start", 2_900);
  assert.equal(draft.parts[1]?.startSeconds, 2_900);
  // Раньше конца предыдущей — повтор, который вышел бы дважды.
  draft = moveSplitPoint(draft, range, 1, "start", 2_000);
  assert.equal(draft.parts[1]?.startSeconds, 2_700);
  // Отвязанное начало остаётся на месте, пока срез его не догонит.
  draft = moveSplitPoint(draft, range, 0, "end", 2_800);
  assert.equal(draft.parts[1]?.startSeconds, 2_800);
  assert.deepEqual(splitDraftIssues(draft, range), []);
});

test("части идут в эфир отрезками файла, а обвязка раздаётся по времени", () => {
  const source = {
    ...movie(),
    scte35Markers: [
      { id: "cue-a", kind: "break-start" as const, positionSeconds: 900, eventId: 1, durationSeconds: 120, segmentationTypeId: 52, upid: "" },
      { id: "cue-b", kind: "break-start" as const, positionSeconds: 3_000, eventId: 2, durationSeconds: 120, segmentationTypeId: 52, upid: "" },
    ],
    scenes: [{ id: "next", effectId: "fx", template: {} as never, fields: {}, startSeconds: 5_380, durationSeconds: 10 }],
    ageTitle: { durationSeconds: 10, enabled: true, text: "16+" },
  } satisfies MediaAsset;
  let counter = 0;
  const rows = splitAssetRows(source, evenSplitDraft(source, 2), () => `id-${counter += 1}`);

  assert.equal(rows.length, 3);
  const [first, comment, second] = rows;
  assert.deepEqual([first?.trimInSeconds, first?.declaredDurationSeconds], [0, 2_700]);
  assert.deepEqual([second?.trimInSeconds, second?.declaredDurationSeconds], [2_700, 2_700]);
  assert.equal(first?.splitGroupId, second?.splitGroupId);
  assert.equal(second?.scheduleType, "movie");
  // Метка SCTE-35 считается от файла и остаётся там, где стоит.
  assert.deepEqual(first?.scte35Markers?.map((marker) => marker.eventId), [1]);
  assert.deepEqual(second?.scte35Markers?.map((marker) => marker.eventId), [2]);
  // «Смотрите далее» в конце фильма — в конце последней части.
  assert.deepEqual(first?.scenes, []);
  assert.equal(second?.scenes?.[0]?.startSeconds, 2_680);
  // Маркировку показывают и после рекламы.
  assert.equal(second?.ageTitle?.text, "16+");

  assert.equal(comment?.rowKind, "comment");
  assert.equal(comment?.name, "Рекламный блок");
  assert.equal(comment?.filePath, commentRowPath);
  assert.equal(comment?.durationSeconds, 0);
  assert.equal(comment?.declaredDurationSeconds, undefined);
});

test("разрез части продолжает её разрез и считает время от её точки входа", () => {
  const part = { ...movie(), trimInSeconds: 2_700, declaredDurationSeconds: 2_700, splitGroupId: "split-film" };
  let counter = 0;
  const rows = splitAssetRows(part, evenSplitDraft(part, 2), () => `id-${counter += 1}`);

  assert.deepEqual(rows.filter((row) => !row.rowKind).map((row) => [row.trimInSeconds, row.declaredDurationSeconds]), [
    [2_700, 1_350], [4_050, 1_350],
  ]);
  assert.ok(rows.every((row) => row.rowKind === "comment" || row.splitGroupId === "split-film"));
});

test("разрез узнаётся по стыку частей, даже если между ними реклама", () => {
  const groups = splitGroupsFromSchedule([
    { filePath: "D:\\Фильм.mp4", inPointSeconds: 0, declaredDurationSeconds: 2_700 },
    { filePath: "D:\\Реклама.mp4", inPointSeconds: 0, declaredDurationSeconds: 30 },
    { filePath: "D:\\Фильм.mp4", inPointSeconds: 2_700, declaredDurationSeconds: 2_700 },
    // Повтор того же фильма с начала — уже другой показ, а не часть.
    { filePath: "D:\\Фильм.mp4", inPointSeconds: 0, declaredDurationSeconds: 5_400 },
  ]);

  assert.equal(groups[0], groups[2]);
  assert.ok(groups[0]);
  assert.equal(groups[1], null);
  assert.equal(groups[3], null);
});

test("тайм-код части читается так, как его набирают", () => {
  assert.equal(formatSplitTimecode(3_723.48), "01:02:03:12");
  assert.equal(parseSplitTimecode("01:02:03:12"), 3_723.48);
  assert.equal(parseSplitTimecode("01:02:03"), 3_723);
  assert.equal(parseSplitTimecode("45:30"), 2_730);
  assert.equal(parseSplitTimecode("90,5"), 90.5);
  // Недописанное и невозможное — не ноль, а отказ.
  assert.equal(parseSplitTimecode("01:"), null);
  assert.equal(parseSplitTimecode("00:61:00"), null);
  assert.equal(parseSplitTimecode("00:00:01:25"), null);
});

function movie(): MediaAsset {
  return {
    id: "row-film",
    name: "Фильм.mp4",
    filePath: "D:\\Фильм.mp4",
    duration: "01:30:00:00",
    durationSeconds: 5_400,
    codec: "h264",
    codecFamily: "H264",
    codecProfile: "High",
    resolution: "1920×1080",
    fps: "25 fps",
    bitrate: "8 Mbps",
    size: "5 GB",
    status: "analyzed",
    preview: "/api/media/thumbnail?path=film",
    colorSpace: "bt709",
    audio: "aac",
    hasAudio: true,
    sha256: "",
  };
}
