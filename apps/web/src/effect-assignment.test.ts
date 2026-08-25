import assert from "node:assert/strict";
import test from "node:test";
import { broadcastEffectDefinitionSchema, type GraphicEffectAsset } from "@gruber/contracts";
import {
  appendLottieEffectInstances,
  assignEffectToAssets,
  lottieTextValues,
  removeEffectFromLibrary,
} from "./effect-assignment.js";
import type { MediaAsset } from "./types.js";

test("the same FX can be assigned to one clip multiple times as independent layers", () => {
  const effect: GraphicEffectAsset = {
    durationSeconds: 5,
    filePath: "/graphics/title.mov",
    height: 1080,
    id: "title",
    kind: "video",
    lottie: null,
    broadcast: null,
    name: "Title",
    titleDirectoryPath: null,
    titlePaths: [],
    width: 1920,
  };
  const asset = mediaAsset();
  let sequence = 0;
  const createId = () => `instance-${++sequence}`;

  const first = assignEffectToAssets([asset], effect, undefined, createId);
  const second = assignEffectToAssets(first.items, effect, undefined, createId);

  assert.equal(first.added, 1);
  assert.equal(second.added, 1);
  assert.deepEqual(
    second.items[0]?.effects?.map((layer) => [layer.effectId, layer.id]),
    [["title", "instance-1"], ["title", "instance-2"]],
  );
});

test("the same Lottie source can be imported repeatedly as independent projects", () => {
  const effect: GraphicEffectAsset = {
    durationSeconds: 5,
    filePath: "/cache/title.mov",
    height: 1080,
    id: "fx-source",
    kind: "video",
    broadcast: null,
    lottie: {
      backgroundColor: "transparent",
      frameRate: 25,
      inPoint: 0,
      outPoint: 125,
      dataBindings: [],
      dataSourceName: null,
      matchSourceKey: null,
      properties: [{
        animated: false,
        group: "Text",
        id: "text-1",
        label: "Title",
        overridden: true,
      textBox: null,
      fitSample: null,
        path: "layers.0.t.d.k.0.s.t",
        type: "text",
        value: "News",
      }],
      responsiveTextKeys: [],
      sourcePath: "/graphics/title.json",
      version: "5.12",
      warnings: [],
    },
    name: "Title",
    titleDirectoryPath: null,
    titlePaths: [],
    width: 1920,
  };
  let sequence = 0;
  const first = appendLottieEffectInstances([], [effect], () => `copy-${++sequence}`);
  const second = appendLottieEffectInstances(first, [effect], () => `copy-${++sequence}`);

  assert.deepEqual(second.map((entry) => [entry.id, entry.name]), [
    ["fx-source-copy-1", "Title"],
    ["fx-source-copy-2", "Title (2)"],
  ]);
  assert.deepEqual(lottieTextValues(second[1]!), ["News"]);
});

test("removing an effect takes its graphics with it", () => {
  const library = [
    broadcastEffect("fx2-title", "art-a"),
    graphicAsset("art-a"),
    broadcastEffect("fx2-clock", null),
  ];
  assert.deepEqual(
    removeEffectFromLibrary(library, "fx2-title").map((entry) => entry.id),
    ["fx2-clock"],
  );
});

test("graphics shared by another effect survive the removal", () => {
  const library = [
    broadcastEffect("fx2-title", "art-a"),
    broadcastEffect("fx2-next", "art-a"),
    graphicAsset("art-a"),
  ];
  // Общий файл гасить нельзя: у соседнего эффекта пропала бы графика.
  assert.deepEqual(
    removeEffectFromLibrary(library, "fx2-title").map((entry) => entry.id),
    ["fx2-next", "art-a"],
  );
});

test("removing an effect keeps the operator's order of the rest", () => {
  const library = [
    broadcastEffect("fx2-a", null),
    broadcastEffect("fx2-b", "art-b"),
    graphicAsset("art-b"),
    broadcastEffect("fx2-c", null),
  ];
  // Порядок в библиотеке задаёт порядок наложения слоёв — перетасовать его
  // удаление не имеет права.
  assert.deepEqual(
    removeEffectFromLibrary(library, "fx2-b").map((entry) => entry.id),
    ["fx2-a", "fx2-c"],
  );
});

test("removing graphics that no effect points at changes nothing else", () => {
  const library = [broadcastEffect("fx2-a", null), graphicAsset("art-a")];
  assert.deepEqual(
    removeEffectFromLibrary(library, "fx2-a").map((entry) => entry.id),
    ["art-a"],
  );
});

function graphicAsset(id: string): GraphicEffectAsset {
  return {
    durationSeconds: 0,
    filePath: `/graphics/${id}.mov`,
    height: 1080,
    id,
    kind: "video",
    name: `${id}.mov`,
    titleDirectoryPath: null,
    titlePaths: [],
    width: 1920,
    lottie: null,
    broadcast: null,
  };
}

function broadcastEffect(id: string, presetEffectId: string | null): GraphicEffectAsset {
  return {
    ...graphicAsset(id),
    filePath: "broadcast://dynamic-title",
    // Настройки берём из самой схемы: удалению важен только presetEffectId,
    // а руками собранный объект разошёлся бы с контрактом на первой же правке.
    broadcast: broadcastEffectDefinitionSchema.parse({ kind: "dynamic-title", presetEffectId }),
  };
}

function mediaAsset(): MediaAsset {
  return {
    audio: "AAC stereo",
    bitrate: "2500 kbps",
    codec: "H.264",
    codecFamily: "h264",
    codecProfile: "High",
    colorSpace: "BT.709",
    duration: "00:00:20",
    durationSeconds: 20,
    filePath: "/media/program.mp4",
    fps: "25",
    id: "program",
    name: "program.mp4",
    preview: "",
    resolution: "1920x1080",
    sha256: "test",
    size: "1 MB",
    status: "analyzed",
  };
}
