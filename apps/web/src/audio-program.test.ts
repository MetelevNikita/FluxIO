import assert from "node:assert/strict";
import test from "node:test";

import { assetAudioLanes } from "./audio-program.js";
import type { AudioTrackInfo, MediaAsset } from "./types.js";

function asset(durationSeconds: number, audioTracks: AudioTrackInfo[]): MediaAsset {
  return {
    id: "asset-1",
    name: "clip.mp4",
    duration: "00:00:10:00",
    durationSeconds,
    codec: "h264",
    codecFamily: "H264",
    codecProfile: "high",
    resolution: "1920×1080",
    fps: "25.000 fps",
    bitrate: "8.0 Mbps",
    size: "10 MB",
    status: "analyzed",
    progress: 100,
    preview: "",
    filePath: "/media/clip.mp4",
    colorSpace: "bt709",
    audio: "aac 48000 Hz 2 ch",
    sha256: "ffprobe analyzed",
    audioTracks,
  };
}

function track(label: string, durationSeconds: number | null): AudioTrackInfo {
  return {
    languageCode: label.slice(0, 3),
    label,
    filePath: `/media/{${label}} clip.m4a`,
    streamIndex: 0,
    durationSeconds,
  };
}

test("original lane always covers the whole clip", () => {
  const [original] = assetAudioLanes(asset(120, []), [], "rus");

  assert.equal(original?.kind, "original");
  assert.equal(original?.fill, 1);
  assert.equal(original?.shortfallSeconds, 0);
});

test("a language without a file for this item is a silent lane", () => {
  const lanes = assetAudioLanes(asset(120, []), ["eng"], "rus");

  assert.equal(lanes[1]?.kind, "silent");
  assert.equal(lanes[1]?.fill, 0);
  assert.equal(lanes[1]?.shortfallSeconds, 120);
});

test("a track shorter than the clip fills only its own share", () => {
  const lanes = assetAudioLanes(asset(120, [track("eng", 90)]), ["eng"], "rus");

  assert.equal(lanes[1]?.kind, "partial");
  assert.equal(lanes[1]?.fill, 0.75);
  assert.equal(lanes[1]?.shortfallSeconds, 30);
});

test("a track longer than the clip is clamped instead of overflowing the lane", () => {
  const lanes = assetAudioLanes(asset(120, [track("eng", 300)]), ["eng"], "rus");

  assert.equal(lanes[1]?.kind, "present");
  assert.equal(lanes[1]?.fill, 1);
  assert.equal(lanes[1]?.shortfallSeconds, 0);
});

test("an unknown track duration draws a full lane rather than a false shortfall", () => {
  const lanes = assetAudioLanes(asset(120, [track("eng", null)]), ["eng"], "rus");

  assert.equal(lanes[1]?.kind, "present");
  assert.equal(lanes[1]?.fill, 1);
  assert.equal(lanes[1]?.shortfallSeconds, 0);
});

test("lanes follow the programme order so PID assignment stays readable", () => {
  const lanes = assetAudioLanes(
    asset(60, [track("spain", 60), track("eng", 30)]),
    ["eng", "spain"],
    "rus",
  );

  assert.deepEqual(lanes.map((lane) => lane.label), ["rus", "eng", "spain"]);
});
