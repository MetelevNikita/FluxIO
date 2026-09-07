import assert from "node:assert/strict";
import test from "node:test";

import { initialBroadcastSettings } from "./default-broadcast-settings.js";
import {
  audioCodecOptionsFor,
  outputCapabilitiesOf,
  outputProtocolOf,
  settingsForOutputProtocol,
  videoCodecOptionsFor,
} from "./output-capabilities.js";

test("RTMPS is read as the same FLV transport as RTMP", () => {
  // Отдельная подпись протокола в интерфейсе — это TLS поверх того же FLV.
  // Разойдись они, при RTMPS запирать было бы нечего.
  assert.equal(outputProtocolOf("RTMP"), "rtmp");
  assert.equal(outputProtocolOf("RTMPS"), "rtmp");
  assert.equal(outputProtocolOf("UDP"), "udp");
  assert.equal(outputProtocolOf("SRT"), "srt");
  assert.equal(outputCapabilitiesOf("RTMPS").mpegTs, false);
  assert.equal(outputCapabilitiesOf("SRT").mpegTs, true);
});

test("switching to RTMP turns off what FLV cannot carry and keeps the rest", () => {
  const settings = {
    ...initialBroadcastSettings,
    protocol: "UDP",
    videoCodec: "MPEG-2 Video",
    audioCodec: "MP2",
    scte35PlanningEnabled: true,
    subtitleOutputMode: "DVB Subtitles" as const,
    audioTracksEnabled: true,
    udpTransportBitrate: 12,
    udpServiceName: "Первый",
    udpVideoPid: 512,
  };

  const rtmp = settingsForOutputProtocol(settings, "RTMPS");
  assert.equal(rtmp.protocol, "RTMPS");
  assert.equal(rtmp.videoCodec, "H.264");
  assert.equal(rtmp.audioCodec, "AAC-LC");
  assert.equal(rtmp.scte35PlanningEnabled, false);
  assert.equal(rtmp.subtitleOutputMode, "Burn-in");
  assert.equal(rtmp.audioTracksEnabled, false);
  assert.equal(rtmp.udpTransportBitrate, 0);
  // Именованные поля и PID переживают заход на RTMP и обратно: инженер сменил
  // протокол, а не отказался от настройки службы MPEG-TS.
  assert.equal(rtmp.udpServiceName, "Первый");
  assert.equal(rtmp.udpVideoPid, 512);

  // SRT несёт тот же MPEG-TS, что и UDP: снимать нечего.
  const srt = settingsForOutputProtocol(settings, "SRT");
  assert.equal(srt.videoCodec, "MPEG-2 Video");
  assert.equal(srt.scte35PlanningEnabled, true);
  assert.equal(srt.subtitleOutputMode, "DVB Subtitles");
  assert.equal(srt.audioTracksEnabled, true);
  assert.equal(srt.udpTransportBitrate, 12);

  const mixed = settingsForOutputProtocol({
    ...settings,
    outputStreams: [{
      id: "output-2",
      name: "Head-end",
      enabled: true,
      endpoint: {
        protocol: "srt",
        host: "127.0.0.1",
        port: 9001,
        mode: "caller",
        latencyMs: 120,
        passphrase: "",
        streamId: "",
        mpegTs: {
          serviceName: "FluxIO",
          serviceId: 1,
          providerName: "FluxIO",
          videoPid: 256,
          audioPid: 257,
          serviceType: "digital_tv",
          pcrPeriodMs: 20,
          transportBitrateKbps: 0,
        },
      },
      transcode: null,
    }],
  }, "RTMP");
  assert.equal(mixed.scte35PlanningEnabled, true);
  assert.equal(mixed.videoCodec, "MPEG-2 Video");
});

test("codec lists offer only what the container carries", () => {
  assert.deepEqual(videoCodecOptionsFor("RTMP"), ["H.264"]);
  assert.deepEqual(audioCodecOptionsFor("RTMP"), ["AAC-LC"]);
  assert.deepEqual(videoCodecOptionsFor("SRT"), ["H.264", "H.265", "MPEG-2 Video"]);
  assert.deepEqual(audioCodecOptionsFor("UDP"), ["AAC-LC", "MP2", "AC-3"]);
});
