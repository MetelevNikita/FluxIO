import assert from "node:assert/strict";
import test from "node:test";
import type { GraphicEffectAsset, GraphicEffectLayer } from "@gruber/contracts";
import {
  applyGraphicReplacements,
  collectMissingGraphics,
  dropMissingGraphics,
  graphicPathsOf,
} from "./missing-graphics.js";
import type { MediaAsset } from "./types.js";

function layer(overrides: Partial<GraphicEffectLayer> = {}): GraphicEffectLayer {
  return {
    backgroundPath: "/fx/lower.mov",
    blendMode: "alpha",
    effectId: "fx-lower",
    endSeconds: 5,
    filePath: "/fx/lower.mov",
    id: `layer-${Math.random()}`,
    kind: "video",
    offsetXPercent: 0,
    offsetYPercent: 0,
    lumaThreshold: 0.08,
    name: "lower",
    sourceDurationSeconds: 5,
    sourceInSeconds: 0,
    startSeconds: 0,
    tier: 3,
    titlePath: null,
    titlePaths: [],
    ...overrides,
  };
}

function asset(id: string, effects: GraphicEffectLayer[]): MediaAsset {
  return { effects, id, name: id } as unknown as MediaAsset;
}

function libraryEffect(overrides: Partial<GraphicEffectAsset> = {}): GraphicEffectAsset {
  return {
    broadcast: null,
    durationSeconds: 5,
    filePath: "/fx/lower.mov",
    height: 1_080,
    id: "fx-lower",
    kind: "video",
    lottie: null,
    name: "lower",
    titleDirectoryPath: null,
    titlePaths: [],
    width: 1_920,
    ...overrides,
  };
}

test("graphic paths cover the background and the per-clip title of every layer", () => {
  const paths = graphicPathsOf([[asset("a", [layer({
    backgroundPath: "/fx/bg.mov",
    filePath: "/fx/bg.mov",
    titlePath: "/fx/titles/a.png",
  })])]]);
  assert.deepEqual(paths.sort(), ["/fx/bg.mov", "/fx/titles/a.png"]);
});

test("a graphic is reported once with the number of clips that use it", () => {
  const playlist = [asset("a", [layer()]), asset("b", [layer()])];
  const missing = collectMissingGraphics([playlist], [libraryEffect()], new Set(["/fx/lower.mov"]));

  assert.equal(missing.length, 1);
  assert.equal(missing[0]!.usageCount, 2);
  assert.equal(missing[0]!.reason, "file-missing");
  // Файла нет, но сам эффект в библиотеке есть — это разные потери.
  assert.equal(missing[0]!.inLibrary, true);
});

test("a schedule imported into an empty project reports graphics as not in the library", () => {
  const missing = collectMissingGraphics([[asset("a", [layer()])]], [], new Set());

  assert.equal(missing.length, 1);
  assert.equal(missing[0]!.reason, "not-in-library");
  assert.equal(missing[0]!.inLibrary, false);
});

test("second-level effects are not reported: their file belongs to the preset", () => {
  const broadcastLayer = layer({ filePath: "/fx/stinger.mov", name: "Stinger", tier: 2 });
  assert.deepEqual(
    collectMissingGraphics([[asset("a", [broadcastLayer])]], [], new Set(["/fx/stinger.mov"])),
    [],
  );
});

test("a replacement keeps the layer window and swaps only the source", () => {
  const playlist = [asset("a", [layer({ endSeconds: 9, startSeconds: 4 })])];
  const replacement = libraryEffect({
    durationSeconds: 12,
    filePath: "/new/lower-third.mov",
    id: "fx-new",
    name: "lower-third",
  });

  const result = applyGraphicReplacements(playlist, new Map([["/fx/lower.mov", replacement]]));
  assert.equal(result.replaced, 1);
  const [updated] = result.items[0]!.effects!;
  assert.equal(updated!.filePath, "/new/lower-third.mov");
  assert.equal(updated!.backgroundPath, "/new/lower-third.mov");
  assert.equal(updated!.effectId, "fx-new");
  assert.equal(updated!.sourceDurationSeconds, 12);
  assert.equal(updated!.startSeconds, 4);
  assert.equal(updated!.endSeconds, 9);
});

test("graphics left without a replacement are dropped from the clips", () => {
  const playlist = [asset("a", [layer(), layer({ filePath: "/fx/keep.png", name: "keep" })])];
  const cleaned = dropMissingGraphics(playlist, new Set(["/fx/lower.mov"]));

  assert.equal(cleaned[0]!.effects!.length, 1);
  assert.equal(cleaned[0]!.effects![0]!.filePath, "/fx/keep.png");
});
