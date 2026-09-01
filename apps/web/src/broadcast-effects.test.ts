import assert from "node:assert/strict";
import test from "node:test";
import type { GraphicEffectAsset, SceneTemplate } from "@gruber/contracts";
import {
  applyBroadcastPlan,
  effectBlocker,
  graphicFileRejection,
  joinTickerItems,
  mapBroadcastTaskRecords,
  clockSceneFields,
  nextProgramSceneFields,
  normalizeTaskTitle,
  broadcastEffectSpans,
  clipDisplayTitle,
  planBroadcastEffect,
  preferredMatchKey,
  removeBroadcastEffectSpan,
  retimeBroadcastEffectSpan,
  preferredTextFont,
  withDefaultTextFont,
  withSceneFont,
  removeBroadcastEffect,
  snapToFrameGrid,
  summarizeBroadcastTaskMatches,
  type BroadcastTargetClip,
  type PlanBroadcastEffectInput,
} from "./broadcast-effects.js";
import type { MediaAsset } from "./types.js";
import { defaultSceneTemplate } from "./default-scenes.js";

let nextId = 0;
const createId = () => `id${(nextId += 1)}`;

/** Эффект с оформлением по умолчанию — так его создаёт каталог. */
function sceneEffect(
  kind: Parameters<typeof broadcastEffect>[0],
  settings: Record<string, unknown>,
): GraphicEffectAsset {
  const effect = broadcastEffect(kind, settings);
  return {
    ...effect,
    broadcast: {
      ...effect.broadcast!,
      decorationFilePath: null,
      scene: defaultSceneTemplate(kind as never),
    },
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
      decoration: "file" as const,
      scene: null,
      kind: kind as never,
      placement,
      decorationFilePath: "/graphics/decor.mov",
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
          fieldValues: {},
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
    targetIds: null,
    taskEntries: [],
    ...overrides,
  });
}

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

