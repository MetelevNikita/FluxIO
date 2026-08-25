import assert from "node:assert/strict";
import test from "node:test";
import type { GraphicEffectAsset, LottieEditableProperty } from "@gruber/contracts";
import {
  applyBroadcastPlan,
  effectBlocker,
  graphicFileRejection,
  containTextBox,
  joinTickerItems,
  lottieTextFieldKey,
  mapBroadcastTaskRecords,
  normalizeTaskTitle,
  broadcastEffectSpans,
  clipDisplayTitle,
  planBroadcastEffect,
  removeBroadcastEffectSpan,
  retimeBroadcastEffectSpan,
  preferredTextFont,
  withDefaultTextFont,
  removeBroadcastEffect,
  snapToFrameGrid,
  summarizeBroadcastTaskMatches,
  type BroadcastTargetClip,
  type PlanBroadcastEffectInput,
} from "./broadcast-effects.js";
import type { MediaAsset } from "./types.js";

let nextId = 0;
const createId = () => `id${(nextId += 1)}`;

function textProperty(
  group: string,
  id: string,
  textBox: LottieEditableProperty["textBox"] = null,
): LottieEditableProperty {
  return {
    animated: false,
    fitSample: null,
    group,
    id,
    textBox,
    label: "Text",
    overridden: false,
    path: `/layers/0/t/d/k/0/s/t/${id}`,
    type: "text",
    value: "template",
  };
}

function preset(properties: LottieEditableProperty[] = []): GraphicEffectAsset {
  return {
    broadcast: null,
    durationSeconds: 4,
    filePath: "/cache/preset.mov",
    height: 1_080,
    id: "preset-1",
    kind: "video",
    lottie: {
      backgroundColor: "transparent",
      frameRate: 25,
      inPoint: 0,
      outPoint: 100,
      dataBindings: [],
      dataSourceName: null,
      matchSourceKey: null,
      properties,
      responsiveTextKeys: [],
      sourcePath: "/fx/preset.json",
      version: "5.7.0",
      warnings: [],
    },
    name: "preset",
    titleDirectoryPath: null,
    titlePaths: [],
    width: 1_920,
  };
}

function broadcastEffect(
  kind: GraphicEffectAsset["broadcast"] extends null ? never : string,
  settings: Record<string, unknown>,
  placement = { offsetXPercent: 0, offsetYPercent: 0 },
): GraphicEffectAsset {
  return {
    broadcast: {
      dataMapping: { filePath: null, matchSourceKey: "name", bindings: [] },
      // Файл эффекту назначен, поэтому оформление у фикстуры — «шаблон»:
      // при «плашке» план игнорировал бы пресет.
      decoration: "file" as const,
      kind: kind as never,
      placement,
      presetEffectId: "preset-1",
      settings: {
        animationInOut: {
          durationSeconds: 5,
          endSeconds: 0,
          mode: "in",
          startSeconds: 0,
          taskFilePath: null,
        },
        clockCountdown: {
          captionKey: "",
          captionText: "",
          dynamicKey: "",
          countdownSeconds: 60,
          countdownSource: "fixed",
          durationSeconds: 60,
          format: "HH:MM:SS",
          mode: "clock",
          startSeconds: 0,
          style: style(),
          timezoneOffsetMinutes: 0,
        },
        dynamicTitle: {
          captionKey: "",
          captionText: "",
          durationSeconds: 5,
          dynamicKey: "",
          source: "manual",
          startSeconds: 0,
          style: style(),
          taskFilePath: null,
          taskKey: "text",
          text: "",
        },
        nextProgram: {
          durationSeconds: 7,
          fallbackTitle: "",
          source: "playlist-name",
          startOffsetSeconds: 30,
          style: style(),
          subtitleKey: "next_subtitle",
          subtitleText: "",
          taskFilePath: null,
          titleKey: "next_title",
        },
        stingerTransition: {
          assetPath: "/fx/stinger.mov",
          audioEnabled: false,
          audioLevelDb: -6,
          blendMode: "alpha",
          cutPointSeconds: 0.5,
          durationSeconds: 1,
          lumaThreshold: 0.08,
        },
        tickerCrawl: {
          direction: "left",
          durationSeconds: 60,
          feedUrl: "",
          filePath: null,
          items: [],
          repeat: 0,
          captionKey: "",
          captionText: "",
          dynamicKey: "",
          separator: " • ",
          source: "manual",
          speedPixelsPerSecond: 120,
          startSeconds: 0,
          style: style(),
        },
        ...settings,
      } as never,
    },
    durationSeconds: 4,
    filePath: "/cache/preset.mov",
    height: 1_080,
    id: "fx-broadcast",
    kind: "video",
    lottie: null,
    name: "Broadcast FX",
    titleDirectoryPath: null,
    titlePaths: [],
    width: 1_920,
  };
}

test("JSON mapping binds arbitrary source fields to template text keys", () => {
  assert.deepEqual(mapBroadcastTaskRecords([
    { media: "Clip A", "programme.title": "Вечерние новости", presenter: "Анна" },
  ], {
    filePath: "/data/rundown.json",
    matchSourceKey: "media",
    bindings: [
      { sourceKey: "programme.title", targetKey: "main_title" },
      { sourceKey: "presenter", targetKey: "subtitle" },
    ],
  }), [{
    name: "Clip A",
    values: { main_title: "Вечерние новости", subtitle: "Анна" },
  }]);
});

test("Animation JSON uses title for lookup and keeps same-name language fields", () => {
  assert.deepEqual(mapBroadcastTaskRecords([
    { title: "Clip A", eng: "News", rus: "Новости", fre: "Actualités" },
  ], {
    filePath: "/data/titles.json",
    matchSourceKey: "title",
    bindings: [],
  }), [{
    name: "Clip A",
    values: { eng: "News", fre: "Actualités", rus: "Новости" },
  }]);
});

function style() {
  return {
    boxColor: "#000000",
    boxEnabled: true,
    boxOpacity: 0.62,
    boxPaddingPercent: 0.9,
    align: "left" as const,
    color: "#FFFFFF",
    fontFamily: "",
    fontFilePath: null,
    fontSizePercent: 4.2,
    xPercent: 4,
    yPercent: 86,
  };
}

const clips: BroadcastTargetClip[] = [
  { durationSeconds: 100, id: "a", name: "Инзерские зубчатки" },
  { durationSeconds: 80, id: "b", name: "Вечерние новости" },
];

