import assert from "node:assert/strict";
import test from "node:test";
import { initialBroadcastSettings } from "./default-broadcast-settings.js";
import {
  applyEncodingSettingsProfile,
  createEncodingSettingsProfile,
  parseEncodingSettingsProfile,
  serializeEncodingSettingsProfile,
} from "./encoding-settings-profile.js";

test("encoding settings profile round-trips every portable setting and omits secrets", () => {
  const source = {
    ...initialBroadcastSettings,
    protocol: "UDP",
    targetBitrate: 10.5,
    ageTitleDurationSeconds: 30,
    udpHost: "239.20.20.20",
    udpPcrPeriodMs: 26,
    loudnessNormalizationEnabled: true,
    loudnessTargetLufs: -23,
    streamKey: "legacy-secret",
    srtPassphrase: "srt-secret-value",
    rtmpStreamKey: "rtmp-secret-value",
  };
  const profile = createEncodingSettingsProfile(
    source,
    "6.0.20",
    new Date("2026-08-07T12:00:00.000Z"),
  );
  const serialized = serializeEncodingSettingsProfile(profile);

  assert.doesNotMatch(serialized, /legacy-secret|srt-secret-value|rtmp-secret-value/);
  const restored = applyEncodingSettingsProfile(
    parseEncodingSettingsProfile(serialized),
    initialBroadcastSettings,
  );
  assert.equal(restored.protocol, "UDP");
  assert.equal(restored.targetBitrate, 10.5);
  assert.equal(restored.ageTitleDurationSeconds, 30);
  assert.equal(restored.udpHost, "239.20.20.20");
  assert.equal(restored.udpPcrPeriodMs, 26);
  assert.equal(restored.loudnessNormalizationEnabled, true);
  assert.equal(restored.loudnessTargetLufs, -23);
  assert.equal(restored.srtPassphrase, "");
  assert.equal(restored.rtmpStreamKey, "");
});

test("encoding settings profile rejects another file format", () => {
  assert.throws(
    () => parseEncodingSettingsProfile('{"format":"other","formatVersion":1}'),
    /Invalid input/,
  );
});
