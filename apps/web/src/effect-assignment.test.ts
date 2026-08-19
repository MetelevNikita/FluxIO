import assert from "node:assert/strict";
import test from "node:test";
import type { GraphicEffectAsset } from "@gruber/contracts";
import {
  appendLottieEffectInstances,
  assignEffectToAssets,
  lottieTextValues,
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
      properties: [{
        animated: false,
        group: "Text",
        id: "text-1",
        label: "Title",
        overridden: true,
      textBox: null,
        path: "layers.0.t.d.k.0.s.t",
        type: "text",
        value: "News",
      }],
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