function plan(overrides: Partial<PlanBroadcastEffectInput>) {
  return planBroadcastEffect({
    clips,
    createId,
    effect: broadcastEffect("ticker-crawl", {}),
    frameRate: 25,
    frameHeight: 1_080,
    frameWidth: 1_920,
    preset: null,
    targetIds: null,
    taskEntries: [],
    ...overrides,
  });
}

test("a cropped Lottie composition maps live text through the same contain geometry as its plate", () => {
  const mapped = containTextBox({
    align: "left",
    color: "#FFFFFF",
    fontSizePercent: 22.5,
    xPercent: 15.324074074074073,
    yPercent: 63.552978515625,
  }, 1_080, 200, 1_920, 1_080);

  // title_JSON_3.json is 1080×200. Its plate fills the FHD width and receives
  // transparent padding above/below; the separate drawtext must receive the
  // exact same scale and padding.
  assert.ok(Math.abs(mapped.xPercent - 15.324074074074073) < 1e-9);
  assert.ok(Math.abs(mapped.yPercent - 54.46188593106995) < 1e-9);
  assert.ok(Math.abs(mapped.fontSizePercent - 7.4074074074074066) < 1e-9);
});

test("lottie text field key uses the layer name and the Essential Graphics slot id", () => {
  assert.equal(lottieTextFieldKey(textProperty("Main composition · eng", "p1")), "eng");
  assert.equal(lottieTextFieldKey(textProperty("Main composition · Title · Slot rus", "p2")), "rus");
});

test("dynamic title keeps text in drawtext and resizes the Lottie plate from a fit sample", () => {
  const field = textProperty("Main composition · value", "prop-value", {
    align: "left",
    color: "#F5D565",
    fontSizePercent: 5,
    xPercent: 12,
    yPercent: 80,
  });
  const result = plan({
    effect: broadcastEffect("dynamic-title", {
      dynamicTitle: {
        ...broadcastEffect("dynamic-title", {}).broadcast!.settings.dynamicTitle,
        dynamicKey: "value",
        text: "Система готова",
      },
    }),
    preset: preset([field]),
  });

  assert.equal(result.layers.length, 2);
  assert.equal(result.textOverlays.length, 2);
  assert.equal(result.textOverlays[0]?.overlay.mode, "static");
  assert.equal(result.textOverlays[0]?.overlay.content, "Система готова");
  assert.equal(result.textOverlays[0]?.overlay.style.boxEnabled, false);
  assert.equal(result.textOverlays[0]?.overlay.style.color, "#F5D565");
  assert.equal(result.renders[0]?.overrides["prop-value"], "");
  assert.deepEqual(result.renders[0]?.fitSamples["prop-value"], {
    fontFilePath: null,
    fontSizePercent: 5,
    text: "Система готова",
  });
});

test("dynamic title reads a per-clip value from the task file and falls back to manual text", () => {
  const result = plan({
    effect: broadcastEffect("dynamic-title", {
      dynamicTitle: {
        ...broadcastEffect("dynamic-title", {}).broadcast!.settings.dynamicTitle,
        source: "task-file",
        taskKey: "status",
        text: "Нет данных",
      },
    }),
    preset: null,
    taskEntries: [{ name: clips[0]!.name, values: { status: "В эфире" } }],
  });

  assert.deepEqual(
    result.textOverlays.map((entry) => entry.overlay.content),
    ["В эфире", "Нет данных"],
  );
  assert.ok(result.warnings.some((warning) => warning.includes("резервный текст")));
});

test("dynamic title matches task identifiers like file names", () => {
  const result = plan({
    effect: broadcastEffect("dynamic-title", {
      dynamicTitle: {
        ...broadcastEffect("dynamic-title", {}).broadcast!.settings.dynamicTitle,
        source: "task-file",
        taskKey: "status",
        text: "Нет данных",
      },
    }),
    clips: [{ durationSeconds: 30, id: "a", name: "/MEDIA/NEWS_01.MOV" }],
    taskEntries: [{ name: " news_01 ", values: { status: "В эфире" } }],
  });

  assert.equal(result.textOverlays[0]?.overlay.content, "В эфире");
});

