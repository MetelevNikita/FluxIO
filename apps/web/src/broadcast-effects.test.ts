import assert from "node:assert/strict";
import test from "node:test";
import type { GraphicEffectAsset, LottieEditableProperty } from "@gruber/contracts";
import {
  applyBroadcastPlan,
  joinTickerItems,
  lottieTextFieldKey,
  planBroadcastEffect,
  removeBroadcastEffect,
  snapToFrameGrid,
  type BroadcastTargetClip,
  type PlanBroadcastEffectInput,
} from "./broadcast-effects.js";
import type { MediaAsset } from "./types.js";

let nextId = 0;
const createId = () => `id${(nextId += 1)}`;

function textProperty(group: string, id: string): LottieEditableProperty {
  return {
    animated: false,
    group,
    id,
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
      properties,
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
): GraphicEffectAsset {
  return {
    broadcast: {
      kind: kind as never,
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
          countdownSeconds: 60,
          durationSeconds: 60,
          format: "HH:MM:SS",
          mode: "clock",
          startSeconds: 0,
          style: style(),
          timezoneOffsetMinutes: 0,
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
          filePath: null,
          items: [],
          repeat: 0,
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

function style() {
  return {
    boxColor: "#000000",
    boxEnabled: true,
    boxOpacity: 0.62,
    boxPaddingPercent: 0.9,
    color: "#FFFFFF",
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
    preset: null,
    targetIds: null,
    taskEntries: [],
    ...overrides,
  });
}

test("lottie text field key uses the layer name and the Essential Graphics slot id", () => {
  assert.equal(lottieTextFieldKey(textProperty("Main composition · eng", "p1")), "eng");
  assert.equal(lottieTextFieldKey(textProperty("Main composition · Title · Slot rus", "p2")), "rus");
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

test("animation in/out refuses an ambiguous or missing clip name", () => {
  const duplicate = plan({
    clips: [
      { durationSeconds: 100, id: "a", name: "Повтор" },
      { durationSeconds: 100, id: "b", name: "Повтор" },
    ],
    effect: broadcastEffect("animation-in-out", {}),
    preset: preset([textProperty("Main composition · eng", "prop-eng")]),
    taskEntries: [{ name: "Повтор", values: {} }, { name: "Нет такого", values: {} }],
  });

  assert.equal(duplicate.layers.length, 0);
  assert.equal(duplicate.errors.length, 2);
  assert.match(duplicate.errors[0]!, /2 clips share this name/);
  assert.match(duplicate.errors[1]!, /no clip with this name/);
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
  assert.deepEqual(result.renders[0]!.overrides, { "prop-title": "Вечерние новости" });
  assert.match(result.warnings[0]!, /is the last clip and has no fallback title/);
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

test("ticker joins messages and closes the loop with the separator", () => {
  assert.equal(joinTickerItems(["one"], " • "), "one");
  assert.equal(joinTickerItems(["one", "two"], " • "), "one • two • ");
  assert.equal(joinTickerItems([" ", ""], " • "), "");
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
  assert.equal(head!.layer.blendMode, "luma");
  assert.equal(head!.layer.tier, 2);
  // Звук режется тем же швом, чтобы переход не был слышен дважды.
  assert.equal(result.audioOverlays.length, 2);
  assert.equal(result.audioOverlays[0]!.overlay.startSeconds, 99.48);
  assert.equal(result.audioOverlays[1]!.overlay.sourceInSeconds, 0.52);
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
