import assert from "node:assert/strict";
import test from "node:test";
import { workspaceSessionAssetSchema } from "@gruber/contracts";
import { scheduleExportRequest } from "./schedule-export.js";

test("manual export and session backup preserve row types, titles and audio", () => {
  const asset = workspaceSessionAssetSchema.parse({
    id: "clip", name: "clip.mp4", filePath: "/media/clip.mp4", duration: "00:00:10", durationSeconds: 10,
    codec: "h264", codecFamily: "h264", codecProfile: "High", resolution: "1280x720", fps: "25", bitrate: "2M", size: "1M", status: "analyzed", preview: "preview", colorSpace: "bt709", audio: "aac", sha256: "test",
    ageTitle: { enabled: true, text: "16+", durationSeconds: 10 },
    audioTracks: [{ languageCode: "eng", label: "English", filePath: "/media/Audio/eng.wav", durationSeconds: 10 }],
  });
  const request = scheduleExportRequest((["chop", "clip", "movie"] as const).map((scheduleType) => ({ ...asset, scheduleType })), null, [], null);
  assert.deepEqual(request.items.map((item) => item.type), ["chop", "clip", "movie"]);
  assert.equal(request.items[0]?.ageTitle?.text, "16+");
  assert.equal(request.items[0]?.audioTracks?.[0]?.filePath, "/media/Audio/eng.wav");
  assert.equal(request.audioLanguages[0]?.itemCount, 3);
});
