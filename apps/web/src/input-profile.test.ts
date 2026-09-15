import assert from "node:assert/strict";
import test from "node:test";
import { inputProfileMismatch } from "./input-profile.js";
import type { MediaAsset } from "./types.js";

test("input profile reports each mismatch after probing and ignores pending rows", () => {
  const asset = {
    status: "analyzed", filePath: "C:\\media\\clip.mkv", codecFamily: "HEVC", resolution: "1280×720",
  } as MediaAsset;
  const profile = { container: "mp4", codec: "h264", width: 1920, height: 1080 };
  assert.equal(inputProfileMismatch(asset, profile).length, 3);
  assert.deepEqual(inputProfileMismatch({ ...asset, status: "pending" }, profile), []);
  assert.deepEqual(inputProfileMismatch({ ...asset, filePath: "C:\\media\\clip.mp4", codecFamily: "H264", resolution: "1920×1080" }, profile), []);
  assert.deepEqual(inputProfileMismatch({ ...asset, filePath: "C:\\media\\clip.mp4", codecFamily: "H.264", resolution: "1920×1080" }, profile), []);
  assert.equal(inputProfileMismatch({ ...asset, filePath: "C:\\media\\clip.mp4", containerFormat: "matroska,webm", codecFamily: "H264", resolution: "1920×1080" }, profile).length, 1);
});