test("animation in/out binds a task entry to exactly one clip and maps its keys", () => {
  const result = plan({
    effect: broadcastEffect("animation-in-out", {
      animationInOut: {
        durationSeconds: 5,
        endSeconds: 2,
        mode: "in-out",
        startSeconds: 1,
        taskFilePath: "/fx/task.json",
      },
    }),
    preset: preset([
      textProperty("Main composition · eng", "prop-eng"),
      textProperty("Main composition · rus", "prop-rus"),
    ]),
    taskEntries: [{
      name: " Инзерские зубчатки ",
      values: { eng: "Inzer Cogs", region: "Башкортостан", rus: "Инзерские зубчатки" },
    }],
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /"region" has no matching Lottie text field/);
  // In и Out — два окна на одном ролике, оба из одного рендера.
  assert.equal(result.layers.length, 2);
  assert.deepEqual(result.layers.map((entry) => entry.assetId), ["a", "a"]);
  assert.deepEqual(
    result.layers.map((entry) => [entry.layer.startSeconds, entry.layer.endSeconds]),
    [[1, 6], [93, 98]],
  );
  assert.equal(result.renders.length, 1);
  assert.deepEqual(result.renders[0]!.overrides, {
    "prop-eng": "Inzer Cogs",
    "prop-rus": "Инзерские зубчатки",
  });
});

test("animation in/out applies one JSON title to every repeated schedule clip", () => {
  const repeated = plan({
    clips: [
      { durationSeconds: 100, id: "a", name: "Повтор.mov" },
      { durationSeconds: 100, id: "b", name: "/media/ПОВТОР.MXF" },
    ],
    effect: broadcastEffect("animation-in-out", {}),
    preset: preset([textProperty("Main composition · eng", "prop-eng")]),
    taskEntries: [{ name: " повтор ", values: { ENG: "Repeat" } }],
  });

  assert.equal(repeated.errors.length, 0);
  assert.equal(repeated.layers.length, 2);
  assert.equal(repeated.renders.length, 1);
  assert.deepEqual(repeated.renders[0]!.overrides, { "prop-eng": "Repeat" });
});

test("animation in/out rejects duplicate JSON titles but ignores records outside schedule", () => {
  const duplicate = plan({
    clips: [{ durationSeconds: 100, id: "a", name: "Повтор" }],
    effect: broadcastEffect("animation-in-out", {}),
    preset: preset([textProperty("Main composition · eng", "prop-eng")]),
    taskEntries: [
      { name: "Повтор", values: { eng: "First" } },
      { name: "повтор.mov", values: { eng: "Second" } },
      { name: "Нет в расписании", values: { eng: "Unused" } },
    ],
  });

  assert.equal(duplicate.layers.length, 0);
  assert.equal(duplicate.errors.length, 1);
  assert.match(duplicate.errors[0]!, /2 JSON records share this title/);
});

test("task match summary counts repeated clips before project application", () => {
  const summary = summarizeBroadcastTaskMatches([
    { name: "Clip A", values: {} },
    { name: "Clip B", values: {} },
    { name: "clip b.mov", values: {} },
    { name: "Not scheduled", values: {} },
  ], [
    { durationSeconds: 1, id: "a1", name: "CLIP A.mov" },
    { durationSeconds: 1, id: "a2", name: "/media/clip a.mxf" },
    { durationSeconds: 1, id: "b", name: "Clip B" },
    { durationSeconds: 1, id: "c", name: "Clip C" },
  ]);

  assert.deepEqual(summary, {
    recordCount: 4,
    matchedRecordCount: 1,
    matchedClipCount: 2,
    unmatchedRecordCount: 3,
    unmatchedClipCount: 2,
    duplicateTitles: ["Clip B"],
  });
  assert.equal(normalizeTaskTitle(" C:\\Media\\NEWS_01.MOV "), "news_01");
});

test("next program reads the following playlist item and warns on the last clip", () => {
  const result = plan({
    effect: broadcastEffect("next-program", {}),
    preset: preset([textProperty("Main composition · next_title", "prop-title")]),
  });

  assert.equal(result.layers.length, 1);
  assert.equal(result.layers[0]!.assetId, "a");
  assert.equal(result.layers[0]!.layer.startSeconds, 70);
  assert.equal(result.layers[0]!.layer.endSeconds, 77);
  assert.deepEqual(result.renders[0]!.overrides, { "prop-title": "" });
  assert.deepEqual(result.renders[0]!.fitSamples["prop-title"], {
    fontFilePath: null,
    fontSizePercent: 4.2,
    text: "Вечерние новости",
  });
  assert.equal(result.textOverlays[0]!.overlay.content, "Вечерние новости");
  assert.ok(result.warnings.some((warning) =>
    /is the last clip and has no fallback title/.test(warning)));
});

test("next program uses normalized task identifiers across a schedule boundary", () => {
  const result = plan({
    clips: [
      { durationSeconds: 100, id: "current-last", name: "Фильм А.mov" },
      { durationSeconds: 90, id: "future-first", name: "/MEDIA/FILM_B.MXF" },
    ],
    effect: broadcastEffect("next-program", {
      nextProgram: {
        ...broadcastEffect("next-program", {}).broadcast!.settings.nextProgram,
        source: "task-file",
        titleKey: "next_title",
      },
    }),
    targetIds: new Set(["current-last"]),
    taskEntries: [{ name: "film_b", values: { next_title: "Фильм Б из JSON" } }],
  });

  assert.equal(result.textOverlays[0]?.overlay.content, "Фильм Б из JSON");
});

test("next program announces the next movie and skips idents between films", () => {
  const graded: BroadcastTargetClip[] = [
    { durationSeconds: 100, id: "a", name: "Фильм А", scheduleType: "movie" },
    { durationSeconds: 20, id: "b", name: "Отбивка", scheduleType: "chop" },
    { durationSeconds: 30, id: "c", name: "Анонс", scheduleType: "clip" },
    { durationSeconds: 90, id: "d", name: "Фильм Б", scheduleType: "movie" },
  ];
  const result = plan({
    clips: graded,
    effect: broadcastEffect("next-program", {}),
    preset: preset([textProperty("Main composition · next_title", "prop-title")]),
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.renders[0]!.overrides, { "prop-title": "" });
  assert.equal(result.renders[0]!.fitSamples["prop-title"]?.text, "Фильм Б");
  assert.equal(result.textOverlays[0]!.overlay.content, "Фильм Б");
});

test("next program keeps the title in drawtext and inherits its Lottie text field geometry", () => {
  const box = {
    align: "center" as const,
    color: "#F5D565",
    fontSizePercent: 5.4,
    xPercent: 48,
    yPercent: 82,
  };
  const result = plan({
    effect: broadcastEffect("next-program", {
      nextProgram: {
        ...broadcastEffect("next-program", {}).broadcast!.settings.nextProgram,
        style: { ...style(), fontFamily: "PT Sans", fontFilePath: "/fonts/PTSans.ttf" },
      },
    }),
    preset: preset([textProperty("Main composition · next_title", "prop-title", box)]),
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.renders[0]!.overrides, { "prop-title": "" });
  assert.deepEqual(result.renders[0]!.fitSamples["prop-title"], {
    fontFilePath: "/fonts/PTSans.ttf",
    fontSizePercent: 5.4,
    text: "Вечерние новости",
  });
  const overlay = result.textOverlays[0]!.overlay;
  assert.equal(overlay.content, "Вечерние новости");
  assert.equal(overlay.style.align, "center");
  assert.equal(overlay.style.boxEnabled, false);
  assert.equal(overlay.style.color, "#F5D565");
  assert.equal(overlay.style.fontSizePercent, 5.4);
  assert.equal(overlay.style.xPercent, 48);
  assert.equal(overlay.style.yPercent, 82);
});

test("start offset counts from the end even when the clip came from a schedule", () => {
  // Ролик длиной 3600 с: плашка за 30 с до конца должна встать на 3570, а не
  // в начало. Раньше нулевая длительность неразобранного файла обнуляла окно.
  const scheduled: BroadcastTargetClip[] = [
    { durationSeconds: 3_600, id: "a", name: "Фильм А", scheduleType: "movie" },
    { durationSeconds: 2_700, id: "b", name: "Фильм Б", scheduleType: "movie" },
  ];
  const result = plan({
    clips: scheduled,
    effect: broadcastEffect("next-program", {}),
    preset: preset([textProperty("Main composition · next_title", "prop-title")]),
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.layers[0]!.layer.startSeconds, 3_570);
  assert.equal(result.layers[0]!.layer.endSeconds, 3_577);
});

test("next program falls back to a drawtext plate when no preset is loaded", () => {
  const result = plan({
    effect: broadcastEffect("next-program", {}),
    preset: null,
    targetIds: new Set(["a"]),
  });

  assert.equal(result.layers.length, 0);
  assert.equal(result.textOverlays.length, 1);
  assert.equal(result.textOverlays[0]!.overlay.mode, "static");
  assert.equal(result.textOverlays[0]!.overlay.content, "Вечерние новости");
});

test("Cyrillic without a chosen font is flagged before it reaches air", () => {
  const result = plan({
    effect: broadcastEffect("ticker-crawl", {
      tickerCrawl: {
        direction: "left", durationSeconds: 60, feedUrl: "", filePath: null,
        items: ["Срочные новости"], regionWidthPercent: 100, regionXPercent: 0,
        repeat: 0, separator: " • ", source: "manual",
        speedPixelsPerSecond: 120, startSeconds: 0, style: style(),
      },
    }),
    targetIds: new Set(["a"]),
  });
  assert.match(result.warnings.join("\n"), /кириллица, но шрифт не выбран/);

  const withFont = plan({
    effect: broadcastEffect("ticker-crawl", {
      tickerCrawl: {
        direction: "left", durationSeconds: 60, feedUrl: "", filePath: null,
        items: ["Срочные новости"], regionWidthPercent: 100, regionXPercent: 0,
        repeat: 0, separator: " • ", source: "manual",
        speedPixelsPerSecond: 120, startSeconds: 0,
        style: { ...style(), fontFamily: "PT Sans", fontFilePath: "/fonts/PTSans.ttf" },
      },
    }),
    targetIds: new Set(["a"]),
  });
  assert.deepEqual(withFont.warnings, []);
});

test("ticker joins messages and closes the loop with the separator", () => {
  assert.equal(joinTickerItems(["one"], " • "), "one");
  assert.equal(joinTickerItems(["one", "two"], " • "), "one • two • ");
  assert.equal(joinTickerItems([" ", ""], " • "), "");
});

test("a caption is baked into the chosen preset field, the live value stays drawtext", () => {
  const result = plan({
    effect: broadcastEffect("clock-countdown", {
      clockCountdown: {
        captionKey: "eng",
        captionText: "МОСКВА",
        countdownSeconds: 60,
        countdownSource: "fixed",
        durationSeconds: 60,
        format: "HH:MM",
        mode: "clock",
        startSeconds: 0,
        style: { ...style(), fontFamily: "PT Sans", fontFilePath: "/fonts/PTSans.ttf" },
        timezoneOffsetMinutes: 0,
      },
    }),
    preset: preset([textProperty("Main composition · eng", "prop-eng")]),
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.errors, []);
  // Подпись уходит в поле пресета…
  assert.deepEqual(result.renders[0]!.overrides, { "prop-eng": "МОСКВА" });
  assert.equal(result.layers[0]!.renderKey, result.renders[0]!.key);
  // …а сами часы остаются динамической надписью: покадровое значение
  // в запечённый Lottie не положить.
  assert.equal(result.textOverlays[0]!.overlay.mode, "clock");
});

test("a caption pointing at a missing preset field is reported, not silently dropped", () => {
  const result = plan({
    effect: broadcastEffect("clock-countdown", {
      clockCountdown: {
        captionKey: "нет-такого",
        captionText: "МОСКВА",
        countdownSeconds: 60,
        countdownSource: "fixed",
        durationSeconds: 60,
        format: "HH:MM",
        mode: "clock",
        startSeconds: 0,
        style: { ...style(), fontFamily: "PT Sans", fontFilePath: "/fonts/PTSans.ttf" },
        timezoneOffsetMinutes: 0,
      },
    }),
    preset: preset([textProperty("Main composition · eng", "prop-eng")]),
    targetIds: new Set(["a"]),
  });

  assert.match(result.warnings.join("\n"), /нет текстового поля "нет-такого"/);
  // Поле под живое значение не выбрано, но в пресете оно одно — берём его:
  // иначе шаблонный текст остался бы в кадре вторым слоем под часами.
  assert.equal(result.renders.length, 1);
  assert.equal(result.renders[0]!.overrides["prop-eng"], "");
  assert.match(result.warnings.join("\n"), /взято единственное поле/);
});

test("moving an effect shifts its plate and its live text by the same amount", () => {
  const clockSettings = {
    clockCountdown: {
      captionKey: "",
      captionText: "",
      countdownSeconds: 60,
      countdownSource: "fixed",
      durationSeconds: 60,
      dynamicKey: "clock",
      format: "HH:MM:SS",
      mode: "clock",
      startSeconds: 0,
      style: { ...style(), xPercent: 40, yPercent: 80 },
      timezoneOffsetMinutes: 0,
    },
  };
  const moved = plan({
    effect: broadcastEffect("clock-countdown", clockSettings, {
      offsetXPercent: -12.5,
      offsetYPercent: 6,
    }),
    preset: preset([textProperty("Main composition · clock", "prop-clock")]),
    targetIds: new Set(["a"]),
  });

  // Слой рисуется во весь кадр, поэтому «подвинуть плашку» — это сдвинуть слой.
  assert.equal(moved.layers[0]?.layer.offsetXPercent, -12.5);
  assert.equal(moved.layers[0]?.layer.offsetYPercent, 6);
  // Надпись рисует отдельный drawtext, и она обязана уехать ровно туда же.
  assert.equal(moved.textOverlays[0]?.overlay.style.xPercent, 27.5);
  assert.equal(moved.textOverlays[0]?.overlay.style.yPercent, 86);

  const still = plan({
    effect: broadcastEffect("clock-countdown", clockSettings),
    preset: preset([textProperty("Main composition · clock", "prop-clock")]),
    targetIds: new Set(["a"]),
  });
  assert.equal(still.layers[0]?.layer.offsetXPercent, 0);
  assert.equal(still.textOverlays[0]?.overlay.style.xPercent, 40);

  const outside = plan({
    effect: broadcastEffect("clock-countdown", clockSettings, {
      offsetXPercent: -60,
      offsetYPercent: 40,
    }),
    preset: preset([textProperty("Main composition · clock", "prop-clock")]),
    targetIds: new Set(["a"]),
  });
  // Текст не зажимается у края: иначе FX-слой продолжал бы движение, а
  // отдельный drawtext отрывался от плашки.
  assert.equal(outside.textOverlays[0]?.overlay.style.xPercent, -20);
  assert.equal(outside.textOverlays[0]?.overlay.style.yPercent, 120);
});

test("a stinger stays where it is: moving it would open a gap at the cut", () => {
  const moved = plan({
    effect: broadcastEffect("stinger-transition", {}, {
      offsetXPercent: 20,
      offsetYPercent: 20,
    }),
    targetIds: new Set(["a", "b"]),
  });
  for (const entry of moved.layers) {
    assert.equal(entry.layer.offsetXPercent, 0);
    assert.equal(entry.layer.offsetYPercent, 0);
  }
});

test("a clock over a preset never leaves the template text under the live value", () => {
  const clock = (dynamicKey: string, fields: string[]) => plan({
    effect: broadcastEffect("clock-countdown", {
      clockCountdown: {
        captionKey: "",
        captionText: "",
        countdownSeconds: 60,
        countdownSource: "fixed",
        durationSeconds: 60,
        dynamicKey,
        format: "HH:MM:SS",
        mode: "clock",
        startSeconds: 0,
        style: { ...style(), fontFamily: "PT Sans", fontFilePath: "/fonts/PTSans.ttf" },
        timezoneOffsetMinutes: 0,
      },
    }),
    preset: preset(fields.map((field) => textProperty(`Main composition · ${field}`, `prop-${field}`))),
    targetIds: new Set(["a"]),
  });

  const chosen = clock("clock", ["clock", "caption"]);
  assert.equal(chosen.renders[0]?.overrides["prop-clock"], "");
  // Плашке `fit:` отдаётся самое широкое значение формата тем же шрифтом и
  // кеглем, которыми выйдет живая надпись: в документе мерить нечего.
  assert.deepEqual(chosen.renders[0]?.fitSamples["prop-clock"], {
    text: "00:00:00",
    fontFilePath: "/fonts/PTSans.ttf",
    fontSizePercent: chosen.textOverlays[0]?.overlay.style.fontSizePercent,
  });

  // Полей несколько, выбор не сделан — угадывать нельзя, но и молчать тоже.
  const ambiguous = clock("", ["clock", "caption"]);
  assert.deepEqual(ambiguous.renders, []);
  assert.match(ambiguous.warnings.join("\n"), /шаблонный текст пресета останется в кадре/);
});

test("the live value takes the place of the chosen preset text layer", () => {
  const box = {
    align: "center" as const,
    color: "#000000",
    fontSizePercent: 6.11,
    xPercent: 38.4,
    yPercent: 87.9,
  };
  const result = plan({
    effect: broadcastEffect("clock-countdown", {
      clockCountdown: {
        captionKey: "",
        captionText: "",
        countdownSeconds: 60,
        countdownSource: "fixed",
        durationSeconds: 60,
        dynamicKey: "clock",
        format: "HH:MM",
        mode: "clock",
        startSeconds: 0,
        style: { ...style(), fontFamily: "PT Sans", fontFilePath: "/fonts/PTSans.ttf" },
        timezoneOffsetMinutes: 0,
      },
    }),
    preset: preset([textProperty("Main composition · clock", "prop-clock", box)]),
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.errors, []);
  // Поле шаблона очищается: иначе его текст остался бы под живой надписью.
  assert.deepEqual(result.renders[0]!.overrides, { "prop-clock": "" });
  // Надпись наследует место и оформление слоя, подложка не нужна.
  const overlay = result.textOverlays[0]!.overlay;
  assert.equal(overlay.style.xPercent, 38.4);
  assert.equal(overlay.style.yPercent, 87.9);
  assert.equal(overlay.style.fontSizePercent, 6.11);
  assert.equal(overlay.style.color, "#000000");
  assert.equal(overlay.style.align, "center");
  assert.equal(overlay.style.boxEnabled, false);
  // Шрифт оператора не перетирается: в Lottie он может отсутствовать в системе.
  assert.equal(overlay.style.fontFilePath, "/fonts/PTSans.ttf");
});

test("a ticker bound to a plate warns while its band still spans the whole frame", () => {
  const bound = (regionWidthPercent: number) => plan({
    effect: broadcastEffect("ticker-crawl", {
      tickerCrawl: {
        captionKey: "", captionText: "", direction: "left", durationSeconds: 60,
        dynamicKey: "line", feedUrl: "", filePath: null, items: ["Новость"],
        regionWidthPercent, regionXPercent: 18, repeat: 0, separator: " • ",
        source: "manual", speedPixelsPerSecond: 120, startSeconds: 0,
        style: { ...style(), fontFamily: "PT Sans", fontFilePath: "/fonts/PTSans.ttf" },
      },
    }),
    preset: preset([textProperty("Main composition · line", "prop-line", {
      align: "center", color: "#000000", fontSizePercent: 6, xPercent: 38, yPercent: 88,
    })]),
    targetIds: new Set(["a"]),
  });

  // Во весь кадр строка уедет с плашки и станет почти не видна — предупреждаем.
  assert.match(bound(100).warnings.join("\n"), /полоса задана во весь кадр/);
  assert.deepEqual(bound(41).warnings, []);
  assert.equal(bound(41).textOverlays[0]!.overlay.regionWidthPercent, 41);
});

test("binding to a preset field that does not exist is reported", () => {
  const result = plan({
    effect: broadcastEffect("ticker-crawl", {
      tickerCrawl: {
        captionKey: "", captionText: "", direction: "left", durationSeconds: 60,
        dynamicKey: "нет-такого", feedUrl: "", filePath: null, items: ["Новость"],
        regionWidthPercent: 100, regionXPercent: 0,
        repeat: 0, separator: " • ", source: "manual", speedPixelsPerSecond: 120,
        startSeconds: 0,
        style: { ...style(), fontFamily: "PT Sans", fontFilePath: "/fonts/PTSans.ttf" },
      },
    }),
    preset: preset([textProperty("Main composition · line", "prop-line")]),
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.renders, []);
  assert.match(result.warnings.join("\n"), /нет текстового поля "нет-такого"/);
});

test("countdown to the end of the clip is measured per clip, not per setting", () => {
  const result = plan({
    effect: broadcastEffect("clock-countdown", {
      clockCountdown: {
        countdownSeconds: 60,
        countdownSource: "clip-remaining",
        durationSeconds: 60,
        format: "MM:SS",
        mode: "countdown",
        startSeconds: 10,
        style: { ...style(), fontFamily: "PT Sans", fontFilePath: "/fonts/PTSans.ttf" },
        timezoneOffsetMinutes: 0,
      },
    }),
    targetIds: null,
  });

  // Ролик A длится 100 с, ролик B — 80 с: отсчёт у каждого свой и приходит
  // в ноль ровно на конце ролика, а не через фиксированные 60 с.
  assert.deepEqual(
    result.textOverlays.map((entry) => [
      entry.assetId,
      entry.overlay.countdownFromSeconds,
      entry.overlay.startSeconds,
      entry.overlay.endSeconds,
    ]),
    [["a", 90, 10, 100], ["b", 70, 10, 80]],
  );
});

test("stinger splits across the cut and takes the second half from mid file", () => {
  const result = plan({
    effect: broadcastEffect("stinger-transition", {
      stingerTransition: {
        assetPath: "/fx/stinger.mov",
        audioEnabled: true,
        audioLevelDb: -6,
        blendMode: "luma",
        cutPointSeconds: 0.52,
        durationSeconds: 1.2,
        lumaThreshold: 0.1,
      },
    }),
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.layers.length, 2);
  const [tail, head] = result.layers;
  // Хвост ролика A: последние cutPoint секунд, с начала файла перехода.
  assert.equal(tail!.assetId, "a");
  assert.equal(tail!.layer.startSeconds, 99.48);
  assert.equal(tail!.layer.endSeconds, 100);
  assert.equal(tail!.layer.sourceInSeconds, 0);
  // Голова ролика B: остаток перехода, из файла со смещением на cutPoint.
  assert.equal(head!.assetId, "b");
  assert.equal(head!.layer.startSeconds, 0);
  assert.equal(head!.layer.endSeconds, 0.68);
  assert.equal(head!.layer.sourceInSeconds, 0.52);
  assert.equal(head!.layer.sourceDurationSeconds, 1.2);
  assert.equal(head!.layer.blendMode, "luma");
  assert.equal(head!.layer.tier, 2);
  // Звук режется тем же швом, чтобы переход не был слышен дважды.
  assert.equal(result.audioOverlays.length, 2);
  assert.equal(result.audioOverlays[0]!.overlay.startSeconds, 99.48);
  assert.equal(result.audioOverlays[1]!.overlay.sourceInSeconds, 0.52);
});

test("the default font is a real file with Cyrillic, not FFmpeg's built-in one", () => {
  const fonts = [
    { family: "Comic Sans MS", filePath: "/f/comic.ttf", cyrillic: false },
    { family: "Menlo", filePath: "/f/menlo.ttf", cyrillic: true },
    { family: "Arial", filePath: "/f/arial.ttf", cyrillic: true },
  ];
  // Из знакомых семейств выбирается Arial, а не первый попавшийся с кириллицей.
  assert.equal(preferredTextFont(fonts)?.filePath, "/f/arial.ttf");

  // Знакомых нет — берётся любой с кириллицей, но не без неё.
  assert.equal(preferredTextFont([fonts[0]!, fonts[1]!])?.filePath, "/f/menlo.ttf");
  assert.equal(preferredTextFont([fonts[0]!]), null);
  assert.equal(preferredTextFont([]), null);
});

test("the default font fills every empty style and never overwrites a chosen one", () => {
  const settings = broadcastEffect("dynamic-title", {}).broadcast!.settings;
  const chosen = {
    ...settings,
    tickerCrawl: {
      ...settings.tickerCrawl,
      style: { ...settings.tickerCrawl.style, fontFilePath: "/f/chosen.ttf", fontFamily: "Chosen" },
    },
  };
  const font = { family: "Arial", filePath: "/f/arial.ttf", cyrillic: true };
  const result = withDefaultTextFont(chosen, font);

  assert.equal(result.dynamicTitle.style.fontFilePath, "/f/arial.ttf");
  assert.equal(result.dynamicTitle.style.fontFamily, "Arial");
  assert.equal(result.clockCountdown.style.fontFilePath, "/f/arial.ttf");
  // Выбранный оператором шрифт умолчание не трогает.
  assert.equal(result.tickerCrawl.style.fontFilePath, "/f/chosen.ttf");
});

test("no Cyrillic font in the system leaves the settings untouched", () => {
  const settings = broadcastEffect("dynamic-title", {}).broadcast!.settings;
  assert.equal(withDefaultTextFont(settings, null), settings);
});

test("one effect is one timeline track, not a plate and a caption apart", () => {
  const asset = {
    effects: [{ ...fxLayer("plate", "fx2-title", 2), startSeconds: 1, endSeconds: 6 }],
    textOverlays: [{ ...textOverlay("caption", "fx2-title"), startSeconds: 1, endSeconds: 6 }],
  };
  const spans = broadcastEffectSpans(asset);

  assert.equal(spans.length, 1);
  assert.deepEqual(spans[0]!.parts, ["graphics", "text"]);
  assert.deepEqual(spans[0]!.layerIds, ["plate"]);
  assert.deepEqual(spans[0]!.textOverlayIds, ["caption"]);
});

test("the in and out windows of one effect stay separate tracks", () => {
  const asset = {
    effects: [
      { ...fxLayer("in", "fx2-anim", 2), startSeconds: 0, endSeconds: 3 },
      { ...fxLayer("out", "fx2-anim", 2), startSeconds: 17, endSeconds: 20 },
    ],
  };
  // Один effectId, но два окна: ключ включает окно, поэтому вход и выход
  // остаются разными дорожками и двигаются независимо.
  assert.equal(broadcastEffectSpans(asset).length, 2);
});

test("the same tier 3 file dropped twice keeps two independent tracks", () => {
  const asset = {
    effects: [
      { ...fxLayer("a", "fx-lower", 3), startSeconds: 0, endSeconds: 5 },
      { ...fxLayer("b", "fx-lower", 3), startSeconds: 0, endSeconds: 5 },
    ],
  };
  assert.equal(broadcastEffectSpans(asset).length, 2);
});

test("retiming a track moves every part of the effect at once", () => {
  const asset = {
    effects: [{ ...fxLayer("plate", "fx2-stinger", 2), startSeconds: 1, endSeconds: 3 }],
    textOverlays: [{ ...textOverlay("caption", "fx2-stinger"), startSeconds: 1, endSeconds: 3 }],
    audioOverlays: [{
      id: "sfx",
      effectId: "fx2-stinger",
      filePath: "/fx/wipe.mov",
      startSeconds: 1,
      durationSeconds: 2,
      sourceInSeconds: 0,
      gainDb: -6,
    }],
  };
  const span = broadcastEffectSpans(asset)[0]!;
  const moved = retimeBroadcastEffectSpan(asset, span, 8, 11);

  // Именно рассинхрон этих трёх окон и оставлял надпись висеть после того,
  // как плашка отыграла.
  assert.equal(moved.effects[0]!.startSeconds, 8);
  assert.equal(moved.effects[0]!.endSeconds, 11);
  assert.equal(moved.textOverlays[0]!.startSeconds, 8);
  assert.equal(moved.textOverlays[0]!.endSeconds, 11);
  assert.equal(moved.audioOverlays[0]!.startSeconds, 8);
  assert.equal(moved.audioOverlays[0]!.durationSeconds, 3);
});

test("the track keeps its key after being moved, so a drag does not stall", () => {
  const asset = {
    effects: [{ ...fxLayer("plate", "fx2-title", 2), startSeconds: 1, endSeconds: 6 }],
    textOverlays: [{ ...textOverlay("caption", "fx2-title"), startSeconds: 1, endSeconds: 6 }],
  };
  const before = broadcastEffectSpans(asset)[0]!;
  const moved = retimeBroadcastEffectSpan(asset, before, 2, 7);
  const after = broadcastEffectSpans({ ...asset, ...moved })[0]!;

  // Перетаскивание — это поток мелких шагов, и каждый следующий ищет дорожку
  // по ключу. Ключ от окна менялся бы вместе с ним, и эффект замирал после
  // первого шага.
  assert.equal(after.key, before.key);
  assert.equal(after.startSeconds, 2);
});

test("the promo shows a clip name, not a file name", () => {
  assert.equal(
    clipDisplayTitle("/media/I built the hybrid PCMac setup [get-save.com].mp4"),
    "I built the hybrid PCMac setup [get-save.com]",
  );
  assert.equal(clipDisplayTitle("C:\\Rundown\\News_01.mxf"), "News_01");
  // Год в скобках — часть названия, а не мусор: трогать его нельзя.
  assert.equal(clipDisplayTitle("Титаник [1997].mov"), "Титаник [1997]");
  // Точка в середине имени расширением не является.
  assert.equal(clipDisplayTitle("S01.E02.Пилот"), "S01.E02.Пилот");
  assert.equal(clipDisplayTitle("без расширения"), "без расширения");
});

test("removing a track takes the whole effect off the clip", () => {
  const asset = {
    effects: [{ ...fxLayer("plate", "fx2-title", 2), startSeconds: 1, endSeconds: 6 }],
    textOverlays: [{ ...textOverlay("caption", "fx2-title"), startSeconds: 1, endSeconds: 6 }],
  };
  const span = broadcastEffectSpans(asset)[0]!;
  const cleared = removeBroadcastEffectSpan(asset, span);

  assert.deepEqual(cleared.effects, []);
  assert.deepEqual(cleared.textOverlays, []);
});

function fxLayer(id: string, effectId: string, tier: 2 | 3) {
  return {
    id,
    effectId,
    name: "effect",
    filePath: "/fx/a.mov",
    kind: "video" as const,
    sourceDurationSeconds: 10,
    startSeconds: 0,
    endSeconds: 5,
    sourceInSeconds: 0,
    blendMode: "alpha" as const,
    lumaThreshold: 0.08,
    sequenceFrameRate: null,
    sequenceStartNumber: null,
    offsetXPercent: 0,
    offsetYPercent: 0,
    tier,
    titlePaths: [],
  };
}

function textOverlay(id: string, effectId: string) {
  return {
    id,
    effectId,
    name: "effect",
    mode: "static" as const,
    content: "TEXT",
    style: style(),
    startSeconds: 0,
    endSeconds: 5,
    clockFormat: "HH:MM:SS" as const,
    countdownFromSeconds: 0,
    direction: "left" as const,
    regionWidthPercent: 100,
    regionXPercent: 0,
    repeat: 0,
    speedPixelsPerSecond: 120,
    timezoneOffsetMinutes: 0,
  };
}

test("each kind accepts only the graphics it can actually use", () => {
  // Шаблон титров в бегущую строку не годится: ей нужна подложка, а не набор
  // текстовых слоёв. И наоборот — alpha-медиа нечего подставить в титр.
  assert.equal(graphicFileRejection("dynamic-title", "/g/title.json"), null);
  assert.equal(graphicFileRejection("next-program", "/g/title.json"), null);
  assert.equal(graphicFileRejection("clock-countdown", "/g/title.json"), null);
  assert.equal(graphicFileRejection("ticker-crawl", "/g/plate.mov"), null);
  assert.equal(graphicFileRejection("animation-in-out", "/g/in.png"), null);
  assert.equal(graphicFileRejection("stinger-transition", "/g/wipe.mov"), null);

  assert.match(graphicFileRejection("ticker-crawl", "/g/title.json") ?? "", /Бегущая строка/);
  assert.match(graphicFileRejection("dynamic-title", "/g/plate.mov") ?? "", /Title Studio/);
  assert.match(graphicFileRejection("stinger-transition", "/g/clip.mp4") ?? "", /альфой/);
});

test("the format check ignores case and paths without an extension", () => {
  assert.equal(graphicFileRejection("dynamic-title", "C:\\Titles\\Lower.JSON"), null);
  assert.match(
    graphicFileRejection("dynamic-title", "/g/README") ?? "",
    /файл без расширения/,
  );
});

test("an effect that cannot be applied says so before the operator tries", () => {
  const stinger = broadcastEffect("stinger-transition", {
    stingerTransition: {
      ...broadcastEffect("stinger-transition", {}).broadcast!.settings.stingerTransition,
      assetPath: null,
    },
  });
  assert.match(effectBlocker(stinger, []) ?? "", /файл перехода/);

  const title = broadcastEffect("dynamic-title", {});
  // Файл назначен, но самой графики в библиотеке нет — перенос проекта или
  // чужая сессия. Молча применяться такой эффект не должен.
  assert.match(effectBlocker(title, []) ?? "", /потерян/);
  assert.equal(effectBlocker(title, [preset()]), null);
});

test("an effect drawing its own plate needs no file at all", () => {
  const effect = broadcastEffect("clock-countdown", {});
  const withPlate: GraphicEffectAsset = {
    ...effect,
    broadcast: { ...effect.broadcast!, decoration: "plate", presetEffectId: null },
  };
  assert.equal(effectBlocker(withPlate, []), null);
});

test("a stinger built from frames carries the operator's rate into the layer", () => {
  const result = plan({
    effect: broadcastEffect("stinger-transition", {
      stingerTransition: {
        ...broadcastEffect("stinger-transition", {}).broadcast!.settings.stingerTransition,
        assetPath: "/fx/wipe_%04d.png",
        sourceKind: "sequence",
        sequenceStartNumber: 1,
        sequenceFrameCount: 50,
        sourceFrameRate: 50,
        cutPointSeconds: 0.5,
        durationSeconds: 1,
      },
    }),
    preset: null,
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.layers.length, 2);
  // Признаком последовательности служит именно частота: по ней command-builder
  // отличает шаблон нумерации от одиночной картинки.
  assert.equal(result.layers[0]!.layer.sequenceFrameRate, 50);
  assert.equal(result.layers[0]!.layer.sequenceStartNumber, 1);
  // Вторая половина по-прежнему берётся от точки разреза, округлённой к
  // кадровой сетке: 0.5 с при 25 fps это 13-й кадр, то есть 0.52 с.
  assert.equal(result.layers[1]!.layer.sourceInSeconds, 0.52);
});

test("a sequence without a frame rate is refused before it reaches the air", () => {
  const result = plan({
    effect: broadcastEffect("stinger-transition", {
      stingerTransition: {
        ...broadcastEffect("stinger-transition", {}).broadcast!.settings.stingerTransition,
        assetPath: "/fx/wipe_%04d.png",
        sourceKind: "sequence",
        sourceFrameRate: null,
      },
    }),
    preset: null,
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.layers, []);
  assert.match(result.errors[0] ?? "", /частоту кадров/);
});

test("a sequence cannot carry the transition sound it does not have", () => {
  const result = plan({
    effect: broadcastEffect("stinger-transition", {
      stingerTransition: {
        ...broadcastEffect("stinger-transition", {}).broadcast!.settings.stingerTransition,
        assetPath: "/fx/wipe_%04d.png",
        sourceKind: "sequence",
        sourceFrameRate: 25,
        audioEnabled: true,
      },
    }),
    preset: null,
    targetIds: new Set(["a"]),
  });

  // Отставший звуковой вход останавливает мультиплексор целиком, поэтому
  // выясняться это должно до применения, а не в эфире.
  assert.deepEqual(result.audioOverlays, []);
  assert.match(result.errors[0] ?? "", /звуковой дорожки/);
});

test("a stinger without its own file does not silently fall back to a template", () => {
  // Раньше переход подхватывал Lottie-пресет. У файла ffprobe проверяет альфу,
  // частоту кадров и звук до применения, у шаблона проверять нечего — поэтому
  // источник у стингера теперь только один, и его отсутствие это ошибка.
  const result = plan({
    effect: broadcastEffect("stinger-transition", {
      stingerTransition: {
        assetPath: null,
        audioEnabled: false,
        audioLevelDb: -6,
        blendMode: "alpha",
        cutPointSeconds: 0.52,
        durationSeconds: 1.2,
        lumaThreshold: 0.08,
      },
    }),
    preset: preset(),
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.layers, []);
  assert.match(result.errors[0] ?? "", /не выбран файл перехода/);
});

test("choosing the plate makes the plan ignore a file that stayed attached", () => {
  const effect = broadcastEffect("dynamic-title", {
    dynamicTitle: {
      ...broadcastEffect("dynamic-title", {}).broadcast!.settings.dynamicTitle,
      text: "Прямой эфир",
    },
  });
  const withPlate: GraphicEffectAsset = {
    ...effect,
    broadcast: { ...effect.broadcast!, decoration: "plate" },
  };
  const result = plan({ effect: withPlate, preset: preset(), targetIds: new Set(["a"]) });

  // Файл остался назначенным, но оформление выбрано плашкой: FX-слоя нет,
  // надпись рисуется сама. Иначе плашку рисовали бы обе стороны сразу.
  assert.deepEqual(result.layers, []);
  assert.deepEqual(result.renders, []);
  assert.equal(result.textOverlays.length, 1);
  assert.equal(result.textOverlays[0]!.overlay.content, "Прямой эфир");
});

test("stinger snaps to the frame grid and rejects a cut outside the transition", () => {
  assert.equal(snapToFrameGrid(0.51, 25), 0.52);
  const snapped = plan({
    effect: broadcastEffect("stinger-transition", {
      stingerTransition: {
        assetPath: "/fx/stinger.mov",
        audioEnabled: false,
        audioLevelDb: -6,
        blendMode: "alpha",
        cutPointSeconds: 0.51,
        durationSeconds: 1,
        lumaThreshold: 0.08,
      },
    }),
    targetIds: new Set(["a"]),
  });
  assert.match(snapped.warnings[0]!, /snapped to the 25 fps grid/);
  assert.equal(snapped.layers[0]!.layer.startSeconds, 99.48);
});

test("applying a plan fills rendered paths and removal strips only that effect", () => {
  const result = plan({
    effect: broadcastEffect("next-program", {}),
    preset: preset([textProperty("Main composition · next_title", "prop-title")]),
    targetIds: new Set(["a"]),
  });
  const assets = [
    { effects: [], id: "a", name: "Инзерские зубчатки" },
    { effects: [], id: "b", name: "Вечерние новости" },
  ] as unknown as MediaAsset[];

  const applied = applyBroadcastPlan(
    assets,
    result,
    new Map([[result.renders[0]!.key, "/cache/next-program-rendered.mov"]]),
  );
  assert.equal(applied.touched, 1);
  assert.equal(applied.items[0]!.effects?.[0]?.filePath, "/cache/next-program-rendered.mov");
  assert.equal(applied.items[0]!.effects?.[0]?.backgroundPath, "/cache/next-program-rendered.mov");

  const cleaned = removeBroadcastEffect(applied.items, "fx-broadcast");
  assert.deepEqual(cleaned[0]!.effects, []);
});