test("start offset counts from the end even when the clip came from a schedule", () => {
  // Ролик длиной 3600 с: плашка за 30 с до конца должна встать на 3570, а не
  // в начало. Раньше нулевая длительность неразобранного файла обнуляла окно.
  const scheduled: BroadcastTargetClip[] = [
    { durationSeconds: 3_600, id: "a", name: "Фильм А", scheduleType: "movie" },
    { durationSeconds: 2_700, id: "b", name: "Фильм Б", scheduleType: "movie" },
  ];
  const result = plan({
    clips: scheduled,
    effect: sceneEffect("next-program", {}),
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.scenes[0]!.show.startSeconds, 3_570);
  assert.equal(result.scenes[0]!.show.durationSeconds, 7);
});

test("the announced title lands in the scene field the operator chose", () => {
  const scene = defaultSceneTemplate("next-program")!;
  const custom: SceneTemplate = {
    ...scene,
    fields: [
      { key: "programme", label: "Программа", type: "text", sample: "Программа" },
      { key: "airtime", label: "Время", type: "text", sample: "" },
    ],
  };
  const settings = {
    durationSeconds: 7,
    fallbackTitle: "",
    source: "playlist-name" as const,
    startOffsetSeconds: 30,
    style: style(),
    subtitleKey: "airtime",
    subtitleText: "в 21:00",
    taskFilePath: null,
    titleKey: "programme",
  };

  assert.deepEqual(nextProgramSceneFields(custom, settings, "Титаник"), {
    programme: "Титаник",
    airtime: "в 21:00",
  });

  // Ключ, которого в сцене нет, — это умолчание, а не выбор оператора: эффект
  // создаётся с `next_title`, и плашка обязана продолжать выходить в эфир.
  assert.deepEqual(
    nextProgramSceneFields(custom, { ...settings, titleKey: "next_title", subtitleKey: "next_subtitle" }, "Титаник"),
    { title: "Титаник", subtitle: "в 21:00" },
  );
});

test("the announcement reaches the clip through the field the scene declares", () => {
  const result = plan({
    effect: sceneEffect("next-program", {}),
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.errors, []);
  // Заводская сцена объявляет `title`, а настройки пришли с `next_title`.
  assert.equal(result.scenes[0]!.show.fields.title, "Вечерние новости");
});

test("the clock takes the scene field the operator declared, like a title does", () => {
  const countdown = {
    captionKey: "podpis",
    captionText: "До конца эфира",
    countdownSeconds: 60,
    countdownSource: "clip-remaining" as const,
    durationSeconds: 20,
    dynamicKey: "ostalos",
    format: "MM:SS" as const,
    mode: "countdown" as const,
    startSeconds: 5,
    style: style(),
    timezoneOffsetMinutes: 0,
  };
  const effect = sceneEffect("clock-countdown", { clockCountdown: countdown });
  const scene = effect.broadcast!.scene!;
  // Оператор собрал свою плашку: место под значение и подпись — объявленные поля.
  const custom: SceneTemplate = {
    ...scene,
    fields: [
      { key: "ostalos", label: "Осталось", type: "text", sample: "99:59" },
      { key: "podpis", label: "Подпись", type: "text", sample: "образец" },
    ],
    nodes: scene.nodes.map((node) => (node.id === "clock"
      ? { ...node, text: { kind: "field" as const, fieldKey: "ostalos" } }
      : node)),
  };
  const result = plan({
    effect: { ...effect, broadcast: { ...effect.broadcast!, scene: custom } },
    targetIds: new Set(["a"]),
  });

  assert.deepEqual(result.errors, []);
  const show = result.scenes[0]!.show;
  const valueNode = show.template.nodes.find((node) => node.id === "clock")!;
  // Значение считает рендерер по номеру кадра: эффект меняет источник узла,
  // а не подставляет цифру, замороженную на планировании.
  assert.equal(valueNode.text?.kind, "countdown");
  assert.equal(valueNode.text?.kind === "countdown" ? valueNode.text.source : "", "clip-remaining");
  // Подпись приходит из настроек, остальные поля — своим образцом: пустая
  // строка погасила бы объявленное поле прямо в эфире.
  assert.equal(show.fields.podpis, "До конца эфира");
  assert.equal(show.fields.ostalos, "99:59");
});

test("without a chosen field the clock still lands on the node that already is one", () => {
  const scene = defaultSceneTemplate("clock-countdown")!;
  assert.deepEqual(clockSceneFields(scene, {
    captionKey: "",
    captionText: "",
    countdownSeconds: 60,
    countdownSource: "fixed",
    durationSeconds: 60,
    dynamicKey: "",
    format: "HH:MM:SS",
    mode: "clock",
    startSeconds: 0,
    style: style(),
    timezoneOffsetMinutes: 0,
  }), {});

  const result = plan({
    effect: sceneEffect("clock-countdown", {}),
    targetIds: new Set(["a"]),
  });
  const clock = result.scenes[0]!.show.template.nodes.find((node) => node.id === "clock")!;
  assert.equal(clock.text?.kind, "clock");
});

test("ticker joins messages and closes the loop with the separator", () => {
  assert.equal(joinTickerItems(["one"], " • "), "one");
  assert.equal(joinTickerItems(["one", "two"], " • "), "one • two • ");
  assert.equal(joinTickerItems([" ", ""], " • "), "");
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

test("a title moved between operating systems rebinds its font by family", () => {
  const scene = defaultSceneTemplate("dynamic-title")!;
  const portable = {
    ...scene,
    nodes: scene.nodes.map((node) => node.kind === "text"
      ? { ...node, textStyle: {
          ...node.textStyle,
          fontFilePath: "/System/Library/Fonts/Supplemental/Arial.ttf",
          fontFamily: "Arial",
        } }
      : node),
  };
  const windowsArial = { family: "Arial", filePath: "C:\\Windows\\Fonts\\arial.ttf", cyrillic: true };
  const windowsFallback = { family: "Segoe UI", filePath: "C:\\Windows\\Fonts\\segoeui.ttf", cyrillic: true };
  const result = withSceneFont(portable, windowsFallback, [windowsArial, windowsFallback])!;

  assert.equal(
    result.nodes.find((node) => node.kind === "text")!.textStyle.fontFilePath,
    windowsArial.filePath,
  );
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
    scenes: [sceneShow("caption", "fx2-stinger", 1, 2)],
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
  assert.equal(moved.scenes[0]!.startSeconds, 8);
  assert.equal(moved.scenes[0]!.durationSeconds, 3);
  assert.equal(moved.audioOverlays[0]!.startSeconds, 8);
  assert.equal(moved.audioOverlays[0]!.durationSeconds, 3);
});

test("the track keeps its key after being moved, so a drag does not stall", () => {
  const asset = {
    effects: [{ ...fxLayer("plate", "fx2-title", 2), startSeconds: 1, endSeconds: 6 }],
    scenes: [sceneShow("caption", "fx2-title", 1, 5)],
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

test("an effect with a scene emits one show instead of a layer plus a caption", () => {
  const effect = sceneEffect("dynamic-title", {
    dynamicTitle: {
      ...broadcastEffect("dynamic-title", {}).broadcast!.settings.dynamicTitle,
      startSeconds: 2,
      durationSeconds: 5,
      text: "Александр Петров",
    },
  });
  const result = plan({ effect, targetIds: new Set(["a"]) });

  // Плашка и надпись стали узлами одной сцены: разойтись во времени им нечем.
  assert.deepEqual(result.layers, []);
  assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0]!.show.fields.title, "Александр Петров");
  assert.equal(result.scenes[0]!.show.startSeconds, 2);
  assert.equal(result.scenes[0]!.show.durationSeconds, 5);
});

test("the operator sets when and how long; the scene keeps its own entrance", () => {
  const effect = sceneEffect("dynamic-title", {
    dynamicTitle: {
      ...broadcastEffect("dynamic-title", {}).broadcast!.settings.dynamicTitle,
      durationSeconds: 4,
      text: "Тест",
    },
  });
  const show = plan({ effect, targetIds: new Set(["a"]) }).scenes[0]!.show;
  // Окна показа в сцене нет: режиссёр укладывает вход и выход внутрь этой
  // длительности сам.
  assert.ok(show.template.director.inSeconds > 0);
  assert.ok(show.template.director.outSeconds > 0);
  assert.equal(show.durationSeconds, 4);
});

test("a show that does not fit the clip is trimmed with a warning", () => {
  const effect = sceneEffect("dynamic-title", {
    dynamicTitle: {
      ...broadcastEffect("dynamic-title", {}).broadcast!.settings.dynamicTitle,
      startSeconds: 95,
      durationSeconds: 30,
      text: "Тест",
    },
  });
  const result = plan({ effect, targetIds: new Set(["a"]) });
  // Ролик длится 100 секунд: показ с 95-й обязан ужаться до пяти.
  assert.equal(result.scenes[0]!.show.durationSeconds, 5);
  assert.match(result.warnings.join(" "), /обрезан/);
});

test("ticker messages travel into the scene node that draws them", () => {
  const effect = sceneEffect("ticker-crawl", {
    tickerCrawl: {
      ...broadcastEffect("ticker-crawl", {}).broadcast!.settings.tickerCrawl,
      items: ["Первое", "Второе"],
      separator: " • ",
      startSeconds: 0,
      durationSeconds: 5,
    },
  });
  const show = plan({ effect, targetIds: new Set(["a"]) }).scenes[0]!.show;
  const ticker = show.template.nodes.find((node) => node.text?.kind === "ticker");
  assert.ok(ticker && ticker.text?.kind === "ticker");
  // Список правится там же, где источник и скорость, а рисует его узел сцены.
  assert.deepEqual(ticker.text.items, ["Первое", "Второе"]);
  assert.equal(ticker.text.separator, " • ");
});

test("clock settings choose between a clock node and a countdown node", () => {
  const base = broadcastEffect("clock-countdown", {}).broadcast!.settings.clockCountdown;
  const asCountdown = sceneEffect("clock-countdown", {
    clockCountdown: {
      ...base, mode: "countdown", countdownSource: "clip-remaining", durationSeconds: 5,
    },
  });
  const show = plan({ effect: asCountdown, targetIds: new Set(["a"]) }).scenes[0]!.show;
  const node = show.template.nodes.find((entry) => entry.text?.kind === "countdown");
  assert.ok(node && node.text?.kind === "countdown");
  assert.equal(node.text.source, "clip-remaining");
});

test("applying a plan puts the show on the clip and removing the effect takes it off", () => {
  const effect = sceneEffect("dynamic-title", {
    dynamicTitle: {
      ...broadcastEffect("dynamic-title", {}).broadcast!.settings.dynamicTitle,
      durationSeconds: 4,
      text: "Тест",
    },
  });
  const result = plan({ effect, targetIds: new Set(["a"]) });
  const assets = [{ effects: [], id: "a", name: "Ролик" }] as unknown as MediaAsset[];
  const applied = applyBroadcastPlan(assets, result);
  assert.equal(applied.items[0]!.scenes?.length, 1);

  const cleaned = removeBroadcastEffect(applied.items, effect.id);
  assert.deepEqual(cleaned[0]!.scenes, []);
});

test("removing a track takes the whole effect off the clip", () => {
  const asset = {
    effects: [{ ...fxLayer("plate", "fx2-title", 2), startSeconds: 1, endSeconds: 6 }],
    scenes: [sceneShow("caption", "fx2-title", 1, 5)],
  };
  const span = broadcastEffectSpans(asset)[0]!;
  const cleared = removeBroadcastEffectSpan(asset, span);

  assert.deepEqual(cleared.effects, []);
  assert.deepEqual(cleared.scenes, []);
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

/** Показ сцены на ролике — вторая часть эффекта рядом с FX-слоем. */
function sceneShow(id: string, effectId: string, startSeconds: number, durationSeconds: number) {
  return {
    id,
    effectId,
    template: defaultSceneTemplate("dynamic-title")!,
    fields: {},
    startSeconds,
    durationSeconds,
  };
}

test("only the two file-based kinds accept a graphic at all", () => {
  // Оформление вида со сценой рисует редактор титров: подставлять туда файл
  // нечего, и предлагать его оператору — значит обещать несуществующее.
  assert.equal(graphicFileRejection("animation-in-out", "/g/in.png"), null);
  assert.equal(graphicFileRejection("animation-in-out", "/g/in.mov"), null);
  assert.equal(graphicFileRejection("animation-in-out", "/g/in.webm"), null);
  assert.equal(graphicFileRejection("stinger-transition", "/g/wipe.mov"), null);
  assert.equal(graphicFileRejection("stinger-transition", "/g/wipe.png"), null);

  for (const kind of ["dynamic-title", "next-program", "clock-countdown", "ticker-crawl"] as const) {
    assert.match(
      graphicFileRejection(kind, "/g/plate.mov") ?? "",
      /оформление сценой/,
      `${kind} не должен принимать файл`,
    );
  }
});

test("a file the kind cannot use is named as such, not silently taken", () => {
  // .mp4 без альфы визуально неотличим в диалоге, а в эфире даёт чёрный
  // прямоугольник поверх картинки — отказ обязан быть до применения.
  assert.match(graphicFileRejection("stinger-transition", "/g/clip.mp4") ?? "", /альфой/);
  assert.match(graphicFileRejection("animation-in-out", "/g/title.json") ?? "", /альфа-каналом/);
});

test("the format check ignores case and paths without an extension", () => {
  assert.equal(graphicFileRejection("animation-in-out", "C:\\Anim\\Intro.MOV"), null);
  assert.match(
    graphicFileRejection("animation-in-out", "/g/README") ?? "",
    /файл без расширения/,
  );
});

test("animation in/out is applied from its chosen file and blocked without one", () => {
  // Оформление этому виду задаёт только оператор: сцены у него нет, и если
  // выбрать файл негде, эффект не применяется вовсе — так и жила регрессия.
  const chosen = broadcastEffect("animation-in-out", {});
  assert.equal(effectBlocker(chosen), null);

  const layers = plan({ effect: chosen }).layers;
  assert.ok(layers.length > 0, "слои не собрались");
  for (const { layer } of layers) {
    assert.equal(layer.filePath, "/graphics/decor.mov", "слой взял не выбранный файл");
  }

  const empty = broadcastEffect("animation-in-out", {});
  empty.broadcast!.decorationFilePath = null;
  assert.match(effectBlocker(empty) ?? "", /файл оформления/);
  assert.equal(plan({ effect: empty }).layers.length, 0);
});

test("a media node becomes an FX layer, not something the scene rasterizer draws", () => {
  // Декодировать видео покадрово в том же однопоточном процессе, что считает
  // титр, — верный способ не успеть к кадру. Подложку кладёт FFmpeg.
  const effect = sceneEffect("dynamic-title", {
    dynamicTitle: {
      ...sceneEffect("dynamic-title", {}).broadcast!.settings.dynamicTitle,
      text: "Гость",
    },
  });
  const scene = effect.broadcast!.scene!;
  scene.nodes = [...scene.nodes, {
    ...scene.nodes[0]!,
    id: "backdrop",
    name: "Подложка",
    kind: "video" as const,
    text: null,
    media: {
      filePath: "/media/lower.mov",
      fit: "contain" as const,
      loop: true,
      durationSeconds: 6,
      hasAlpha: true,
      sequenceFrameRate: null,
      sequenceStartNumber: null,
    },
  }];

  const result = plan({ effect, targetIds: new Set([clips[0]!.id]) });
  const layer = result.layers.find((entry) => entry.layer.name === "Подложка");
  assert.ok(layer, "медиа-узел не превратился в слой");
  assert.equal(layer.layer.filePath, "/media/lower.mov");
  assert.equal(layer.layer.kind, "video");
  assert.equal(layer.layer.tier, 2);
  // Показ сцены при этом остаётся: текст ложится поверх подложки.
  assert.equal(result.scenes.length, 1);
});

test("a backdrop without an alpha channel is called out before it hides the clip", () => {
  const effect = sceneEffect("dynamic-title", {
    dynamicTitle: {
      ...sceneEffect("dynamic-title", {}).broadcast!.settings.dynamicTitle,
      text: "Гость",
    },
  });
  const scene = effect.broadcast!.scene!;
  scene.nodes = [...scene.nodes, {
    ...scene.nodes[0]!,
    id: "backdrop",
    name: "Подложка",
    kind: "video" as const,
    text: null,
    media: {
      filePath: "/media/opaque.mp4",
      fit: "contain" as const,
      loop: true,
      durationSeconds: 6,
      hasAlpha: false,
      sequenceFrameRate: null,
      sequenceStartNumber: null,
    },
  }];
  const result = plan({ effect, targetIds: new Set([clips[0]!.id]) });
  assert.ok(result.warnings.some((warning) => /без альфа-канала/.test(warning)));
});

test("a png sequence carries its frame rate into the layer", () => {
  // В .png частоты нет, и без неё FFmpeg возьмёт своё умолчание — подложка
  // поедет по длительности.
  const effect = sceneEffect("dynamic-title", {
    dynamicTitle: {
      ...sceneEffect("dynamic-title", {}).broadcast!.settings.dynamicTitle,
      text: "Гость",
    },
  });
  const scene = effect.broadcast!.scene!;
  scene.nodes = [...scene.nodes, {
    ...scene.nodes[0]!,
    id: "seq",
    name: "Секвенция",
    kind: "image" as const,
    text: null,
    media: {
      filePath: "/media/frames/f_%04d.png",
      fit: "contain" as const,
      loop: false,
      durationSeconds: 4,
      hasAlpha: true,
      sequenceFrameRate: 25,
      sequenceStartNumber: 1,
    },
  }];
  const layer = plan({ effect, targetIds: new Set([clips[0]!.id]) })
    .layers.find((entry) => entry.layer.name === "Секвенция");
  assert.equal(layer?.layer.sequenceFrameRate, 25);
  assert.equal(layer?.layer.sequenceStartNumber, 1);
});

test("an effect that cannot be applied says so before the operator tries", () => {
  const stinger = broadcastEffect("stinger-transition", {
    stingerTransition: {
      ...broadcastEffect("stinger-transition", {}).broadcast!.settings.stingerTransition,
      assetPath: null,
    },
  });
  assert.match(effectBlocker(stinger) ?? "", /файл перехода/);

  const title = sceneEffect("dynamic-title", {});
  // У эффекта со сценой оформление есть всегда: блокировать нечего.
  assert.equal(effectBlocker(title), null);
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
    targetIds: new Set(["a"]),
  });

  // Отставший звуковой вход останавливает мультиплексор целиком, поэтому
  // выясняться это должно до применения, а не в эфире.
  assert.deepEqual(result.audioOverlays, []);
  assert.match(result.errors[0] ?? "", /звуковой дорожки/);
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

/* --------------------- поля титра из файла задания ------------------------ */

/** Сцена с произвольным набором полей — как её собрал бы оператор. */
function titleWithFields(keys: readonly string[]): GraphicEffectAsset {
  const effect = sceneEffect("dynamic-title", {
    dynamicTitle: {
      ...broadcastEffect("dynamic-title", {}).broadcast!.settings.dynamicTitle,
      source: "task-file",
      durationSeconds: 5,
    },
  });
  const scene = effect.broadcast!.scene!;
  return {
    ...effect,
    broadcast: {
      ...effect.broadcast!,
      scene: {
        ...scene,
        fields: keys.map((key) => ({ key, label: key, type: "text" as const, sample: "" })),
      },
    },
  };
}

test("a title takes its values from the record by the scene's own field names", () => {
  // Ключей может быть сколько угодно и называться они могут как угодно —
  // связка держится на совпадении имён, отдельного маппинга для неё нет.
  const effect = titleWithFields(["name", "age"]);
  const result = plan({
    effect,
    targetIds: null,
    taskEntries: [
      { name: "Инзерские зубчатки", values: { name: "Иван Петров", age: "38" } },
      { name: "Вечерние новости", values: { name: "Мария Ким", age: "29" } },
    ],
  });
  assert.equal(result.scenes.length, 2);
  assert.deepEqual(result.scenes[0]!.show.fields, { name: "Иван Петров", age: "38" });
  assert.deepEqual(result.scenes[1]!.show.fields, { name: "Мария Ким", age: "29" });
});

test("a clip with no record in the task file gets no title at all", () => {
  const effect = titleWithFields(["name", "age"]);
  const result = plan({
    effect,
    targetIds: null,
    taskEntries: [{ name: "Вечерние новости", values: { name: "Мария Ким", age: "29" } }],
  });
  assert.equal(result.scenes.length, 1, "титр поставлен ролику, которого нет в задании");
  assert.equal(result.scenes[0]!.assetId, "b");
  assert.match(result.warnings.join(" "), /записи в файле задания нет/);
});

test("a key missing from the record falls back to the value the operator typed", () => {
  const effect = titleWithFields(["name", "age"]);
  const withFallback: GraphicEffectAsset = {
    ...effect,
    broadcast: {
      ...effect.broadcast!,
      settings: {
        ...effect.broadcast!.settings,
        dynamicTitle: {
          ...effect.broadcast!.settings.dynamicTitle,
          fieldValues: { age: "—" },
        },
      },
    },
  };
  const result = plan({
    effect: withFallback,
    targetIds: new Set(["a"]),
    taskEntries: [{ name: "Инзерские зубчатки", values: { name: "Иван Петров" } }],
  });
  assert.deepEqual(result.scenes[0]!.show.fields, { name: "Иван Петров", age: "—" });
  assert.match(result.warnings.join(" "), /"age"/);
});

test("without a task file the same values go on every clip", () => {
  const effect = titleWithFields(["name", "age"]);
  const manual: GraphicEffectAsset = {
    ...effect,
    broadcast: {
      ...effect.broadcast!,
      settings: {
        ...effect.broadcast!.settings,
        dynamicTitle: {
          ...effect.broadcast!.settings.dynamicTitle,
          source: "manual",
          fieldValues: { name: "Прямой эфир", age: "12+" },
        },
      },
    },
  };
  const result = plan({ effect: manual, targetIds: null, taskEntries: [] });
  assert.equal(result.scenes.length, 2);
  for (const scene of result.scenes) {
    assert.deepEqual(scene.show.fields, { name: "Прямой эфир", age: "12+" });
  }
});

test("two records claiming the same clip leave it alone instead of guessing", () => {
  const effect = titleWithFields(["name"]);
  const result = plan({
    effect,
    targetIds: new Set(["a"]),
    taskEntries: [
      { name: "Инзерские зубчатки", values: { name: "Первый" } },
      { name: "инзерские зубчатки.mp4", values: { name: "Второй" } },
    ],
  });
  assert.deepEqual(result.scenes, []);
  assert.match(result.warnings.join(" "), /несколько записей/);
});

test("the clip-name key is picked by what the values are, not by what the key is called", () => {
  // В настоящей выгрузке `name` — имя гостя, а имя ролика лежит в `title`.
  // Выбор по знакомому слову молча давал ноль совпадений.
  const records = [
    { id: "1", title: "Инзерские зубчатки.mp4", name: "Иван Петров", age: "38" },
    { id: "2", title: "Вечерние новости.mp4", name: "Мария Ким", age: "29" },
  ];
  const schedule = ["Инзерские зубчатки", "Вечерние новости"];
  assert.equal(preferredMatchKey(records, schedule, "name"), "title");

  // Ключ может называться как угодно — решают значения.
  const odd = [{ media_ref: "Инзерские зубчатки.mp4", headline: "Гость" }];
  assert.equal(preferredMatchKey(odd, schedule, "name"), "media_ref");

  // Расписание пустое: остаются привычные имена.
  assert.equal(preferredMatchKey(records, [], "name"), "title");
  assert.equal(preferredMatchKey([{ media_id: "x", eng: "y" }], [], "name"), "media_id");
  assert.equal(preferredMatchKey([], [], "name"), "name");
});
