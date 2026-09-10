import assert from "node:assert/strict";
import test from "node:test";
import { parsedScheduleSchema } from "@gruber/contracts";
import {
  countSubtitleMatches,
  librariesFromSchedule,
  reconcileSubtitleAssignments,
} from "./schedule-libraries.js";
import type { MediaAsset } from "./types.js";

test("панель ресурсов заполняется путями из расписания", () => {
  // Иначе после импорта оператор видит «Not selected» там, где расписание всё
  // принесло само, и идёт выбирать папки заново, не зная, что подхватилось.
  const libraries = librariesFromSchedule(schedule([
    {
      logoPath: "D:\\air\\brand\\logo.png",
      ageTitle: "16+",
      ageTitlePath: "D:\\air\\AGE\\16.png",
      srtPath: "D:\\air\\subs\\programme.srt",
      audioTracks: [{ language: "English", languageCode: "eng", filePath: "D:\\air\\Audio\\{eng} programme.wav" }],
    },
    {
      logoPath: "D:\\air\\brand\\logo.png",
      ageTitle: "12+",
      ageTitlePath: "D:\\air\\AGE\\12.png",
      srtPath: "D:\\air\\subs\\news.srt",
      audioTracks: [{ language: "English", languageCode: "eng", filePath: "D:\\air\\Audio\\{eng} news.wav" }],
    },
  ]));

  assert.equal(libraries.logoPath, "D:\\air\\brand\\logo.png");
  assert.equal(libraries.logoSource, "D:\\air\\brand");
  assert.equal(libraries.ageDirectory, "D:\\air\\AGE");
  assert.deepEqual(libraries.agePaths, ["D:\\air\\AGE\\16.png", "D:\\air\\AGE\\12.png"]);
  assert.equal(libraries.subtitleDirectory, "D:\\air\\subs");
  assert.equal(libraries.subtitlePaths.length, 2);
  assert.equal(libraries.audioDirectory, "D:\\air\\Audio");
});

test("папка берётся по большинству, а не по первому попавшемуся пути", () => {
  // У одного ролика логотип может быть свой — праздничный, спонсорский, —
  // и папка, взятая от него, увела бы оператора не туда.
  const libraries = librariesFromSchedule(schedule([
    { logoPath: "D:\\air\\special\\ny-logo.png", srtPath: "D:\\air\\subs\\a.srt" },
    { logoPath: "D:\\air\\brand\\logo.png", srtPath: "D:\\air\\subs\\b.srt" },
    { logoPath: "D:\\air\\brand\\logo.png", srtPath: "D:\\air\\subs\\c.srt" },
  ]));

  assert.equal(libraries.logoSource, "D:\\air\\brand");
});

test("расписание прежней версии не приносит папку AGE и не выдумывает её", () => {
  // До `path {…}` в файле был только текст «16+»: показать папку неоткуда, и
  // подставленная наугад отправила бы оператора искать картинки не там.
  const libraries = librariesFromSchedule(schedule([{ ageTitle: "16+", ageTitlePath: null }]));

  assert.equal(libraries.ageDirectory, null);
  assert.deepEqual(libraries.agePaths, []);
});

test("первый выбор папки включает субтитры всем, кому нашёлся файл", () => {
  // Оператор выбрал папку именно затем, чтобы субтитры пошли в эфир: обходить
  // сотню роликов ради галочки на каждом — работа, которой он не просил.
  const items = [asset("Программа 01.mp4"), asset("Программа 02.mp4"), asset("Заставка.mp4")];
  const paths = ["D:\\subs\\Программа 01.srt", "D:\\subs\\Программа 02.srt"];

  assert.equal(countSubtitleMatches(items, paths), 2);
  const enabled = reconcileSubtitleAssignments(items, paths, true);
  assert.deepEqual(enabled.map((entry) => entry.subtitles?.enabled ?? false), [true, true, false]);
  assert.equal(enabled[0]?.subtitles?.filePath, "D:\\subs\\Программа 01.srt");
  // Ролику без своего файла пустая запись не заводится: она только засоряет
  // снимок сессии.
  assert.equal(enabled[2]?.subtitles, undefined);
});

test("смена папки не возвращает субтитры тому, кого оператор выключил", () => {
  const items = [
    { ...asset("Программа 01.mp4"), subtitles: { enabled: false, filePath: null } },
    { ...asset("Программа 02.mp4"), subtitles: { enabled: true, filePath: "D:\\old\\Программа 02.srt" } },
  ];
  const paths = ["D:\\subs\\Программа 01.srt", "D:\\subs\\Программа 02.srt"];

  const reconciled = reconcileSubtitleAssignments(items, paths);
  assert.equal(reconciled[0]?.subtitles?.enabled, false);
  assert.equal(reconciled[1]?.subtitles?.filePath, "D:\\subs\\Программа 02.srt");
});

/* --------------------------------- фикстуры ------------------------------- */

function schedule(items: Record<string, unknown>[]) {
  return parsedScheduleSchema.parse({
    sourceFilePath: "/tmp/schedule.txt",
    encoding: "utf-8",
    startTime: "06:00:00.00",
    startSeconds: 21_600,
    delaySeconds: 0,
    targetDurationSeconds: 604_800,
    totalDurationSeconds: 600 * items.length,
    varianceSeconds: 0,
    warnings: [],
    items: items.map((item, index) => ({
      type: "movie",
      declaredDuration: "00:10:00.00",
      declaredDurationSeconds: 600,
      filePath: `D:\\air\\clip-${index}.mp4`,
      ageTitle: null,
      ageTitleDurationSeconds: null,
      logoPath: null,
      srtPath: null,
      audioTracks: [],
      lineNumber: index + 2,
      warnings: [],
      ...item,
    })),
  });
}

function asset(name: string): MediaAsset {
  return {
    id: name,
    name,
    filePath: `D:\\air\\${name}`,
    duration: "00:10:00",
    durationSeconds: 600,
    codec: "h264",
    codecFamily: "h264",
    codecProfile: "High",
    resolution: "1920x1080",
    fps: "25 fps",
    bitrate: "6 Mbps",
    size: "1.2 GB",
    status: "analyzed",
    preview: "",
    colorSpace: "bt709",
    audio: "aac",
    hasAudio: true,
    sha256: "",
  } as MediaAsset;
}
