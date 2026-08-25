import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultMpegTsOutputSettings,
  defaultSubtitleOutput,
  playoutStatusSchema,
  serviceHealthSchema,
  startPlayoutRequestSchema,
  systemMetricsSchema,
  workspaceSessionSnapshotSchema,
  type StartPlayoutRequest,
} from "@gruber/contracts";
import { buildApp } from "./app.js";
import {
  buildDailyReport,
  emptyDailyStats,
  formatLogLine,
  logFileName,
  observeStatus,
} from "./logging/daily-log.js";
import {
  parseBroadcastTaskDocument,
  parseTickerFeed,
  parseTickerSourceDocument,
} from "./effects/broadcast-task.js";
import { readFontFamily, supportsCyrillic } from "./effects/system-fonts.js";
import { buildTextOverlayFilter } from "./ffmpeg/text-overlay.js";
import {
  buildFfmpegClipAudioProducerCommand,
  clipAudioByteCount,
  clipAudioSampleCount,
  buildFfmpegClipVideoProducerCommand,
  buildFfmpegCompositePreviewCommand,
  buildFfmpegCommand,
  buildFfmpegProgramEncoderCommand,
  isSupportedLogoPath,
  logoFilterChain,
  logoInputArgs,
  logoSourceKind,
  type PreparedPlayoutItem,
} from "./ffmpeg/command-builder.js";
import {
  buildTransportPreviewCommand,
  transportPreviewPlaylistName,
} from "./ffmpeg/transport-preview.js";
import { FfmpegCapabilitiesService } from "./ffmpeg/capabilities.js";
import { MediaPreviewService } from "./ffmpeg/media-preview.js";
import {
  alignHotChangePlaylist,
  clipAudioSilenceBytes,
  formatEncodingActivity,
  formatFrameProgressLog,
  estimateCommandLineCharacters,
  isTsdDuckContinuityWarning,
  mapWithConcurrency,
  measurePcmS16leDbfs,
  PlayoutSupervisor,
  shouldReportEncodingActivity,
  shouldTransitionToFutureSchedule,
  usesTsdDuckTransport,
  waitForPlayoutStop,
} from "./ffmpeg/playout-supervisor.js";
import { runCommand } from "./ffmpeg/process.js";
import {
  checkpointFromStatus,
  DatabaseService,
  recoverableCheckpointFromStatus,
  sanitizeWorkspaceSnapshot,
} from "./database/database.js";
import { calculateCpuPercent } from "./system-metrics.js";
import { listNetworkInterfaces } from "./network-interfaces.js";
import {
  applyLottieProperties,
  fitPlatesToText,
  inspectLottieDocument,
} from "./effects/lottie.js";
import {
  decodeScheduleBuffer,
  parseScheduleText,
  ScheduleParseError,
} from "./schedule/parser.js";
import { formatScheduleTimecode, serializeSchedule } from "./schedule/serializer.js";
import { buildScte35CueXml, planScte35Cues } from "./tsduck/cue-builder.js";
import {
  buildDvbSubtitlePmtPatch,
  buildTsdDuckCommand,
  calculateTransportMuxRate,
  pcrInsertionThresholdMs,
} from "./tsduck/command-builder.js";
import { buildGstreamerDvbSubtitleCommand } from "./subtitles/gstreamer.js";
import { measureTextWidth, readFontMetrics } from "./effects/font-metrics.js";
import { fitRectangleToText } from "./effects/lottie.js";
import {
  buildDvbSubtitleProject,
  buildSubtitleTimeline,
  decodeSubtitleBuffer,
  parseSrt,
  sanitizeCueText,
} from "./subtitles/srt-project.js";
import {
  evaluateDvbSubtitleClock,
  ffmpegMpegTsOutputOffsetSeconds,
  mpegTsClockOriginSeconds,
  mpegTsPtsWrapMs,
} from "./transport-clock.js";

test("GET /api/health returns the shared service contract", async () => {
  const app = buildApp({ logger: false });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    assert.equal(response.statusCode, 200);

    const health = serviceHealthSchema.parse(response.json());
    assert.equal(health.service, "gruber-media-server");
    assert.equal(health.version, "7.0.17");
    assert.equal(health.status, process.env.DATABASE_URL ? "ready" : "degraded");
  } finally {
    await app.close();
  }
});

test("Lottie inspector exposes operator properties and preserves animation until override", () => {
  const document = {
    v: "5.12.2",
    fr: 25,
    ip: 0,
    op: 50,
    w: 1920,
    h: 1080,
    layers: [
      {
        ty: 1,
        nm: "fit:Title",
        hd: false,
        sc: "#112233",
        ks: {
          o: { a: 1, k: [{ t: 0, s: [0] }, { t: 10, s: [100] }] },
          p: { a: 0, k: [960, 900, 0] },
          s: { a: 0, k: [100, 100, 100] },
          r: { a: 0, k: 0 },
        },
        shapes: [{ ty: "fl", nm: "Accent", c: { a: 0, k: [1, 0.5, 0, 1] } }],
      },
      {
        ty: 5,
        nm: "Title",
        ks: {
          o: { a: 0, k: 100 },
          p: { a: 0, k: [100, 100, 0] },
          s: { a: 0, k: [100, 100, 100] },
          r: { a: 0, k: 0 },
        },
        t: { d: { k: [{ s: { t: "Original title" } }] } },
      },
    ],
  };

  const metadata = inspectLottieDocument(document, "/graphics/lower-third.json");
  assert.equal(metadata.frameRate, 25);
  assert.equal(metadata.outPoint - metadata.inPoint, 50);
  assert.ok(metadata.properties.some((property) =>
    property.label === "Opacity" && property.animated && !property.overridden));
  assert.ok(metadata.properties.some((property) =>
    property.label === "Fill · Accent" && property.value === "#FF8000"));
  assert.ok(metadata.properties.some((property) =>
    property.label === "Text" && property.value === "Original title"));
  assert.deepEqual(metadata.responsiveTextKeys, ["Title"]);
  const scale = metadata.properties.find((property) => property.label === "Scale");
  assert.deepEqual(scale?.originalValue, [100, 100, 100]);
  assert.match(metadata.warnings.join(" "), /Animated properties are preserved/);
});

test("Flux Title Exporter metadata exposes only fields selected in After Effects", () => {
  const document = {
    v: "5.12.2",
    fr: 25,
    ip: 0,
    op: 50,
    w: 1920,
    h: 1080,
    meta: {
      generator: "Flux Title Exporter 0.1.0",
      flux: {
        schemaVersion: 1,
        fields: [{ key: "title", layerName: "Title", type: "text" }],
        dataSourceName: "rundown.json",
        matchSourceKey: "media.name",
        dataBindings: [{ sourceKey: "programme.title", targetKey: "Title" }],
        warnings: ["Glow is not part of the safe Lottie subset"],
      },
    },
    layers: [
      {
        ty: 5,
        nm: "Title",
        t: { d: { k: [{ s: { t: "Editable" }, t: 0 }] } },
      },
      {
        ty: 5,
        nm: "Permanent caption",
        t: { d: { k: [{ s: { t: "Baked into design" }, t: 0 }] } },
      },
    ],
  };

  const metadata = inspectLottieDocument(document, "/graphics/exported-title.json");
  const textProperties = metadata.properties.filter((property) => property.type === "text");
  assert.equal(textProperties.length, 1);
  assert.equal(textProperties[0]?.value, "Editable");
  assert.equal(metadata.dataSourceName, "rundown.json");
  assert.equal(metadata.matchSourceKey, "media.name");
  assert.deepEqual(metadata.dataBindings, [
    { sourceKey: "programme.title", targetKey: "Title" },
  ]);
  assert.match(metadata.warnings.join(" "), /Glow is not part/);
});

test("Lottie operator overrides update visibility, text and animated values", () => {
  const document = {
    v: "5.12.2",
    fr: 25,
    ip: 0,
    op: 25,
    w: 640,
    h: 360,
    layers: [{
      nm: "Title",
      hd: false,
      ks: { o: { a: 1, k: [{ t: 0, s: [0] }, { t: 10, s: [100] }] } },
      t: { d: { k: [{ s: { t: "Before" } }] } },
    }],
  };
  const metadata = inspectLottieDocument(document, "/graphics/title.json");
  const properties = metadata.properties.map((property) => {
    if (property.label === "Visible") return { ...property, value: false, overridden: true };
    if (property.label === "Opacity") return { ...property, value: 72, overridden: true };
    if (property.label === "Text") return { ...property, value: "After", overridden: true };
    return property;
  });
  const result = applyLottieProperties(document, properties);
  const layer = (result.layers as Array<Record<string, unknown>>)[0]!;
  const opacity = (layer.ks as Record<string, Record<string, unknown>>).o;
  const text = (((layer.t as Record<string, unknown>).d as Record<string, unknown>).k as Array<{
    s: { t: string };
  }>)[0]!.s.t;

  assert.equal(layer.hd, true);
  assert.deepEqual(opacity, { a: 0, k: 72 });
  assert.equal(text, "After");
});

test("Lottie Essential Graphics text slots are editable and override the rendered title", () => {
  const document = {
    v: "5.12.2",
    fr: 25,
    ip: 0,
    op: 25,
    w: 640,
    h: 360,
    slots: {
      "Programme/Title": {
        p: { k: [{ s: { f: "ArialMT", t: "Slot title" }, t: 0 }] },
        t: 99,
      },
    },
    layers: [{
      ty: 5,
      nm: "Title",
      t: {
        d: {
          k: [{ s: { f: "ArialMT", t: "Inline fallback" }, t: 0 }],
          sid: "Programme/Title",
        },
      },
    }],
  };

  const metadata = inspectLottieDocument(document, "/graphics/slot-title.json");
  const textProperty = metadata.properties.find((property) => property.type === "text");
  assert.ok(textProperty);
  assert.equal(textProperty.value, "Slot title");
  assert.equal(textProperty.path, "/slots/Programme~1Title/p/k/0/s/t");
  assert.match(textProperty.group, /Slot Programme\/Title/);
  assert.equal(metadata.properties.filter((property) => property.type === "text").length, 1);

  const result = applyLottieProperties(document, metadata.properties.map((property) =>
    property.id === textProperty.id
      ? { ...property, value: "Edited title", overridden: true }
      : property));
  const slotText = (((((result.slots as Record<string, unknown>)["Programme/Title"] as Record<string, unknown>)
    .p as Record<string, unknown>).k as Array<{ s: { t: string } }>)[0]!.s.t);
  const layerText = (((((result.layers as Array<Record<string, unknown>>)[0]!.t as Record<string, unknown>)
    .d as Record<string, unknown>).k as Array<{ s: { t: string } }>)[0]!.s.t);
  assert.equal(slotText, "Edited title");
  assert.equal(layerText, "Inline fallback");
});

test("Lottie text metadata warns when the export embeds a limited glyph set", () => {
  const document = {
    v: "5.12.2",
    fr: 25,
    ip: 0,
    op: 25,
    w: 640,
    h: 360,
    chars: [{ ch: "A" }],
    layers: [{ ty: 5, nm: "Title", t: { d: { k: [{ s: { t: "A" } }] } } }],
  };
  const metadata = inspectLottieDocument(document, "/graphics/glyph-title.json");
  assert.match(metadata.warnings.join(" "), /embeds font glyphs/i);
});

test(
  "workspace session endpoint requires PostgreSQL",
  { skip: Boolean(process.env.DATABASE_URL) },
  async () => {
    const app = buildApp({ logger: false });
    try {
      const response = await app.inject({ method: "GET", url: "/api/workspace-session" });
      assert.equal(response.statusCode, 503);
      assert.match(response.json().error, /PostgreSQL is not configured/);
    } finally {
      await app.close();
    }
  },
);

test("workspace session accepts JSON bodies larger than Fastify's one MiB default", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({
      method: "PUT",
      url: "/api/workspace-session",
      headers: { "content-type": "application/json" },
      payload: { oversizedProbe: "x".repeat(1_100_000) },
    });
    assert.notEqual(response.statusCode, 413);
  } finally {
    await app.close();
  }
});

test("workspace recovery separates secrets and records a playout checkpoint", () => {
  const asset = {
    id: "asset-1",
    name: "movie.mp4",
    duration: "00:10:00:00",
    durationSeconds: 600,
    codec: "H.264",
    codecFamily: "H.264",
    codecProfile: "High",
    resolution: "1920×1080",
    fps: "25 fps",
    bitrate: "10 Mbps",
    size: "700 MB",
    status: "analyzed" as const,
    preview: "/api/media/thumbnail?path=movie.mp4",
    filePath: "/media/movie.mp4",
    colorSpace: "bt709",
    audio: "MP2 48kHz",
    sha256: "test",
  };
  const snapshot = workspaceSessionSnapshotSchema.parse({
    version: 1,
    assets: [asset],
    currentPlaylist: [asset],
    futurePlaylist: [],
    activeSchedule: "current",
    selectedAssetId: asset.id,
    currentScheduleMetadata: null,
    futureScheduleMetadata: null,
    scheduleLogoPath: "",
    scheduleLogoSource: "",
    ageLibrary: null,
    startMarker: {
      assetId: asset.id,
      updatedAt: "2026-08-07T12:00:00.000Z",
    },
    settings: {
      protocol: "SRT",
      streamKey: "legacy-secret",
      srtPassphrase: "session-secret",
      rtmpStreamKey: "rtmp-secret",
      udpPort: 5000,
    },
  });
  const protectedSnapshot = sanitizeWorkspaceSnapshot(snapshot);
  assert.equal(protectedSnapshot.sanitized.currentPlaylist[0]?.filePath, asset.filePath);
  assert.equal(protectedSnapshot.sanitized.startMarker?.assetId, asset.id);
  assert.equal(protectedSnapshot.sanitized.settings.srtPassphrase, "");
  assert.equal(protectedSnapshot.secrets.srtPassphrase, "session-secret");
  assert.doesNotMatch(JSON.stringify(protectedSnapshot.sanitized), /session-secret|rtmp-secret/);

  const runningStatus = playoutStatusSchema.parse({
    state: "running",
    sessionId: "session-1",
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    currentItemIndex: 3,
    currentItemId: "clip-4",
    currentItemName: "movie.mp4",
    currentItemElapsedSeconds: 15.5,
    currentItemProgressPercent: 25,
    totalItems: 10,
    outTimeSeconds: 315.5,
    totalDurationSeconds: 1_000,
    progressPercent: 31.55,
    frame: 7_888,
    fps: 25,
    bitrateKbps: 10_500,
    speed: 1,
    endpointLabel: "udp://239.1.1.1:5000",
    previewPath: "/api/playout/preview/index.m3u8",
    error: null,
    logs: [],
  });
  const checkpoint = checkpointFromStatus(runningStatus);
  assert.equal(checkpoint.currentItemIndex, 3);
  assert.equal(checkpoint.currentItemId, "clip-4");
  assert.equal(checkpoint.currentItemElapsedSeconds, 15.5);
  assert.equal(checkpoint.outTimeSeconds, 315.5);
  assert.equal(checkpoint.interrupted, false);
  assert.equal(recoverableCheckpointFromStatus(runningStatus)?.sessionId, "session-1");

  const failedBeforeSpawn = {
    ...runningStatus,
    state: "failed" as const,
    currentItemIndex: 0,
    currentItemElapsedSeconds: 0,
    currentItemProgressPercent: 0,
    outTimeSeconds: 0,
    progressPercent: 0,
    frame: 0,
  };
  assert.equal(recoverableCheckpointFromStatus(failedBeforeSpawn), null);

  const interruptedOnAir = {
    ...failedBeforeSpawn,
    currentItemElapsedSeconds: 12,
    outTimeSeconds: 12,
    progressPercent: 1.2,
    frame: 300,
  };
  assert.equal(recoverableCheckpointFromStatus(interruptedOnAir)?.outTimeSeconds, 12);
});

test("hot-take wait continues until the active playout has stopped", async () => {
  let checks = 0;
  await waitForPlayoutStop(() => {
    checks += 1;
    return checks < 3;
  }, 100, 1);
  assert.equal(checks, 3);
});

test("GET /api/playout/status starts idle", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({ method: "GET", url: "/api/playout/status" });
    assert.equal(response.statusCode, 200);
    const status = playoutStatusSchema.parse(response.json());
    assert.equal(status.state, "idle");
    assert.equal(status.transportBitrateBps, null);
    assert.equal(status.transportBitrateMode, null);
    assert.equal(status.continuityErrors, 0);
  } finally {
    await app.close();
  }
});

test("GET /api/playout/audio-level returns the live meter sample", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({ method: "GET", url: "/api/playout/audio-level" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { audioLevelDbfs: null });
  } finally {
    await app.close();
  }
});

test("POST /api/playout/take validates the replacement playout request", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/playout/take",
      payload: {},
    });
    assert.equal(response.statusCode, 400);
    assert.notEqual(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("PUT /api/playout/next-playlist rejects updates without an active Current schedule", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({
      method: "PUT",
      url: "/api/playout/next-playlist",
      payload: { nextPlaylist: [] },
    });
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /Current schedule is on air/);
  } finally {
    await app.close();
  }
});

test("PUT /api/playout/playlist rejects HOT CHANGE without an active Current schedule", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({
      method: "PUT",
      payload: { playlist: baseRequest().playlist },
      url: "/api/playout/playlist",
    });
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /only be updated while rolling playout is on air/i);
  } finally {
    await app.close();
  }
});

test("GET /api/system/metrics returns real server metrics", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({ method: "GET", url: "/api/system/metrics" });
    assert.equal(response.statusCode, 200);
    const metrics = systemMetricsSchema.parse(response.json());
    assert.ok(metrics.cpuPercent >= 0 && metrics.cpuPercent <= 100);
    assert.equal(metrics.networkMbps, 0);
  } finally {
    await app.close();
  }
});

test("GET /api/system/network-interfaces returns host adapters", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/system/network-interfaces",
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json() as { items: unknown[] };
    assert.ok(Array.isArray(payload.items));
  } finally {
    await app.close();
  }
});

test("network interface discovery prioritizes external adapters", () => {
  const interfaces = listNetworkInterfaces({
    Loopback: [{
      address: "127.0.0.1",
      cidr: "127.0.0.1/8",
      family: "IPv4",
      internal: true,
      mac: "00:00:00:00:00:00",
      netmask: "255.0.0.0",
    }],
    Ethernet: [{
      address: "192.168.10.20",
      cidr: "192.168.10.20/24",
      family: "IPv4",
      internal: false,
      mac: "00:11:22:33:44:55",
      netmask: "255.255.255.0",
    }],
  });
  assert.equal(interfaces[0]?.name, "Ethernet");
  assert.equal(interfaces[0]?.address, "192.168.10.20");
});

test("CPU sampler calculates utilization from node:os time deltas", () => {
  assert.equal(
    calculateCpuPercent(
      { idle: 100, total: 1_000 },
      { idle: 120, total: 1_100 },
    ),
    80,
  );
});

test("media preview endpoints reject files that were not analyzed", async () => {
  const app = buildApp({ logger: false });
  try {
    const thumbnail = await app.inject({
      method: "GET",
      url: "/api/media/thumbnail?path=%2Ftmp%2Fnot-analyzed.mp4",
    });
    assert.equal(thumbnail.statusCode, 404);
    const preview = await app.inject({
      method: "POST",
      payload: { filePath: "/tmp/not-analyzed.mp4", startSeconds: 0 },
      url: "/api/media/clip-preview/start",
    });
    assert.equal(preview.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("production API accepts Electron file origin preflight", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({
      headers: { origin: "null" },
      method: "OPTIONS",
      url: "/api/playout/start",
    });
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["access-control-allow-origin"], "null");
  } finally {
    await app.close();
  }
});

test("schedule parser reads rundown metadata, overlays and 168-hour variance", () => {
  const schedule = parseScheduleText([
    "start on 12:00:00.00 - delay 5",
    "insertAgeTitle {16+} duration {25}",
    "insertLogoTitle {C:\\\\branding\\channel.png}movie 00:06:00.00 \\\\utv2\\films\\one.mp4",
    "chop 00:00:10.00 \\\\utv2\\bumpers\\ident.mp4",
    "clip 00:01:00.00 \\\\utv2\\clips\\short.mp4",
  ].join("\n"), "C:\\schedule.air");

  assert.equal(schedule.startTime, "12:00:00.00");
  assert.equal(schedule.delaySeconds, 5);
  assert.equal(schedule.items.length, 3);
  assert.equal(schedule.items[0]?.ageTitle, "16+");
  assert.equal(schedule.items[0]?.ageTitleDurationSeconds, 25);
  assert.equal(schedule.items[0]?.logoPath, "C:\\\\branding\\channel.png");
  assert.equal(schedule.items[0]?.filePath, "\\\\utv2\\films\\one.mp4");
  assert.equal(schedule.items[1]?.ageTitle, null);
  assert.equal(schedule.totalDurationSeconds, 435);
  assert.equal(schedule.varianceSeconds, 435 - 604_800);
});

test("schedule parser warns about type timing and rejects missing header", () => {
  const parsed = parseScheduleText([
    "start on 00:00:00.00 - delay 0",
    "movie 00:01:00.00 /media/too-short.mp4",
  ].join("\n"));
  assert.match(parsed.warnings[0] ?? "", /movie duration should be longer/);
  assert.throws(
    () => parseScheduleText("clip 00:01:00.00 /media/clip.mp4"),
    ScheduleParseError,
  );
});

test("schedule parser defaults legacy AGE duration and validates the supported range", () => {
  const parsed = parseScheduleText([
    "start on 12:00:00.00 - delay 0",
    "insertAgeTitle {6+}",
    "clip 00:01:00.00 /media/clip [6+].mp4",
  ].join("\n"));
  assert.equal(parsed.items[0]?.ageTitleDurationSeconds, 10);
  assert.throws(
    () => parseScheduleText([
      "start on 12:00:00.00 - delay 0",
      "insertAgeTitle {6+} duration {9}",
      "clip 00:01:00.00 /media/clip.mp4",
    ].join("\n")),
    /10 to 60 seconds/,
  );
});

test("schedule decoder falls back to Windows-1251", () => {
  const decoded = decodeScheduleBuffer(Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]));
  assert.equal(decoded.encoding, "windows-1251");
  assert.equal(decoded.text, "Привет");
});

test("POST /api/schedule/parse reads .air schedule files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fluxio-schedule-"));
  const schedulePath = path.join(directory, "week.air");
  await writeFile(schedulePath, [
    "start on 12:00:00.00 - delay 5",
    "movie 00:06:00.00 /media/movie.mp4",
  ].join("\n"), "utf8");
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({
      method: "POST",
      payload: { filePath: schedulePath },
      url: "/api/schedule/parse",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().items[0].type, "movie");
  } finally {
    await app.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("schedule serializer preserves reordered items, graphics and subtitle markup", () => {
  const serialized = serializeSchedule({
    extension: "txt",
    startTime: "12:00:00.00",
    delaySeconds: 5,
    items: [
      {
        type: "clip",
        declaredDurationSeconds: 60.25,
        filePath: "\\\\utv2\\clips\\Trip [16+].mp4",
        ageTitle: { durationSeconds: 25, enabled: true, text: "16+" },
        logoPath: "C:\\FluxIO\\logo.png",
        graphicElements: [{
          backgroundPath: "C:\\FluxIO\\fx\\lower-third.mov",
          durationSeconds: 5,
          endOnSeconds: 17.5,
          name: "Lower Third",
          startOnSeconds: 12.5,
          titlePath: "C:\\FluxIO\\fx\\titles\\Trip [16+].png",
          titlePaths: ["Evening news", "Nikita Metelev"],
        }],
        srtPath: "C:\\FluxIO\\subs\\Trip [16+].srt",
      },
      {
        type: "chop",
        declaredDurationSeconds: 10,
        filePath: "C:\\media\\ident.mp4",
        ageTitle: { durationSeconds: 10, enabled: false, text: "6+" },
        graphicElements: [{
          backgroundPath: "C:\\FluxIO\\fx\\bug.png",
          durationSeconds: 10,
          endOnSeconds: 10,
          name: "Channel Bug",
          startOnSeconds: 0,
          titlePath: null,
          titlePaths: [],
        }],
        logoPath: null,
        srtPath: null,
      },
    ],
  });

  assert.equal(serialized.extension, "txt");
  assert.match(serialized.content, /^start on 12:00:00\.00 - delay 5\r\n/);
  assert.match(serialized.content, /insertAgeTitle \{16\+\} duration \{25\}\r\ninsertLogoTitle \{C:\\FluxIO\\logo\.png\}/);
  assert.match(serialized.content, /insertGraphicElement_\{Lower Third\} backgroundPath \{C:\\FluxIO\\fx\\lower-third\.mov\} titlePath \{C:\\FluxIO\\fx\\titles\\Trip \[16\+\]\.png\} titlePath#1 \{Evening news\} titlePath#2 \{Nikita Metelev\} duration \{00:00:05\.00\} startOn \{00:00:12\.50\} endOn \{00:00:17\.50\}/);
  assert.match(serialized.content, /insertSRT \{C:\\FluxIO\\subs\\Trip \[16\+\]\.srt\}/);
  assert.match(serialized.content, /clip 00:01:00\.25 \\\\utv2\\clips\\Trip \[16\+\]\.mp4/);
  assert.doesNotMatch(serialized.content, /insertAgeTitle \{6\+\}/);
  assert.match(serialized.content, /chop 00:00:10\.00 C:\\media\\ident\.mp4\r\n$/);
  // Парного титра у эффекта нет — пустая директива в файл не попадает.
  assert.match(
    serialized.content,
    /insertGraphicElement_\{Channel Bug\} backgroundPath \{C:\\FluxIO\\fx\\bug\.png\} duration \{00:00:10\.00\}/,
  );
  assert.doesNotMatch(serialized.content, /titlePath \{\}/);
  assert.equal(formatScheduleTimecode(360_000.5), "100:00:00.50");
});

test("schedule parser restores multiple FX layers and an explicit SRT path", () => {
  const schedule = parseScheduleText([
    "start on 12:00:00.00 - delay 5",
    "insertGraphicElement_{Lower Third} backgroundPath {/Volumes/T7/fx/lower.mov} titlePath {} titlePath#1 {Evening news} titlePath#2 {Nikita Metelev} duration {00:00:05.00} startOn {00:00:12.50} endOn {00:00:17.50}",
    "insertGraphicElement_{Channel Bug} backgroundPath {/Volumes/T7/fx/bug.png} titlePath {} duration {180} startOn {0}",
    "insertSRT {/Volumes/T7/subs/Trip [16+].srt}",
    "clip 00:03:00.00 /Volumes/T7/media/Trip [16+].mp4",
  ].join("\n"));

  assert.equal(schedule.items[0]?.graphicElements.length, 2);
  assert.equal(schedule.items[0]?.graphicElements[0]?.name, "Lower Third");
  assert.equal(schedule.items[0]?.graphicElements[0]?.durationSeconds, 5);
  assert.equal(schedule.items[0]?.graphicElements[0]?.startOnSeconds, 12.5);
  assert.equal(schedule.items[0]?.graphicElements[0]?.endOnSeconds, 17.5);
  assert.deepEqual(schedule.items[0]?.graphicElements[0]?.titlePaths, ["Evening news", "Nikita Metelev"]);
  assert.equal(schedule.items[0]?.graphicElements[1]?.backgroundPath, "/Volumes/T7/fx/bug.png");
  assert.equal(schedule.items[0]?.srtPath, "/Volumes/T7/subs/Trip [16+].srt");
});

test("POST /api/schedule/serialize returns editable .txt content", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({
      method: "POST",
      payload: {
        extension: "txt",
        startTime: "12:00:00.00",
        delaySeconds: 0,
        items: [{
          type: "movie",
          declaredDurationSeconds: 360,
          filePath: "/media/movie [12+].mp4",
          ageTitle: { durationSeconds: 10, enabled: true, text: "12+" },
          logoPath: "/branding/logo.png",
        }],
      },
      url: "/api/schedule/serialize",
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json() as { extension: string; content: string };
    assert.equal(payload.extension, "txt");
    assert.match(payload.content, /movie 00:06:00\.00 \/media\/movie \[12\+\]\.mp4/);
  } finally {
    await app.close();
  }
});

test("FFmpeg command concatenates clips and creates UDP plus HLS outputs", () => {
  const request = baseRequest();
  const previewDirectory = "/tmp/gruber-test-preview";
  const command = buildFfmpegCommand(
    request,
    [
      {
        id: "one",
        name: "one.mp4",
        filePath: "/media/one.mp4",
        trimInSeconds: 0,
        durationSeconds: 2,
        hasAudio: true,
      },
      {
        id: "two",
        name: "two.mp4",
        filePath: "/media/two.mp4",
        trimInSeconds: 1,
        durationSeconds: 3,
        hasAudio: false,
      },
    ],
    previewDirectory,
  );
  const rendered = command.args.join(" ");
  assert.match(rendered, /concat=n=2:v=1:a=1/);
  assert.match(rendered, /anullsrc=r=48000:cl=stereo/);
  assert.match(rendered, /udp:\/\/239\.1\.1\.1:5000\?pkt_size=1316&ttl=16/);
  assert.match(rendered, /-output_ts_offset 3598\.6/);
  assert.equal(command.args.includes("-stats_period"), false);
  assert.deepEqual(
    command.args.slice(
      command.args.indexOf("-progress"),
      command.args.indexOf("-progress") + 2,
    ),
    ["-progress", "pipe:1"],
  );
  assert.equal(
    command.args.at(-1),
    path.join(previewDirectory, "index.m3u8"),
  );
  const segmentOption = command.args.indexOf("-hls_segment_filename");
  assert.equal(
    command.args[segmentOption + 1],
    path.join(previewDirectory, "segment-%010d.ts"),
  );
  assert.match(rendered, /-hls_start_number_source epoch/);
  assert.match(rendered, /program_date_time\+temp_file/);
  assert.doesNotMatch(rendered, /append_list/);
  assert.equal(command.totalDurationSeconds, 5);
});

test("rolling playout keeps the weekly playlist out of the persistent encoder", () => {
  const request = baseRequest();
  request.audio.loudnessNormalization = {
    enabled: true,
    targetLufs: -23,
    truePeakDbtp: -1,
    loudnessRangeLufs: 7,
  };
  const item = preparedItems()[0]!;
  const videoProducer = buildFfmpegClipVideoProducerCommand(request, item, "/tmp/preview");
  const audioProducer = buildFfmpegClipAudioProducerCommand(request, item);
  const encoder = buildFfmpegProgramEncoderCommand(
    request,
    item,
    "/tmp/preview",
    168 * 60 * 60,
    { transportMuxRateBps: 12_000_000 },
  );
  const videoProducerArgs = videoProducer.args.join(" ");
  const audioProducerArgs = audioProducer.args.join(" ");
  const encoderArgs = encoder.args.join(" ");

  assert.match(videoProducerArgs, /-i \/media\/one\.mp4/);
  assert.match(videoProducerArgs, /-f rawvideo pipe:1/);
  assert.match(videoProducerArgs, /\[aprogram\]anullsink/);
  assert.doesNotMatch(videoProducerArgs, /loudnorm=/);
  assert.doesNotMatch(videoProducerArgs, /-progress pipe:1/);
  assert.match(audioProducerArgs, /-i \/media\/one\.mp4/);
  assert.match(audioProducerArgs, /-f s16le pipe:1/);
  assert.match(audioProducerArgs, /loudnorm=I=-23:TP=-1:LRA=7/);
  assert.match(encoderArgs, /-f rawvideo .* -i pipe:0/);
  assert.match(encoderArgs, /-f s16le .* -i pipe:3/);
  assert.doesNotMatch(encoderArgs, /loudnorm=/);
  assert.doesNotMatch(encoderArgs, /\/media\/one\.mp4/);
  assert.match(encoderArgs, /-muxrate 12000000/);
  assert.equal(encoder.totalDurationSeconds, 168 * 60 * 60);
});

test("every audio track renderer emits exactly one clip of PCM regardless of file length", () => {
  const request = baseRequest();
  request.audio.sampleRate = 48_000;
  request.audio.channels = 2;
  const item = { ...preparedItems()[0]!, durationSeconds: 12.5 };
  const samples = clipAudioSampleCount(item.durationSeconds, request.audio.sampleRate);

  assert.equal(samples, 600_000);
  assert.equal(clipAudioByteCount(item.durationSeconds, 48_000, 2), 2_400_000);

  const dubbed = buildFfmpegClipAudioProducerCommand(request, item, {
    filePath: "/media/{eng} one.m4a",
    hasAudio: true,
    languageCode: "eng",
    label: "eng",
  });
  const silent = buildFfmpegClipAudioProducerCommand(request, item, {
    filePath: null,
    hasAudio: false,
    languageCode: "spa",
    label: "spain",
  });

  // Короткий файл перевода добивается тишиной, длинный режется по сэмплу: без
  // этого молчащий pipe останавливает мультиплексор и эфир встаёт.
  for (const command of [dubbed, silent]) {
    assert.match(
      command.filterGraph,
      new RegExp(`apad=whole_len=${samples},atrim=end_sample=${samples}`),
    );
  }
  assert.match(dubbed.args.join(" "), /-i \/media\/\{eng\} one\.m4a/);
  assert.doesNotMatch(silent.args.join(" "), /-i /);
});

test("a renderer that stops early is topped up with silence, never truncated", () => {
  const expected = clipAudioByteCount(4, 48_000, 2);

  assert.equal(clipAudioSilenceBytes(expected, expected), 0);
  assert.equal(clipAudioSilenceBytes(expected, 0), expected);
  assert.equal(clipAudioSilenceBytes(expected, expected - 96_000), 96_000);
  // Лишние байты encoder уже забрал — обрезать нечего.
  assert.equal(clipAudioSilenceBytes(expected, expected + 96_000), 0);
});

test("an animated channel logo loops by input, a still one by a held frame", () => {
  assert.equal(isSupportedLogoPath("/brand/bug.mov"), true);
  assert.equal(isSupportedLogoPath("/brand/bug.gif"), true);
  assert.equal(isSupportedLogoPath("/brand/bug.webp"), true);
  // JSON не должен попасть в FFmpeg: UI сначала печатает Lottie в alpha-MOV.
  assert.equal(isSupportedLogoPath("/brand/bug.json"), false);
  assert.equal(logoSourceKind("/brand/bug.png"), "image");
  assert.equal(logoSourceKind("/brand/bug.GIF"), "gif");
  assert.equal(logoSourceKind("/brand/bug.mov"), "video");
  // Отрендеренный Lottie приходит сюда уже файлом, а не проектом.
  assert.equal(logoSourceKind("/cache/bug-lottie.mov"), "video");

  // Картинка разворачивается в бесконечный поток одним кадром.
  assert.deepEqual(
    logoInputArgs({ filePath: "/brand/bug.png", loop: true }, 25),
    ["-loop", "1", "-framerate", "25", "-i", "/brand/bug.png"],
  );
  // У анимации повторяется сам файл: gif — своим циклом, остальные — потоком.
  assert.deepEqual(
    logoInputArgs({ filePath: "/brand/bug.mov", loop: true }, 25),
    ["-stream_loop", "-1", "-i", "/brand/bug.mov"],
  );
  assert.deepEqual(
    logoInputArgs({ filePath: "/brand/bug.gif", loop: true }, 25),
    ["-ignore_loop", "0", "-i", "/brand/bug.gif"],
  );
  assert.deepEqual(
    logoInputArgs({ filePath: "/brand/bug.mov", loop: false }, 25),
    ["-i", "/brand/bug.mov"],
  );
});

test("a logo that plays once still outlives the clip, or overlay would cut the programme", () => {
  const still = logoFilterChain({ filePath: "/brand/bug.png", loop: true, opacity: 0.8 }, 240, 25);
  assert.equal(still, "format=rgba,colorchannelmixer=aa=0.8,scale=240:-1");

  const looping = logoFilterChain({ filePath: "/brand/bug.mov", loop: true, opacity: 1 }, 240, 25);
  assert.match(looping, /^fps=25,format=rgba/);
  assert.doesNotMatch(looping, /tpad/);

  // `overlay` собран с shortest=1: закончившаяся анимация обрезала бы эфир,
  // поэтому однократный показ держится последним кадром.
  const once = logoFilterChain({ filePath: "/brand/bug.mov", loop: false, opacity: 1 }, 240, 25);
  assert.match(once, /tpad=stop=-1:stop_mode=clone$/);
});

test("an animated channel logo reaches FFmpeg as a looped input", () => {
  const request = baseRequest();
  request.logo = {
    filePath: "/brand/bug.mov",
    loop: true,
    margin: 16,
    opacity: 0.9,
    position: "top-right",
    widthPercent: 12,
  };
  const command = buildFfmpegCommand(request, preparedItems(), "/tmp/preview");
  assert.match(command.args.join(" "), /-stream_loop -1 -i \/brand\/bug\.mov/);
  assert.match(command.filterGraph, /fps=25,format=rgba,colorchannelmixer=aa=0\.9/);
});

test("an effect layer is composited where the operator moved it", () => {
  const request = baseRequest();
  const [item] = preparedItems();
  const moved: PreparedPlayoutItem = {
    ...item!,
    effects: [{
      backgroundPath: "/fx/plate.mov",
      blendMode: "alpha",
      effectId: "fx-plate",
      endSeconds: 6,
      filePath: "/fx/plate.mov",
      id: "layer-1",
      kind: "video",
      lumaThreshold: 0.08,
      name: "Plate",
      // −10 % ширины и +5 % высоты кадра 1280×720.
      offsetXPercent: -10,
      offsetYPercent: 5,
      sourceDurationSeconds: 6,
      sourceInSeconds: 0,
      startSeconds: 1,
      tier: 2,
      titlePaths: [],
    }],
  };
  const command = buildFfmpegCommand(request, [moved], "/tmp/preview");
  assert.match(command.filterGraph, /overlay=x=-128:y=36:/);
});

test("composite clip preview renders the programme graph without opening the broadcast endpoint", () => {
  const request = baseRequest();
  const item = preparedItems()[0]!;
  const command = buildFfmpegCompositePreviewCommand(request, item, "/tmp/composite-preview");
  const rendered = command.args.join(" ");

  assert.match(rendered, /-map \[vpreview\] -map \[apreview\]/);
  assert.match(rendered, /\[vprogram\]nullsink;\[aprogram\]anullsink/);
  assert.match(rendered, /-hls_start_number_source generic/);
  assert.match(rendered, /segment-%06d\.ts/);
  assert.doesNotMatch(rendered, /udp:\/\//);

  // Предпросмотр копится целиком: плеер должен уметь отмотать назад по уже
  // посчитанному куску, а не упираться в живое окно из шести сегментов.
  assert.match(rendered, /-hls_list_size 0/);
  assert.match(rendered, /-hls_playlist_type event/);
  assert.doesNotMatch(rendered, /delete_segments|omit_endlist/);
  assert.doesNotMatch(rendered, /-hls_delete_threshold/);

  // Монтаж считается в кадре предпросмотра, а не в эфирном: на UHD это вчетверо
  // меньше работы при той же картинке.
  assert.match(command.filterGraph, /scale=960:540/);
  assert.doesNotMatch(command.filterGraph, /scale=1280:720/);
});

test("a 168-hour playlist keeps FFmpeg inputs out of the Windows command line", () => {
  const request = baseRequest();
  const items = Array.from({ length: 504 }, (_, index) => ({
    id: `clip-${index}`,
    name: `Weekly programme ${index}.mp4`,
    filePath: `R:\\FluxIO\\${"Very long weekly schedule directory\\".repeat(5)}` +
      `Weekly programme ${String(index).padStart(3, "0")}.mp4`,
    trimInSeconds: 0,
    durationSeconds: 20 * 60,
    hasAudio: true,
  }));
  const scriptPath = "C:\\Users\\iptv\\AppData\\Local\\Temp\\gruber-playout-preview\\filter.txt";
  const inline = buildFfmpegCommand(request, items, "/tmp/preview");
  const scripted = buildFfmpegCommand(request, items, "/tmp/preview", {
    filterComplexScriptPath: scriptPath,
  });
  const embedded = buildFfmpegCommand(request, items, "/tmp/preview", {
    embedInputSourcesInFilterGraph: true,
    filterComplexScriptPath: scriptPath,
  });

  assert.ok(estimateCommandLineCharacters("ffmpeg.exe", inline.args) > 32_767);
  assert.ok(estimateCommandLineCharacters("ffmpeg.exe", scripted.args) > 38_000);
  assert.ok(estimateCommandLineCharacters("ffmpeg.exe", embedded.args) < 30_000);
  assert.ok(scripted.filterGraph.length > 32_767);
  assert.deepEqual(
    scripted.args.slice(
      scripted.args.indexOf("-filter_complex_script"),
      scripted.args.indexOf("-filter_complex_script") + 2,
    ),
    ["-filter_complex_script", scriptPath],
  );
  assert.equal(scripted.args.includes("-filter_complex"), false);
  assert.equal(embedded.args.includes("-i"), false);
  assert.equal(embedded.inputSourcesEmbedded, true);
  assert.ok(embedded.filterGraph.startsWith("movie=filename='R\\:\\\\FluxIO"));
  assert.match(embedded.filterGraph, /:streams=v\+a\[inputv0\]\[inputa0\]/);
  assert.equal(embedded.totalDurationSeconds, 168 * 60 * 60);
  assert.equal(startPlayoutRequestSchema.safeParse({
    ...request,
    playlist: items.map((item) => ({
      id: item.id,
      name: item.name,
      filePath: item.filePath,
      sourceDurationSeconds: item.durationSeconds,
      hasAudio: item.hasAudio,
      trimInSeconds: 0,
      trimOutSeconds: item.durationSeconds,
      scte35Markers: [],
    })),
  }).success, true);
});

test("weekly playlist preparation is bounded and preserves all 504 clip positions", async () => {
  const items = Array.from({ length: 504 }, (_, index) => index);
  let active = 0;
  let maximumActive = 0;
  const progress: number[] = [];
  const prepared = await mapWithConcurrency(
    items,
    8,
    async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return `clip-${item}`;
    },
    (completed) => progress.push(completed),
  );

  assert.equal(maximumActive, 8);
  assert.equal(prepared.length, 504);
  assert.equal(prepared[0], "clip-0");
  assert.equal(prepared[503], "clip-503");
  assert.equal(progress.at(-1), 504);
});

test("FFmpeg optionally normalizes final programme and preview audio to -23 LUFS", () => {
  const request = baseRequest();
  const disabled = buildFfmpegCommand(
    request,
    preparedItems(),
    "/tmp/gruber-test-preview",
  ).args.join(" ");
  assert.doesNotMatch(disabled, /loudnorm=/);

  request.audio.loudnessNormalization = {
    enabled: true,
    targetLufs: -23,
    truePeakDbtp: -1,
    loudnessRangeLufs: 7,
  };
  const enabled = buildFfmpegCommand(
    request,
    preparedItems(),
    "/tmp/gruber-test-preview",
  ).args.join(" ");
  assert.match(enabled, /\[aconcat\]loudnorm=I=-23:TP=-1:LRA=7:dual_mono=false\[anormalized\]/);
  assert.match(enabled, /\[anormalized\]arealtime\[arealtime\]/);
  assert.match(enabled, /\[arealtime\]asplit=2\[aprogram\]\[apreview\]/);
});

test("UDP and field-order defaults are applied to older saved requests", () => {
  const request = baseRequest() as unknown as {
    endpoint: Record<string, unknown>;
    subtitleOutput?: unknown;
    video: Record<string, unknown>;
  };
  delete request.endpoint.mpegTs;
  delete request.video.fieldOrder;
  delete request.video.gopSize;
  delete request.video.bFrames;
  delete request.video.closedGop;
  delete request.subtitleOutput;
  delete (request as Record<string, unknown>).nextPlaylist;
  delete (request as { audio?: Record<string, unknown> }).audio?.loudnessNormalization;
  const parsed = startPlayoutRequestSchema.parse(request);
  assert.equal(parsed.video.fieldOrder, "progressive");
  assert.equal(parsed.video.gopSize, 50);
  assert.equal(parsed.video.bFrames, 0);
  assert.equal(parsed.video.closedGop, true);
  assert.equal(parsed.endpoint.protocol, "udp");
  if (parsed.endpoint.protocol !== "udp") throw new Error("Expected UDP request");
  assert.deepEqual(parsed.endpoint.mpegTs, defaultMpegTsOutputSettings);
  assert.deepEqual(parsed.subtitleOutput, defaultSubtitleOutput);
  assert.deepEqual(parsed.nextPlaylist, []);
  assert.deepEqual(parsed.audio.loudnessNormalization, {
    enabled: false,
    targetLufs: -23,
    truePeakDbtp: -1,
    loudnessRangeLufs: 7,
  });
});

test("FFmpeg command burns logo before program and preview split", () => {
  const request: StartPlayoutRequest = {
    ...baseRequest(),
    logo: {
      filePath: "/media/logo.png",
      loop: true,
      position: "top-right",
      widthPercent: 12,
      margin: 24,
      opacity: 0.75,
    },
  };
  const command = buildFfmpegCommand(
    request,
    [{
      id: "one",
      name: "one.mp4",
      filePath: "/media/one.mp4",
      trimInSeconds: 0,
      durationSeconds: 2,
      hasAudio: true,
    }],
    "/tmp/gruber-test-preview",
  );
  const filter = command.args[command.args.indexOf("-filter_complex") + 1] ?? "";
  assert.match(filter, /colorchannelmixer=aa=0\.75/);
  assert.match(filter, /overlay=x=main_w-overlay_w-24:y=24/);
  assert.match(filter, /\[vbranded\]realtime\[vrealtime\]/);
  assert.match(filter, /\[vrealtime\]split=2\[vprogrambase\]\[vpreviewbase\]/);
  assert.match(filter, /\[vprogrambase\]setfield=mode=prog\[vprogram\]/);
});

test("FFmpeg scales a full-frame AGE canvas to output and applies logo before concat", () => {
  const request = baseRequest();
  const command = buildFfmpegCommand(
    request,
    [{
      id: "one",
      name: "one.mp4",
      filePath: "/media/one.mp4",
      trimInSeconds: 0,
      durationSeconds: 20,
      hasAudio: true,
      ageTitle: {
        enabled: true,
        text: "16+",
        durationSeconds: 10,
        filePath: "/media/age-16.png",
      },
      itemLogo: {
        enabled: true,
        filePath: "/media/item-logo.png",
        loop: true,
        position: "top-right",
        widthPercent: 12,
        margin: 24,
        opacity: 0.8,
      },
    }],
    "/tmp/gruber-test-preview",
  );
  const filter = command.args[command.args.indexOf("-filter_complex") + 1] ?? "";
  assert.match(filter, /\[1:v:0\]format=rgba,scale=1280:720:flags=lanczos\[ageasset0\]/);
  assert.match(filter, /\[vbase0\]\[ageasset0\]overlay=x=0:y=0/);
  assert.match(filter, /enable='between\(t,0,10\)'/);
  assert.match(filter, /\[2:v:0\].*\[itemlogo0\]/);
  assert.match(filter, /\[vage0\]\[itemlogo0\]overlay=.*\[v0\]/);
  assert.ok(command.args.includes("/media/age-16.png"));
  assert.ok(command.args.includes("/media/item-logo.png"));

  const embedded = buildFfmpegCommand(
    request,
    [{
      id: "one",
      name: "one.mp4",
      filePath: "/media/one.mp4",
      trimInSeconds: 0,
      durationSeconds: 20,
      hasAudio: true,
      ageTitle: {
        enabled: true,
        text: "16+",
        durationSeconds: 10,
        filePath: "/media/age-16.png",
      },
      itemLogo: {
        enabled: true,
        filePath: "/media/item-logo.png",
        loop: true,
        position: "top-right",
        widthPercent: 12,
        margin: 24,
        opacity: 0.8,
      },
    }],
    "/tmp/gruber-test-preview",
    { embedInputSourcesInFilterGraph: true },
  );
  assert.equal(embedded.args.includes("-i"), false);
  assert.match(embedded.filterGraph, /movie=filename='\/media\/one\.mp4':streams=v\+a/);
  assert.match(embedded.filterGraph, /movie=filename='\/media\/age-16\.png':streams=v\[ageinput0raw\]/);
  assert.match(embedded.filterGraph, /\[ageinput0raw\]tpad=stop_mode=clone:stop_duration=20,trim=duration=20/);
  assert.match(embedded.filterGraph, /movie=filename='\/media\/item-logo\.png':streams=v\[itemlogoinput0raw\]/);
  assert.match(embedded.filterGraph, /\[itemlogoinput0raw\]tpad=stop_mode=clone:stop_duration=20,trim=duration=20/);
});

test("FFmpeg layers shared FX background, matched alpha title and SRT subtitles", () => {
  const request = baseRequest();
  request.playlist[0] = {
    ...request.playlist[0]!,
    effects: [{
      id: "layer-one",
      effectId: "lower-third",
      name: "lower-third.mov",
      sourceInSeconds: 0,
      blendMode: "alpha" as const,
      lumaThreshold: 0.08,
      offsetXPercent: 0,
      offsetYPercent: 0,
      tier: 3 as const,
      backgroundPath: "/media/lower-third-bg.mov",
      filePath: "/media/lower-third-bg.mov",
      kind: "video",
      sourceDurationSeconds: 5,
      startSeconds: 2,
      endSeconds: 7,
      titlePath: "/media/one-title.png",
      titlePaths: [],
    }, {
      id: "layer-two",
      effectId: "frame",
      name: "frame.png",
      sourceInSeconds: 0,
      blendMode: "alpha" as const,
      lumaThreshold: 0.08,
      offsetXPercent: 0,
      offsetYPercent: 0,
      tier: 3 as const,
      filePath: "/media/frame.png",
      kind: "static",
      sourceDurationSeconds: 0,
      startSeconds: 1,
      endSeconds: 9,
      titlePaths: [],
    }],
    subtitles: { enabled: true, filePath: "/media/one.srt" },
  };
  const command = buildFfmpegCommand(
    request,
    [{
      ...preparedItems()[0]!,
      durationSeconds: 10,
      effects: request.playlist[0]!.effects,
      subtitles: request.playlist[0]!.subtitles ?? undefined,
    }],
    "/tmp/gruber-test-preview",
  );
  const filter = command.args[command.args.indexOf("-filter_complex") + 1] ?? "";
  assert.match(filter, /subtitles=filename='\/media\/one\.srt'/);
  assert.match(filter, /setpts=PTS-STARTPTS\+2\/TB/);
  assert.match(filter, /enable='between\(t,2,7\)'/);
  assert.match(filter, /trim=duration=8,setpts=PTS-STARTPTS\+1\/TB/);
  assert.match(filter, /\[vbase0\]\[fxasset0_0_0\]overlay=.*\[vfx0_0_0\]/);
  assert.match(filter, /\[vfx0_0_0\]\[fxasset0_0_1\]overlay=.*\[vfx0_0_1\]/);
  assert.match(filter, /\[vfx0_0_1\]\[fxasset0_1_0\]overlay=/);
  assert.ok(command.args.includes("/media/lower-third-bg.mov"));
  assert.ok(command.args.includes("/media/one-title.png"));
  assert.ok(command.args.includes("/media/frame.png"));
});

test("DVB subtitle mode keeps video clean and builds a separate GStreamer bitmap PID", () => {
  const request = baseRequest();
  request.subtitleOutput = {
    ...defaultSubtitleOutput,
    mode: "dvb",
    pid: 288,
    language: "rus",
  };
  const item = {
    id: "one",
    name: "one.mp4",
    filePath: "/media/one.mp4",
    trimInSeconds: 0,
    durationSeconds: 20,
    hasAudio: true,
    subtitles: { enabled: true, filePath: "/media/one.srt" },
  };
  const ffmpeg = buildFfmpegCommand(request, [item], "/tmp/gruber-test-preview");
  const filter = ffmpeg.args[ffmpeg.args.indexOf("-filter_complex") + 1] ?? "";
  assert.doesNotMatch(filter, /subtitles=filename/);

  const gstreamer = buildGstreamerDvbSubtitleCommand({
    inputPath: "/tmp/program.srt",
    outputPort: 31_000,
    request,
  }).join(" ");
  assert.match(gstreamer, /subparse ! textrender/);
  assert.doesNotMatch(gstreamer, /draw-outline|draw-shadow/);
  assert.match(gstreamer, /video\/x-raw,format=AYUV,width=1280,height=720/);
  assert.match(gstreamer, /dvbsubenc max-colours=16 ts-offset=0/);
  assert.match(gstreamer, /mux\.sink_288/);
});

test("SRT parser accepts UTF-8 BOM, CRLF and comma timestamps used by operator files", () => {
  const cues = parseSrt(
    "\uFEFF1\r\n00:00:00,720 --> 00:00:03,600\r\nПервая строка\r\n\r\n" +
      "2\r\n00:00:04,000 --> 00:00:06,250\r\nВторая строка\r\n",
  );
  assert.deepEqual(cues, [
    { startSeconds: 0.72, endSeconds: 3.6, text: "Первая строка" },
    { startSeconds: 4, endSeconds: 6.25, text: "Вторая строка" },
  ]);
});

test("DVB subtitle input falls back to Windows-1251 without corrupting Cyrillic text", () => {
  assert.equal(
    decodeSubtitleBuffer(Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])),
    "Привет",
  );
});

test("GStreamer filesrc preserves Windows DVB subtitle paths", () => {
  const request = baseRequest();
  request.subtitleOutput = {
    ...defaultSubtitleOutput,
    mode: "dvb",
    pid: 288,
    language: "rus",
  };
  const args = buildGstreamerDvbSubtitleCommand({
    inputPath: "C:\\Users\\iptv\\AppData\\Local\\Temp\\gruber-playout-preview\\dvb-subtitles-loop-0.srt",
    outputPort: 31_000,
    request,
  });
  assert.ok(args.includes(
    "location=C:/Users/iptv/AppData/Local/Temp/gruber-playout-preview/dvb-subtitles-loop-0.srt",
  ));
  assert.equal(args.some((argument) => argument.includes("C:\\Users")), false);
});

test("DVB subtitle project trims clip cues and shifts them to the program timeline", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fluxio-dvb-srt-"));
  const firstPath = path.join(directory, "first.srt");
  const secondPath = path.join(directory, "second.srt");
  await writeFile(firstPath, [
    "1",
    "00:00:03,000 --> 00:00:07,000",
    "Trimmed at clip start",
    "",
    "2",
    "00:00:09.000 --> 00:00:12.000",
    "Inside first clip",
  ].join("\n"), "utf8");
  await writeFile(secondPath, "1\n00:00:01,000 --> 00:00:03,000\nSecond clip\n", "utf8");
  try {
    const project = await buildDvbSubtitleProject([
      {
        id: "first",
        name: "first.mp4",
        filePath: "/media/first.mp4",
        trimInSeconds: 5,
        durationSeconds: 10,
        hasAudio: true,
        subtitles: { enabled: true, filePath: firstPath },
      },
      {
        id: "second",
        name: "second.mp4",
        filePath: "/media/second.mp4",
        trimInSeconds: 0,
        durationSeconds: 5,
        hasAudio: true,
        subtitles: { enabled: true, filePath: secondPath },
      },
    ]);
    assert.equal(project.cueCount, 3);
    assert.equal(project.sourceItems, 2);
    assert.equal(project.firstCueStartSeconds, 0);
    const cues = parseSrt(project.content);
    assert.deepEqual(
      cues.map((cue) => [cue.startSeconds, cue.endSeconds, cue.text]),
      [
        [0, 2, "Trimmed at clip start"],
        [4, 7, "Inside first clip"],
        [11, 13, "Second clip"],
      ],
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("DVB subtitle pre-roll transmits PES early while preserving presentation PTS", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fluxio-subtitle-preroll-"));
  const subtitle = path.join(directory, "programme.srt");
  try {
    await writeFile(subtitle, "1\n00:00:05,000 --> 00:00:08,000\nПривет\n", "utf8");
    const project = await buildDvbSubtitleProject([{
      durationSeconds: 20,
      filePath: "/media/program.mp4",
      hasAudio: true,
      id: "program",
      name: "program.mp4",
      subtitles: { enabled: true, filePath: subtitle },
      trimInSeconds: 0,
    }], 2);
    assert.equal(project.firstCueStartSeconds, 5);
    assert.equal(project.preRollSeconds, 2);
    assert.match(project.content, /00:00:03,000 --> 00:00:06,000/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("DVB subtitle pre-roll is clamped to preserve an early first cue PTS", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fluxio-subtitle-early-cue-"));
  const subtitle = path.join(directory, "programme.srt");
  try {
    await writeFile(subtitle, "1\n00:00:01,000 --> 00:00:03,000\nEarly cue\n", "utf8");
    const project = await buildDvbSubtitleProject([{
      durationSeconds: 20,
      filePath: "/media/program.mp4",
      hasAudio: true,
      id: "program",
      name: "program.mp4",
      subtitles: { enabled: true, filePath: subtitle },
      trimInSeconds: 0,
    }], 2);
    assert.equal(project.preRollSeconds, 1);
    assert.match(project.content, /00:00:00,000 --> 00:00:02,000/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

/**
 * Минимальный TTF: только те таблицы, которые читает `readFontMetrics`. Класть
 * в репозиторий настоящий шрифт незачем — проверяются ширины, а не глифы.
 * Глифы: 0 — .notdef (500), 1 — «A» (600), 2 — «B» (300), при em в 1000 единиц.
 */
function buildTestFont(): Buffer {
  const advances = [500, 600, 300];
  const head = Buffer.alloc(54);
  head.writeUInt16BE(1_000, 18);
  const hhea = Buffer.alloc(36);
  hhea.writeUInt16BE(advances.length, 34);
  const maxp = Buffer.alloc(6);
  maxp.writeUInt16BE(advances.length, 4);
  const hmtx = Buffer.alloc(advances.length * 4);
  advances.forEach((advance, index) => hmtx.writeUInt16BE(advance, index * 4));

  const groups = [
    { start: 0x41, end: 0x41, glyph: 1 },
    { start: 0x42, end: 0x42, glyph: 2 },
  ];
  const subtable = Buffer.alloc(16 + groups.length * 12);
  subtable.writeUInt16BE(12, 0);
  subtable.writeUInt32BE(subtable.length, 4);
  subtable.writeUInt32BE(groups.length, 12);
  groups.forEach((group, index) => {
    const at = 16 + index * 12;
    subtable.writeUInt32BE(group.start, at);
    subtable.writeUInt32BE(group.end, at + 4);
    subtable.writeUInt32BE(group.glyph, at + 8);
  });
  const cmap = Buffer.concat([Buffer.alloc(12), subtable]);
  cmap.writeUInt16BE(1, 2);
  cmap.writeUInt16BE(3, 4);
  cmap.writeUInt16BE(10, 6);
  cmap.writeUInt32BE(12, 8);

  const tables: [string, Buffer][] = [
    ["cmap", cmap], ["head", head], ["hhea", hhea], ["hmtx", hmtx], ["maxp", maxp],
  ];
  const header = Buffer.alloc(12 + tables.length * 16);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(tables.length, 4);
  let offset = header.length;
  tables.forEach(([tag, data], index) => {
    const record = 12 + index * 16;
    header.write(tag, record, "latin1");
    header.writeUInt32BE(offset, record + 8);
    header.writeUInt32BE(data.length, record + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...tables.map(([, data]) => data)]);
}

test("Font metrics measure a line by the glyph widths of the font itself", () => {
  const metrics = readFontMetrics(buildTestFont());
  assert.ok(metrics, "минимальный шрифт должен разбираться");
  assert.equal(metrics.unitsPerEm, 1_000);
  assert.equal(metrics.capHeight, 700, "без OS/2 берётся 0.7 em");
  assert.equal(measureTextWidth(metrics, "AB", 100), 90);
  // Многострочный текст меряется по самой длинной строке: плашка обязана
  // вместить её целиком.
  assert.equal(measureTextWidth(metrics, "A\nAB", 100), 90);
  // Трекинг Lottie — тысячные доли em между символами.
  assert.equal(measureTextWidth(metrics, "AB", 100, 100), 100);
  // Символа нет в шрифте — берётся ширина .notdef, а не ноль.
  assert.equal(measureTextWidth(metrics, "Я", 100), 50);
});

test("A plate grows to the side its text is set from", () => {
  const rectangle = () => ({ s: { a: 0, k: [300, 100] }, p: { a: 0, k: [0, 0] } });

  const leftAligned = rectangle();
  assert.equal(fitRectangleToText(leftAligned, 80, 0), true);
  assert.deepEqual(leftAligned.s.k, [380, 100]);
  // Левый край остался на месте: центр уехал на половину прибавки вправо.
  assert.deepEqual(leftAligned.p.k, [40, 0]);

  const rightAligned = rectangle();
  fitRectangleToText(rightAligned, 80, 1);
  assert.deepEqual(rightAligned.p.k, [-40, 0]);

  const centered = rectangle();
  fitRectangleToText(centered, 80, 2);
  assert.deepEqual(centered.s.k, [380, 100]);
  assert.deepEqual(centered.p.k, [0, 0]);

  // Текст стал короче — плашка сжимается, но не в ноль.
  const shrunk = rectangle();
  fitRectangleToText(shrunk, -500, 0);
  assert.deepEqual(shrunk.s.k, [1, 100]);

  const animated = { s: { a: 1, k: [] }, p: { a: 0, k: [0, 0] } };
  assert.equal(fitRectangleToText(animated, 80, 0), false, "анимированный размер не трогаем");
});

test("Flux Title Exporter plate follows the actual replacement text width", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fluxio-title-font-"));
  const fontFilePath = path.join(directory, "TestTitle.ttf");
  await writeFile(fontFilePath, buildTestFont());
  try {
    const template = {
      v: "5.12.2",
      fr: 25,
      ip: 0,
      op: 50,
      w: 1920,
      h: 1080,
      fonts: { list: [{ fName: "TestTitle", fFamily: "Test Title", fStyle: "Regular" }] },
      layers: [
        {
          ty: 4,
          nm: "fit:Title",
          shapes: [{
            ty: "rc",
            s: { a: 0, k: [300, 100] },
            p: { a: 0, k: [0, 0] },
          }],
        },
        {
          ty: 5,
          nm: "Title",
          t: { d: { k: [{ s: { f: "TestTitle", s: 100, t: "AB", tr: 0, j: 0 } }] } },
        },
      ],
    };
    const metadata = inspectLottieDocument(template, "/graphics/exported-title.json");
    const properties = metadata.properties.map((property) => property.type === "text"
      ? {
          ...property,
          value: "ABAB",
          overridden: true,
          fitSample: { fontFilePath, fontSizePercent: null, text: "ABAB" },
        }
      : property);
    const rendered = applyLottieProperties(template, properties);
    const warnings = await fitPlatesToText(rendered, template, properties);
    assert.deepEqual(warnings, []);

    const plate = (rendered.layers as Array<{ shapes: Array<{
      p: { k: number[] };
      s: { k: number[] };
    }> }>)[0]!.shapes[0]!;
    // Test font: AB = 90 px, ABAB = 180 px. The plate therefore grows by
    // exactly 90 px, while the left edge stays fixed for left-aligned text.
    assert.deepEqual(plate.s.k, [390, 100]);
    assert.deepEqual(plate.p.k, [45, 0]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("Subtitle cue text drops what subparse leaves visible and keeps what it escapes itself", () => {
  // subparse отдаёт pango-markup и сам превращает & в &amp;, поэтому экранировать
  // здесь нельзя — в эфир ушло бы «&amp;». А ASS-разметку он пропускает как текст.
  assert.equal(sanitizeCueText("{\\an8}Заголовок"), "Заголовок");
  assert.equal(sanitizeCueText("{\\pos(100,200)}Смещение"), "Смещение");
  assert.equal(sanitizeCueText("Rock & Roll, 5 < 7"), "Rock & Roll, 5 < 7");
  assert.equal(sanitizeCueText("\u001B[31mЦвет\u0000"), "[31mЦвет");
  assert.equal(sanitizeCueText("  Первая   строка \n\n  Вторая  \n"), "Первая строка\nВторая");
});

test("Subtitle cue text keeps ordinary markup and caps runaway cues", () => {
  assert.equal(sanitizeCueText("<i>Курсив</i>"), "<i>Курсив</i>");
  const nested = `${"<i>".repeat(50)}Глубоко${"</i>".repeat(50)}`;
  assert.equal(sanitizeCueText(nested), "Глубоко");
  const truncated = sanitizeCueText("А".repeat(900));
  assert.equal(truncated.length, 500);
  assert.ok(truncated.endsWith("…"));
  const trimmedTag = sanitizeCueText(`${"Б".repeat(497)}<i>хвост</i>`);
  assert.ok(!/<[^>]*$/.test(trimmedTag), "обрез не должен оставлять недописанный тег");
  const manyLines = sanitizeCueText(
    Array.from({ length: 12 }, (_, index) => `Строка ${index}`).join("\n"),
  );
  assert.equal(manyLines.split("\n").length, 6);
});

test("Subtitle timeline resumes mid-programme instead of replaying cues from zero", () => {
  const cues = [
    { startSeconds: 10, endSeconds: 12, text: "Прошлая" },
    { startSeconds: 100, endSeconds: 104, text: "На экране" },
    { startSeconds: 200, endSeconds: 203, text: "Будущая" },
  ];

  const onScreen = buildSubtitleTimeline(cues, 102, 2);
  assert.equal(onScreen.cueCount, 2);
  // Реплика уже идёт — запаса на pre-roll нет, PES уходит немедленно.
  assert.equal(onScreen.preRollSeconds, 0);
  assert.deepEqual(
    parseSrt(onScreen.content).map((cue) => [cue.startSeconds, cue.endSeconds, cue.text]),
    [[0, 2, "На экране"], [98, 101, "Будущая"]],
  );

  const betweenCues = buildSubtitleTimeline(cues, 50, 2);
  assert.equal(betweenCues.cueCount, 2);
  assert.equal(betweenCues.preRollSeconds, 2);
  assert.match(betweenCues.content, /00:00:48,000 --> 00:00:52,000/);

  assert.equal(buildSubtitleTimeline(cues, 500, 2).cueCount, 0);
});

test("Restarted DVB subtitle command shifts PTS back onto the programme timeline", () => {
  const request = baseRequest();
  request.subtitleOutput = {
    ...defaultSubtitleOutput,
    mode: "dvb",
    pid: 288,
    language: "rus",
  };
  const args = buildGstreamerDvbSubtitleCommand({
    inputPath: "/tmp/dvb-subtitles-loop-0-resume-1.srt",
    outputPort: 31_000,
    preRollMs: 2_000,
    timelineOffsetMs: 1_322_000,
    request,
  });
  assert.ok(args.includes(`ts-offset=${(2_000 + 1_322_000) * 1_000_000}`));
});

test("DVB subtitle project cleans operator markup and keeps cues for a restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fluxio-subtitle-sanitize-"));
  const subtitle = path.join(directory, "programme.srt");
  try {
    await writeFile(subtitle, [
      "1",
      "00:00:05,000 --> 00:00:08,000",
      "{\\an8}Верхняя строка",
      "",
      "2",
      "00:00:09,000 --> 00:00:11,000",
      "Обычная реплика",
    ].join("\n"), "utf8");
    const project = await buildDvbSubtitleProject([{
      durationSeconds: 20,
      filePath: "/media/program.mp4",
      hasAudio: true,
      id: "program",
      name: "program.mp4",
      subtitles: { enabled: true, filePath: subtitle },
      trimInSeconds: 0,
    }], 2);
    assert.equal(project.sanitizedCues, 1);
    assert.equal(project.cueCount, 2);
    assert.deepEqual(
      project.cues.map((cue) => cue.text),
      ["Верхняя строка", "Обычная реплика"],
    );
    assert.doesNotMatch(project.content, /an8/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("TSDuck announces and merges a DVB subtitle component into UDP MPEG-TS", () => {
  const request = baseRequest();
  request.subtitleOutput = {
    ...defaultSubtitleOutput,
    mode: "dvb",
    pid: 288,
    language: "rus",
  };
  const command = buildTsdDuckCommand({
    cueCount: 0,
    cueFilePath: null,
    inputPort: 30_000,
    request,
    subtitles: {
      inputPort: 30_001,
      pmtPatchFilePath: "/tmp/dvb-subtitles-pmt.xml",
      tspPath: "/opt/tsduck/bin/tsp",
    },
  });
  const rendered = command.args.join(" ");
  assert.match(rendered, /--add-pid 288\/0x06/);
  assert.match(rendered, /--patch-xml \/tmp\/dvb-subtitles-pmt\.xml/);
  assert.match(rendered, /-P merge --bitrate 128000 --no-psi-merge/);
  assert.match(rendered, /-P filter --pid 288 --stuffing/);
  assert.match(rendered, /-P pcrextract --pid 256 --pid 288 --pts --log/);
  assert.match(rendered, /filter --pid 288 --set-label 31 -P craft --only-label 31 --no-pcr/);
  assert.match(rendered, /-P continuity --fix --pid 256 --pid 257 --pid 288/);
  const patchXml = buildDvbSubtitlePmtPatch(request);
  assert.match(patchXml, /elementary_PID="288"/);
  assert.match(patchXml, /language_code="rus" subtitling_type="0x14"/);
  assert.match(patchXml, /composition_page_id="1" ancillary_page_id="1"/);
});

test("Future schedule transition is automatic unless repeat is enabled", () => {
  const request = baseRequest();
  request.nextPlaylist = [{ ...request.playlist[0]!, id: "future", name: "future.mp4" }];
  assert.equal(shouldTransitionToFutureSchedule(request), true);
  request.repeatPlaylist = true;
  assert.equal(shouldTransitionToFutureSchedule(request), false);
});

test("FFmpeg applies field order and custom UDP MPEG-TS service settings", () => {
  const request = baseRequest();
  request.video.fieldOrder = "upper";
  if (request.endpoint.protocol !== "udp") throw new Error("Expected UDP request");
  request.endpoint.localAddress = "192.168.10.20";
  request.endpoint.mpegTs = {
    serviceName: "News One",
    serviceId: 42,
    providerName: "Flux Provider",
    videoPid: 301,
    audioPid: 302,
    serviceType: "advanced_codec_digital_hdtv",
    pcrPeriodMs: 40,
    transportBitrateKbps: 0,
  };
  const rendered = buildFfmpegCommand(
    request,
    preparedItems(),
    "/tmp/preview",
  ).args.join(" ");
  assert.match(rendered, /setfield=mode=tff/);
  assert.match(rendered, /-x264-params .*tff=1/);
  assert.match(rendered, /-field_order tt/);
  assert.match(rendered, /-metadata service_name=News One/);
  assert.match(rendered, /-metadata service_provider=Flux Provider/);
  assert.match(rendered, /-streamid 0:301 -streamid 1:302/);
  assert.match(rendered, /-mpegts_service_id 42/);
  assert.match(rendered, /-mpegts_service_type advanced_codec_digital_hdtv/);
  assert.match(rendered, /-pcr_period 40/);
  assert.match(rendered, /localaddr=192\.168\.10\.20/);
});

test("FFmpeg command creates SRT MPEG-TS endpoint with transport settings", () => {
  const request = baseRequest();
  request.endpoint = {
    protocol: "srt",
    host: "encoder.example.test",
    port: 9_000,
    mode: "caller",
    latencyMs: 180,
    passphrase: "valid-test-passphrase",
    streamId: "#!::r=channel-1,m=publish",
  };
  const command = buildFfmpegCommand(request, preparedItems(), "/tmp/preview");
  const rendered = command.args.join(" ");
  assert.match(rendered, /-f mpegts srt:\/\/encoder\.example\.test:9000\?/);
  assert.match(rendered, /mode=caller/);
  assert.match(rendered, /latency=180000/);
  assert.match(rendered, /passphrase=valid-test-passphrase/);
  assert.match(rendered, /streamid=/);
});

test("SCTE-35 cue planner converts clip-relative markers to 90 kHz program PTS", () => {
  const request = baseRequest();
  request.scte35.enabled = true;
  request.scte35.defaultUpid = "TEST-AD-001";
  request.playlist = [
    {
      id: "one",
      name: "one.mp4",
      filePath: "/media/one.mp4",
      trimInSeconds: 1,
      trimOutSeconds: null,
      scte35Markers: [{
        id: "cue-one",
        positionSeconds: 7,
        eventId: 12_345,
        kind: "break-start",
        durationSeconds: 30,
        segmentationTypeId: 0x34,
        upid: "",
      }],
    },
  ];
  const cues = planScte35Cues(request, [{
    ...preparedItems()[0]!,
    trimInSeconds: 1,
    durationSeconds: 10,
  }]);
  assert.equal(cues[0]?.programTimeSeconds, 6);
  assert.equal(cues[0]?.pts, 324_540_000);
  assert.equal(cues[0]?.durationTicks, 2_700_000);

  const xml = buildScte35CueXml(request, cues);
  assert.match(xml, /<time_signal pts_time="324540000"\/>/);
  assert.match(xml, /segmentation_event_id="12345"/);
  assert.match(xml, /segmentation_duration="2700000"/);
  assert.match(xml, /segmentation_type_id="0x34"/);
  assert.match(xml, /544553542D41442D303031/);
});

test("TSDuck command adds CUEI PMT signaling, SCTE PID and UDP output", () => {
  const request = baseRequest();
  request.scte35.enabled = true;
  request.scte35.pid = 500;
  if (request.endpoint.protocol !== "udp") throw new Error("Expected UDP request");
  request.endpoint.localAddress = "192.168.10.20";
  request.endpoint.mpegTs.serviceId = 42;
  const command = buildTsdDuckCommand({
    cueCount: 1,
    cueFilePath: "/tmp/cues.xml",
    inputPort: 19_001,
    request,
  });
  const rendered = command.args.join(" ");
  assert.match(rendered, /-I ip --buffer-size 4194304 --local-address 127\.0\.0\.1 19001/);
  assert.match(rendered, /--add-registration 0x43554549/);
  assert.match(rendered, /--service 42/);
  assert.match(rendered, /--add-pid 500\/0x86/);
  assert.match(rendered, /spliceinject .*--files \/tmp\/cues\.xml/);
  assert.match(rendered, /splicemonitor .*--splice-pid 500/);
  assert.match(rendered, /pcradjust --bitrate \d+ --pid 256 --min-ms-interval 18/);
  assert.match(rendered, /continuity --fix --pid 256 --pid 257 --tag FluxIO-output/);
  assert.match(rendered, /regulate --bitrate \d+ --packet-burst 7/);
  assert.match(rendered, /-O ip --buffer-size 4194304 --enforce-burst .*239\.1\.1\.1:5000/);
  assert.match(rendered, /--local-address 192\.168\.10\.20/);
  assert.match(rendered, /--force-local-multicast-outgoing/);
  assert.ok(calculateTransportMuxRate(request) > 2_628_000);
});

test("final transport monitor mirrors post-TSDuck MPEG-TS into an HLS preview", () => {
  const request = baseRequest();
  const command = buildTsdDuckCommand({
    cueCount: 0,
    cueFilePath: null,
    inputPort: 19_001,
    previewPort: 19_002,
    request,
  });
  const renderedTsdDuck = command.args.join(" ");
  assert.match(
    renderedTsdDuck,
    /-P regulate .* -P ip --buffer-size 4194304 --packet-burst 7 127\.0\.0\.1:19002 -O ip/,
  );

  const previewDirectory = path.join(tmpdir(), "fluxio-transport-preview");
  const renderedFfmpeg = buildTransportPreviewCommand({
    inputPort: 19_002,
    previewDirectory,
  }).join(" ");
  assert.match(renderedFfmpeg, /udp:\/\/127\.0\.0\.1:19002\?fifo_size=1000000/);
  assert.match(renderedFfmpeg, /-map 0:v:0 -map 0:a:0\?/);
  assert.match(renderedFfmpeg, /-f hls/);
  assert.ok(renderedFfmpeg.includes(path.join(
    previewDirectory,
    transportPreviewPlaylistName,
  )));
});

test("CBR transport muxrate uses target bitrate and supports an explicit TS rate", () => {
  const request = baseRequest();
  request.video.targetBitrateKbps = 2_500;
  request.video.maxBitrateKbps = 12_000;
  request.video.rateControl = "cbr";
  const automaticRate = calculateTransportMuxRate(request);
  assert.equal(automaticRate, 3_400_000);

  if (request.endpoint.protocol !== "udp") throw new Error("Expected UDP request");
  request.endpoint.mpegTs.transportBitrateKbps = 4_500;
  assert.equal(calculateTransportMuxRate(request), 4_500_000);

  const rendered = buildFfmpegCommand(request, preparedItems(), "/tmp/preview", {
    transportMuxRateBps: calculateTransportMuxRate(request),
  }).args.join(" ");
  assert.match(rendered, /-muxrate 4500000/);
  assert.doesNotMatch(rendered, /[?&]bitrate=/);
  assert.doesNotMatch(rendered, /burst_bits=/);
  assert.match(rendered, /buffer_size=4194304/);
  assert.match(rendered, /nal-hrd=cbr/);
  assert.match(rendered, /filler=1/);

  request.endpoint.host = "192.0.2.50";
  request.endpoint.localAddress = "192.168.10.20";
  const tsduck = buildTsdDuckCommand({
    cueCount: 0,
    cueFilePath: null,
    inputPort: 19_001,
    request,
  }).args.join(" ");
  assert.match(tsduck, /regulate --bitrate 4500000 --packet-burst 7/);
  assert.match(tsduck, /-O ip --buffer-size 4194304 --enforce-burst --packet-burst 7/);
  assert.match(tsduck, /--local-address 192\.168\.10\.20/);
  assert.match(tsduck, /192\.0\.2\.50:5000/);
});

test("FFmpeg applies deterministic I/P/B GOP settings to all program codecs", () => {
  for (const codec of ["h264", "h265", "mpeg2"] as const) {
    const request = baseRequest();
    request.video.codec = codec;
    request.video.gopSize = 48;
    request.video.bFrames = 2;
    request.video.closedGop = true;
    const rendered = buildFfmpegCommand(
      request,
      preparedItems(),
      "/tmp/preview",
    ).args.join(" ");
    assert.match(
      rendered,
      codec === "mpeg2"
        ? /-g 48 -keyint_min 48 -sc_threshold 1000000000 -bf 2/
        : /-g 48 -keyint_min 48 -sc_threshold 0 -bf 2/,
    );
    if (codec === "h264") {
      assert.match(rendered, /open-gop=0:bframes=2:b-adapt=0:b-pyramid=none/);
      assert.doesNotMatch(rendered.split("-map [vpreview]")[0] ?? "", /-tune zerolatency/);
    } else if (codec === "h265") {
      assert.match(rendered, /open-gop=0:bframes=2:b-adapt=0:b-pyramid=0/);
    } else {
      assert.match(rendered, /-flags:v \+cgop/);
    }
  }

  const openRequest = baseRequest();
  openRequest.video.closedGop = false;
  assert.match(
    buildFfmpegCommand(openRequest, preparedItems(), "/tmp/preview").args.join(" "),
    /open-gop=1/,
  );
});

test("GOP contract rejects impossible and codec-incompatible structures", () => {
  const impossible = baseRequest();
  impossible.video.gopSize = 2;
  impossible.video.bFrames = 2;
  assert.equal(startPlayoutRequestSchema.safeParse(impossible).success, false);

  const mpeg2 = baseRequest();
  mpeg2.video.codec = "mpeg2";
  mpeg2.video.bFrames = 3;
  assert.equal(startPlayoutRequestSchema.safeParse(mpeg2).success, false);

  const baseline = baseRequest();
  baseline.video.profile = "Baseline";
  baseline.video.bFrames = 1;
  assert.equal(startPlayoutRequestSchema.safeParse(baseline).success, false);
});

test("TSDuck command sends the injected MPEG-TS through SRT caller settings", () => {
  const request = baseRequest();
  request.scte35.enabled = true;
  request.endpoint = {
    protocol: "srt",
    host: "192.0.2.10",
    port: 9_000,
    mode: "caller",
    latencyMs: 180,
    passphrase: "valid-test-passphrase",
    streamId: "#!::r=channel-1,m=publish",
  };
  const command = buildTsdDuckCommand({
    cueCount: 1,
    cueFilePath: "/tmp/cues.xml",
    inputPort: 19_001,
    request,
  });
  const rendered = command.args.join(" ");
  assert.match(rendered, /-O srt --transtype live --latency 180 --caller 192\.0\.2\.10:9000/);
  assert.match(rendered, /--passphrase valid-test-passphrase --pbkeylen 16/);
  assert.match(rendered, /--streamid #!::r=channel-1,m=publish/);
  assert.match(rendered, /--payload-size 1316 --packet-burst 7/);
});

test("plain UDP and SRT use TSDuck relay without adding SCTE-35 signaling", () => {
  const request = baseRequest();
  request.endpoint = {
    protocol: "srt",
    host: "192.0.2.20",
    port: 9_001,
    mode: "caller",
    latencyMs: 160,
    passphrase: "",
    streamId: "",
  };
  const command = buildTsdDuckCommand({
    cueCount: 0,
    cueFilePath: null,
    inputPort: 19_002,
    request,
  });
  const rendered = command.args.join(" ");
  assert.equal(usesTsdDuckTransport(request), true);
  assert.match(rendered, /-I ip --buffer-size 4194304 --local-address 127\.0\.0\.1 19002/);
  assert.match(rendered, /-O srt .*--caller 192\.0\.2\.20:9001/);
  assert.doesNotMatch(rendered, /\bpmt\b|spliceinject|splicemonitor/);

  const udpRequest = baseRequest();
  assert.equal(usesTsdDuckTransport(udpRequest), true);
  if (udpRequest.endpoint.protocol !== "udp") throw new Error("Expected UDP request");
  udpRequest.endpoint.mpegTs.pcrPeriodMs = 26;
  const udpCommand = buildTsdDuckCommand({
    cueCount: 0,
    cueFilePath: null,
    inputPort: 19_003,
    request: udpRequest,
  });
  const renderedUdp = udpCommand.args.join(" ");
  assert.match(renderedUdp, /pcradjust --bitrate \d+ --pid 256 --min-ms-interval 24/);
  assert.match(renderedUdp, /-O ip .*239\.1\.1\.1:5000/);
  assert.doesNotMatch(renderedUdp, /\bpmt\b|spliceinject|splicemonitor/);
  assert.equal(pcrInsertionThresholdMs(40), 38);
  assert.equal(pcrInsertionThresholdMs(2), 1);
});

test("FFmpeg SCTE-35 handoff uses CBR local MPEG-TS and forced cue keyframes", () => {
  const request = baseRequest();
  request.scte35.enabled = true;
  const command = buildFfmpegCommand(request, preparedItems(), "/tmp/preview", {
    forceKeyFramesSeconds: [6, 12.5],
    programEndpoint: {
      protocol: "udp",
      host: "127.0.0.1",
      port: 19_001,
      packetSize: 1_316,
      ttl: 1,
      localAddress: "",
      mpegTs: { ...defaultMpegTsOutputSettings },
    },
    transportMuxRateBps: 3_700_000,
  });
  const rendered = command.args.join(" ");
  assert.match(rendered, /-force_key_frames 6,12\.5/);
  assert.match(rendered, /-muxrate 3700000/);
  assert.match(rendered, /-output_ts_offset 3598\.6/);
  assert.match(rendered, /-muxdelay 0\.7/);
  assert.match(rendered, /-muxpreload 0\.5/);
  assert.doesNotMatch(rendered, /-muxdelay 0(?:\s|$)/);
  assert.match(rendered, /-mpegts_service_id 1/);
  assert.match(rendered, /udp:\/\/127\.0\.0\.1:19001/);
  assert.equal(command.endpointLabel, "UDP 239.1.1.1:5000");
});

test("DVB subtitle clock aligns the first subtitle cue with the video PTS epoch", () => {
  assert.equal(mpegTsClockOriginSeconds, 3_600);
  assert.equal(ffmpegMpegTsOutputOffsetSeconds, 3_598.6);

  const aligned = evaluateDvbSubtitleClock({
    videoPtsOriginMs: 3_600_000,
    subtitlePtsMs: 3_606_040,
    firstCueStartSeconds: 6,
    configuredOffsetMs: 0,
  });
  assert.deepEqual(aligned, {
    clockErrorMs: 40,
    expectedSubtitlePtsMs: 3_606_000,
    synchronized: true,
  });

  const legacyMismatch = evaluateDvbSubtitleClock({
    videoPtsOriginMs: 1_400,
    subtitlePtsMs: 3_606_000,
    firstCueStartSeconds: 6,
    configuredOffsetMs: 0,
  });
  assert.equal(legacyMismatch.synchronized, false);
  assert.equal(legacyMismatch.clockErrorMs, 3_598_600);

  const wrapped = evaluateDvbSubtitleClock({
    videoPtsOriginMs: mpegTsPtsWrapMs - 1_000,
    subtitlePtsMs: 500,
    firstCueStartSeconds: 1.5,
    configuredOffsetMs: 0,
  });
  assert.equal(wrapped.clockErrorMs, 0);
  assert.equal(wrapped.synchronized, true);
});

test("FFmpeg keeps only actionable playout warnings in the application log", () => {
  const command = buildFfmpegCommand(
    baseRequest(),
    preparedItems(),
    "/tmp/preview",
  );
  const logLevelIndex = command.args.indexOf("-loglevel");
  assert.deepEqual(command.args.slice(logLevelIndex, logLevelIndex + 2), [
    "-loglevel",
    "warning",
  ]);
});

test("playout frame progress is formatted for Log Output", () => {
  assert.equal(
    formatFrameProgressLog({
      bitrateKbps: 2_628.4,
      fps: 25,
      frame: 125,
      outTimeSeconds: 5.4,
    }),
    "Transmitted frames: 125 | FPS: 25.00 | bitrate: 2628 kbps | time: 00:00:05",
  );
});

test("HOT CHANGE aligns a full UI schedule to the on-air clip after a marked start", () => {
  const current = [{ id: "on-air", value: "old" }, { id: "next", value: "old" }];
  const replacement = [
    { id: "already-played", value: "unchanged" },
    { id: "on-air", value: "ignored" },
    { id: "next", value: "new" },
  ];
  assert.deepEqual(
    alignHotChangePlaylist(current, replacement, 0, "on-air").map((item) => item.id),
    ["on-air", "next"],
  );
  assert.throws(
    () => alignHotChangePlaylist(current, replacement, 0, "missing"),
    /cannot remove the on-air clip/,
  );
});

test("live audio meter calculates dBFS directly from PCM s16le", () => {
  const pcm = Buffer.alloc(4);
  pcm.writeInt16LE(16_384, 0);
  pcm.writeInt16LE(-16_384, 2);
  assert.ok(Math.abs((measurePcmS16leDbfs(pcm) ?? 0) - -6.0206) < 0.001);
  assert.equal(measurePcmS16leDbfs(Buffer.alloc(4)), -120);
});

test("media-server console reports periodic encoding activity and clip changes", () => {
  assert.equal(
    formatEncodingActivity({
      bitrateKbps: 2_628.4,
      currentItemIndex: 1,
      currentItemName: "News\nBreak.mp4",
      fps: 25,
      frame: 125,
      outTimeSeconds: 5.4,
      speed: 0.998,
      totalItems: 20,
    }),
    "Encoding clip 2/20 \"News Break.mp4\" | frame: 125 | FPS: 25.00 | " +
      "bitrate: 2628 kbps | speed: 1.00x | time: 00:00:05",
  );
  assert.equal(shouldReportEncodingActivity({
    currentItemIndex: 0,
    lastItemIndex: -1,
    lastOutTimeSeconds: Number.NEGATIVE_INFINITY,
    outTimeSeconds: 0.5,
  }), true);
  assert.equal(shouldReportEncodingActivity({
    currentItemIndex: 0,
    lastItemIndex: 0,
    lastOutTimeSeconds: 0.5,
    outTimeSeconds: 4.9,
  }), false);
  assert.equal(shouldReportEncodingActivity({
    currentItemIndex: 0,
    lastItemIndex: 0,
    lastOutTimeSeconds: 0.5,
    outTimeSeconds: 5.5,
  }), true);
  assert.equal(shouldReportEncodingActivity({
    currentItemIndex: 1,
    lastItemIndex: 0,
    lastOutTimeSeconds: 5.5,
    outTimeSeconds: 5.6,
  }), true);
});

test("TSDuck continuity monitor warnings are recognized without masking errors", () => {
  assert.equal(
    isTsdDuckContinuityWarning("* Error: FluxIO-output: PID 256, missing 7 packets"),
    true,
  );
  assert.equal(isTsdDuckContinuityWarning("FluxIO-output: continuity error on PID 257"), true);
  assert.equal(isTsdDuckContinuityWarning("SCTE-35 cue emitted"), false);
});

test("FFmpeg command creates RTMPS FLV endpoint and contract rejects short SRT secrets", () => {
  const request = baseRequest();
  request.endpoint = {
    protocol: "rtmp",
    serverUrl: "rtmps://media.example.test/live/",
    streamKey: "/channel-secret",
  };
  const command = buildFfmpegCommand(request, preparedItems(), "/tmp/preview");
  assert.match(
    command.args.join(" "),
    /-f flv rtmps:\/\/media\.example\.test\/live\/channel-secret/,
  );
  const invalid = baseRequest();
  invalid.endpoint = {
    protocol: "srt",
    host: "127.0.0.1",
    port: 9_000,
    mode: "caller",
    latencyMs: 120,
    passphrase: "short",
    streamId: "",
  };
  assert.equal(startPlayoutRequestSchema.safeParse(invalid).success, false);
  const invalidDvbRtmp = {
    ...request,
    subtitleOutput: { ...defaultSubtitleOutput, mode: "dvb" as const },
  };
  assert.equal(startPlayoutRequestSchema.safeParse(invalidDvbRtmp).success, false);
  const invalidDvbPid = baseRequest();
  invalidDvbPid.subtitleOutput = {
    ...defaultSubtitleOutput,
    mode: "dvb",
    pid: defaultMpegTsOutputSettings.videoPid,
  };
  assert.equal(startPlayoutRequestSchema.safeParse(invalidDvbPid).success, false);
});

test("FFmpeg command keeps 5.1 channel layout for AAC and AC-3 profiles", () => {
  for (const codec of ["aac", "ac3"] as const) {
    const request = baseRequest();
    request.audio.codec = codec;
    request.audio.channels = 6;
    const command = buildFfmpegCommand(request, preparedItems(), "/tmp/preview");
    const rendered = command.args.join(" ");
    assert.match(rendered, /channel_layouts=5\.1/);
    assert.match(rendered, /-ac 6/);
  }
});

test("FFmpeg preflight rejects MP2 with 5.1 audio", async () => {
  const supervisor = new PlayoutSupervisor(
    new FfmpegCapabilitiesService(),
    path.join(tmpdir(), "gruber-invalid-audio-preview"),
  );
  const request = baseRequest();
  request.audio.codec = "mp2";
  request.audio.channels = 6;
  try {
    await assert.rejects(supervisor.start(request), /MP2 output supports mono or stereo/);
  } finally {
    await supervisor.close();
  }
});

test("FFmpeg preflight rejects a manual transport bitrate below the payload peak", async () => {
  const supervisor = new PlayoutSupervisor(
    new FfmpegCapabilitiesService(),
    path.join(tmpdir(), "gruber-invalid-muxrate-preview"),
  );
  const request = baseRequest();
  if (request.endpoint.protocol !== "udp") throw new Error("Expected UDP request");
  request.endpoint.mpegTs.transportBitrateKbps = 2_600;
  try {
    await assert.rejects(supervisor.start(request), /Transport bitrate .* is too low/);
  } finally {
    await supervisor.close();
  }
});

test("SCTE-35 preflight rejects an elementary-stream PID collision", async () => {
  const supervisor = new PlayoutSupervisor(
    new FfmpegCapabilitiesService(),
    path.join(tmpdir(), "gruber-invalid-scte-pid-preview"),
  );
  const request = baseRequest();
  request.endpoint = {
    protocol: "srt",
    host: "127.0.0.1",
    port: 9_000,
    mode: "caller",
    latencyMs: 120,
    passphrase: "",
    streamId: "",
  };
  request.scte35.enabled = true;
  request.scte35.pid = defaultMpegTsOutputSettings.videoPid;
  try {
    await assert.rejects(supervisor.start(request), /conflicts with video PID/);
  } finally {
    await supervisor.close();
  }
});

test(
  "real FFmpeg session keeps a stuffed CBR UDP transport across two clips",
  { skip: process.env.GRUBER_RUN_FFMPEG_TESTS !== "1", timeout: 45_000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gruber-ffmpeg-test-"));
    const clipOne = path.join(directory, "one.mp4");
    const clipTwo = path.join(directory, "two.mp4");
    const logo = path.join(directory, "logo.png");
    const capture = path.join(directory, "program.ts");
    const previewDirectory = path.join(directory, "preview");
    const clipPreviewDirectory = path.join(directory, "clip-preview");
    const outputPort = await testUdpPort();
    const udpReceiver = createSocket("udp4");
    const udpDatagrams: UdpDatagram[] = [];
    udpReceiver.on("message", (payload) => {
      udpDatagrams.push({ payload: Buffer.from(payload), receivedAtMs: Date.now() });
    });
    await new Promise<void>((resolve, reject) => {
      udpReceiver.once("error", reject);
      udpReceiver.bind(outputPort, "127.0.0.1", resolve);
    });
    const capabilities = new FfmpegCapabilitiesService();
    const supervisor = new PlayoutSupervisor(capabilities, previewDirectory);
    const mediaPreview = new MediaPreviewService(
      capabilities.ffmpegPath,
      clipPreviewDirectory,
    );
    const restoredMediaPreview = new MediaPreviewService(
      capabilities.ffmpegPath,
      path.join(directory, "restored-clip-preview"),
    );
    try {
      await runCommand(capabilities.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", "4.4", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", clipOne,
      ]);
      await runCommand(capabilities.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=blue:size=854x480:rate=30",
        "-t", "4.3", "-c:v", "libx264", "-pix_fmt", "yuv420p", clipTwo,
      ]);
      await runCommand(capabilities.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=yellow@0.8:size=120x60",
        "-frames:v", "1", logo,
      ]);
      mediaPreview.register(await realpath(clipOne), 4.4);
      const thumbnail = await mediaPreview.thumbnail(clipOne);
      assert.deepEqual([...thumbnail.subarray(0, 2)], [0xff, 0xd8]);
      // Перезапуск приложения гасит media-service вместе с окном, и реестр
      // роликов пуст. Восстановленная сессия обязана заново получить превью,
      // а не набор битых картинок.
      const restoredThumbnail = await restoredMediaPreview.thumbnail(clipOne);
      assert.deepEqual([...restoredThumbnail.subarray(0, 2)], [0xff, 0xd8]);
      await assert.rejects(
        restoredMediaPreview.thumbnail(path.join(directory, "never-existed.mp4")),
        /ENOENT|has not been analyzed/,
      );
      const clipPreview = await mediaPreview.start(clipOne, 0);
      assert.match(clipPreview.manifestPath, /index\.m3u8$/);
      assert.match(
        (await mediaPreview.readPreviewFile(clipPreview.sessionId, "index.m3u8")).toString("utf8"),
        /#EXTM3U/,
      );
      assert.ok(
        (await mediaPreview.readPreviewFile(clipPreview.sessionId, "segment-000000.ts")).length > 0,
      );
      await mediaPreview.stop(clipPreview.sessionId);
      const request = baseRequest();
      request.playlist = [
        { id: "one", name: "one.mp4", filePath: clipOne, trimInSeconds: 0, trimOutSeconds: null, scte35Markers: [] },
        { id: "two", name: "two.mp4", filePath: clipTwo, trimInSeconds: 0, trimOutSeconds: null, scte35Markers: [] },
      ];
      // Keep the raw video bridge at the production 1080p frame size. A smaller
      // frame does not reproduce the dual-pipe startup backpressure regression.
      request.video.width = 1_920;
      request.video.height = 1_080;
      request.video.preset = "ultrafast";
      request.video.rateControl = "vbr";
      request.video.targetBitrateKbps = 2_500;
      request.video.maxBitrateKbps = 2_500;
      request.video.bufferSizeKbps = 5_000;
      request.video.fieldOrder = "progressive";
      request.video.gopSize = 25;
      request.video.bFrames = 5;
      request.video.closedGop = true;
      request.audio.codec = "mp2";
      request.audio.sampleRate = 48_000;
      request.audio.bitrateKbps = 192;
      request.audio.loudnessNormalization = {
        enabled: true,
        targetLufs: -23,
        truePeakDbtp: -1,
        loudnessRangeLufs: 7,
      };
      request.endpoint = {
        protocol: "udp",
        host: "127.0.0.1",
        port: outputPort,
        packetSize: 1_316,
        ttl: 16,
        localAddress: "",
        mpegTs: {
          ...defaultMpegTsOutputSettings,
          serviceName: "FluxIO Test",
          serviceId: 42,
          providerName: "FluxIO QA",
          videoPid: 301,
          audioPid: 302,
          pcrPeriodMs: 26,
          transportBitrateKbps: 4_000,
        },
      };
      request.logo = {
        filePath: logo,
        loop: true,
        position: "top-right",
        widthPercent: 15,
        margin: 16,
        opacity: 0.8,
      };
      request.playlist[0] = {
        ...request.playlist[0]!,
        sourceDurationSeconds: 4.4,
        hasAudio: true,
      };
      const restoredComposite = await restoredMediaPreview.startComposite(
        { ...request, playlist: [request.playlist[0]!], nextPlaylist: [] },
        0,
      );
      assert.match(
        (await restoredMediaPreview.readPreviewFile(
          restoredComposite.sessionId,
          "index.m3u8",
        )).toString("utf8"),
        /#EXTM3U/,
      );
      await restoredMediaPreview.stop(restoredComposite.sessionId);

      const wallStartedAt = Date.now();
      await supervisor.start(request);
      const hotChangedPlaylist = [
        { ...request.playlist[0]!, id: "already-played-in-ui" },
        ...request.playlist.map((item, index) => index === 1
          ? {
              ...item,
              itemLogo: {
                enabled: true as const,
                filePath: logo,
                loop: true,
                margin: 20,
                opacity: 0.9,
                position: "bottom-right" as const,
                widthPercent: 12,
              },
            }
          : item),
      ];
      await supervisor.updatePlaylist(hotChangedPlaylist);
      const deadline = Date.now() + 20_000;
      let observedAudioLevel = false;
      while (["starting", "running"].includes(supervisor.getStatus().state)) {
        const level = supervisor.getAudioLevelDbfs();
        observedAudioLevel ||= level != null && level > -120 && level <= 0;
        if (Date.now() > deadline) {
          throw new Error(
            `Timed out waiting for FFmpeg session\n${supervisor.getStatus().logs.slice(-25).join("\n")}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const status = supervisor.getStatus();
      assert.equal(status.state, "completed", status.logs.slice(-10).join("\n"));
      assert.equal(status.progressPercent, 100);
      assert.ok(
        status.logs.some((line) => line.includes("Transmitted frames:")),
        status.logs.slice(-10).join("\n"),
      );
      assert.ok(
        status.logs.some((line) => line.includes("pipe ready: video + audio")),
        status.logs.slice(-10).join("\n"),
      );
      assert.ok(
        status.logs.some((line) => line.includes("HOT CHANGE armed for clip 2")),
        status.logs.slice(-10).join("\n"),
      );
      assert.ok(
        observedAudioLevel,
        `Expected a non-silent live PCM audio level during playout`,
      );
      assert.ok(
        status.logs.some((line) => line.includes("TSDuck UDP PCR relay started")),
        status.logs.slice(-10).join("\n"),
      );
      assert.ok(
        status.logs.some((line) => line.includes("PCR target 26 ms")),
        status.logs.slice(-10).join("\n"),
      );
      assert.equal(status.transportBitrateBps, 4_000_000);
      assert.equal(status.transportBitrateMode, "manual");
      assert.equal(status.continuityErrors, 0);
      assert.ok(
        status.logs.some((line) => line.includes("transport target 4.000 Mbps (manual)")),
        status.logs.slice(-10).join("\n"),
      );
      assert.ok(
        Date.now() - wallStartedAt >= 8_300,
        "Playout must be paced close to the combined clip duration",
      );
      const muxRate = calculateTransportMuxRate(request);
      const transport = analyzeUdpTransport(udpDatagrams, 4.4);
      assert.ok(
        udpDatagrams.slice(0, -1).every(({ payload }) => payload.length === 1_316),
        "Every UDP datagram during playout must contain exactly seven 188-byte TS packets",
      );
      assert.equal(udpDatagrams.at(-1)!.payload.length % 188, 0);
      assert.ok(transport.nullPackets > 0, "Expected PID 0x1FFF stuffing packets");
      assert.ok(
        Math.abs(transport.steadyBitrateBps - muxRate) / muxRate <= 0.025,
        `Expected ${muxRate} bps steady CBR transport, received ${transport.steadyBitrateBps.toFixed(0)} bps ` +
          `over ${transport.elapsedSeconds.toFixed(3)} s\n${status.logs.slice(-20).join("\n")}`,
      );
      assert.ok(
        transport.boundaryBitrateBps <= muxRate * 1.12,
        `Transport spike at clip boundary: ${transport.boundaryBitrateBps.toFixed(0)} bps`,
      );
      await writeFile(capture, Buffer.concat(udpDatagrams.map(({ payload }) => payload)));
      assert.deepEqual(
        findContinuityCounterErrors(await readFile(capture)),
        [],
        "Final UDP capture must not contain video/audio continuity counter errors",
      );
      const pcrIntervals = extractPcrIntervalsMs(await readFile(capture));
      assert.ok(pcrIntervals.length > 20, "Expected repeated PCR values in plain UDP capture");
      assert.ok(
        Math.max(...pcrIntervals) < 40,
        `PCR interval must remain below 40 ms; max=${Math.max(...pcrIntervals).toFixed(3)} ms`,
      );
      const pcrBitrateBps = estimatePcrBitrateBps(await readFile(capture));
      assert.ok(
        Math.abs(pcrBitrateBps - muxRate) / muxRate <= 0.02,
        `PCR-derived bitrate must be ${muxRate} bps; received ${pcrBitrateBps.toFixed(0)} bps`,
      );
      const frameTypes = (await runCommand(capabilities.ffprobePath, [
        "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pict_type",
        "-of", "csv=p=0", capture,
      ])).stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      assert.ok(frameTypes.filter((value) => value === "I").length >= 2, frameTypes.join(""));
      assert.ok(frameTypes.includes("P"), frameTypes.join(""));
      assert.ok(frameTypes.includes("B"), frameTypes.join(""));
      assert.match(
        await readFile(path.join(previewDirectory, "transport-index.m3u8"), "utf8"),
        /#EXTM3U/,
      );

      request.repeatPlaylist = true;
      await supervisor.start(request);
      const repeatDeadline = Date.now() + 20_000;
      while (supervisor.getStatus().loopCount < 1) {
        if (Date.now() > repeatDeadline) {
          throw new Error(
            `Timed out waiting for repeated playlist cycle\n${supervisor.getStatus().logs.slice(-25).join("\n")}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      assert.equal(supervisor.getStatus().state, "running");
      assert.equal(supervisor.getStatus().repeatPlaylist, true);
      await supervisor.stop();
      while (supervisor.getStatus().state === "stopping") {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      udpReceiver.close();
      await mediaPreview.close();
      await restoredMediaPreview.close();
      await supervisor.close();
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test(
  "real FFmpeg filter script opens embedded video, audio and static overlay sources",
  { skip: process.env.GRUBER_RUN_FFMPEG_TESTS !== "1", timeout: 10_000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fluxio embedded inputs-"));
    const clip = path.join(directory, "programme with spaces.mp4");
    const age = path.join(directory, "16 plus.png");
    const filterScript = path.join(directory, "filter graph.txt");
    const capabilities = new FfmpegCapabilitiesService();
    try {
      await runCommand(capabilities.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", "0.8", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", clip,
      ]);
      await runCommand(capabilities.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=yellow@0.7:size=320x180",
        "-frames:v", "1", age,
      ]);
      const request = baseRequest();
      request.video.width = 320;
      request.video.height = 180;
      request.endpoint = {
        protocol: "udp",
        host: "127.0.0.1",
        port: 49_999,
        packetSize: 1_316,
        ttl: 1,
        localAddress: "",
        mpegTs: { ...defaultMpegTsOutputSettings },
      };
      const command = buildFfmpegCommand(request, [{
        id: "embedded",
        name: "programme with spaces.mp4",
        filePath: clip,
        trimInSeconds: 0,
        durationSeconds: 0.8,
        hasAudio: true,
        ageTitle: {
          enabled: true,
          text: "16+",
          filePath: age,
          durationSeconds: 0.4,
        },
      }], directory, {
        embedInputSourcesInFilterGraph: true,
        filterComplexScriptPath: filterScript,
      });
      await writeFile(filterScript, command.filterGraph, "utf8");
      await runCommand(capabilities.ffmpegPath, command.args);

      assert.equal(command.args.includes("-i"), false);
      assert.match(await readFile(path.join(directory, "index.m3u8"), "utf8"), /#EXTM3U/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test(
  "real FFmpeg and TSDuck session emits SCTE-35 into captured UDP MPEG-TS",
  { skip: process.env.GRUBER_RUN_SCTE35_TESTS !== "1", timeout: 30_000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gruber-scte35-test-"));
    const clip = path.join(directory, "program.mp4");
    const capture = path.join(directory, "capture.ts");
    const previewDirectory = path.join(directory, "preview");
    const outputPort = await testUdpPort();
    const capabilities = new FfmpegCapabilitiesService();
    const supervisor = new PlayoutSupervisor(capabilities, previewDirectory);
    const tspPath = process.env.TSDUCK_PATH ?? "tsp";
    let receiver: ReturnType<typeof spawn> | null = null;
    try {
      await runCommand(capabilities.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
        "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
        "-t", "5", "-c:v", "libx264", "-preset", "ultrafast",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip,
      ]);
      const multicastHost = "239.255.42.42";
      receiver = spawn(tspPath, [
        "-I", "ip", "--local-address", "127.0.0.1",
        "--receive-timeout", "2000", `${multicastHost}:${outputPort}`,
        "-O", "file", capture,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      await new Promise<void>((resolve, reject) => {
        receiver?.once("spawn", resolve);
        receiver?.once("error", reject);
      });

      const request = baseRequest();
      request.playlist = [{
        id: "program",
        name: "program.mp4",
        filePath: clip,
        trimInSeconds: 0,
        trimOutSeconds: null,
        scte35Markers: [{
          id: "cue-54321",
          positionSeconds: 3.5,
          eventId: 54_321,
          kind: "break-start",
          durationSeconds: 30,
          segmentationTypeId: 0x34,
          upid: "TEST-54321",
        }],
      }];
      request.video.width = 640;
      request.video.height = 360;
      request.video.targetBitrateKbps = 1_200;
      request.video.maxBitrateKbps = 1_200;
      request.video.bufferSizeKbps = 2_400;
      request.video.gopSize = 25;
      request.video.bFrames = 2;
      request.video.closedGop = true;
      request.endpoint = {
        protocol: "udp",
        host: multicastHost,
        port: outputPort,
        packetSize: 1_316,
        ttl: 1,
        localAddress: "127.0.0.1",
        mpegTs: { ...defaultMpegTsOutputSettings, pcrPeriodMs: 10 },
      };
      request.scte35 = {
        ...request.scte35,
        enabled: true,
        pid: 500,
        preRollMs: 1_000,
        defaultUpid: "TEST-54321",
      };

      await supervisor.start(request);
      const deadline = Date.now() + 20_000;
      while (["starting", "running"].includes(supervisor.getStatus().state)) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for SCTE-35 playout");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const status = supervisor.getStatus();
      assert.equal(status.state, "completed", status.logs.slice(-20).join("\n"));
      assert.equal(status.scte35.plannedEvents, 1);
      assert.equal(status.scte35.observedEvents, 1, status.logs.slice(-20).join("\n"));

      await new Promise<void>((resolve) => {
        if (!receiver || receiver.exitCode != null) return resolve();
        receiver.once("close", () => resolve());
      });
      const streams = await runCommand(capabilities.ffprobePath, [
        "-v", "error", "-show_entries", "stream=codec_name,id", "-of", "json", capture,
      ]);
      assert.match(streams.stdout, /"codec_name": "scte_35"/);
      assert.match(streams.stdout, /"id": "0x1f4"/);
      const pcrIntervals = extractPcrIntervalsMs(await readFile(capture));
      assert.ok(pcrIntervals.length > 20, "Expected repeated PCR values in UDP capture");
      const medianPcrInterval = median(pcrIntervals);
      assert.ok(
        Math.abs(medianPcrInterval - 10) <= 1,
        `Expected 10 ms PCR interval, received ${medianPcrInterval.toFixed(3)} ms`,
      );
      const keyframes = await runCommand(capabilities.ffprobePath, [
        "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
        "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", capture,
      ]);
      const keyframeTimes = keyframes.stdout
        .split(/\r?\n/)
        .map((value) => Number.parseFloat(value))
        .filter(Number.isFinite);
      assert.ok(
        keyframeTimes.some((value) => Math.abs(value - 3.5) < 0.1),
        `No IDR found around SCTE-35 event PTS; keyframes=${keyframeTimes.join(",")}`,
      );
      const monitor = await runCommand(tspPath, [
        "-I", "file", capture,
        "-P", "splicemonitor", "--splice-pid", "500", "--all-commands",
        "--json-line=VERIFY:",
        "-O", "drop",
      ]);
      assert.match(monitor.stderr, /"event-id": 54321/);
      assert.match(monitor.stderr, /"segmentation_type_id": 52/);
    } finally {
      receiver?.kill("SIGTERM");
      await supervisor.close();
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test(
  "real plain SRT playout uses TSDuck relay when FFmpeg SRT is not required",
  { skip: process.env.GRUBER_RUN_SRT_TESTS !== "1", timeout: 30_000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gruber-srt-test-"));
    const clip = path.join(directory, "program.mp4");
    const capture = path.join(directory, "capture.ts");
    const previewDirectory = path.join(directory, "preview");
    const srtPort = await testUdpPort();
    const capabilities = new FfmpegCapabilitiesService();
    const supervisor = new PlayoutSupervisor(capabilities, previewDirectory);
    const tspPath = process.env.TSDUCK_PATH ?? "tsp";
    let receiver: ReturnType<typeof spawn> | null = null;
    let receiverLogs = "";
    try {
      await runCommand(capabilities.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
        "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000",
        "-t", "2", "-c:v", "libx264", "-preset", "ultrafast",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip,
      ]);
      receiver = spawn(tspPath, [
        "-I", "srt", "--listener", `127.0.0.1:${srtPort}`,
        "-O", "file", capture,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      receiver.stderr?.on("data", (chunk: Buffer) => {
        receiverLogs += chunk.toString("utf8");
      });
      await new Promise<void>((resolve, reject) => {
        receiver?.once("spawn", resolve);
        receiver?.once("error", reject);
      });

      const request = baseRequest();
      request.playlist = [{
        id: "program",
        name: "program.mp4",
        filePath: clip,
        trimInSeconds: 0,
        trimOutSeconds: null,
        scte35Markers: [],
      }];
      request.video.width = 640;
      request.video.height = 360;
      request.video.targetBitrateKbps = 1_200;
      request.video.maxBitrateKbps = 1_200;
      request.video.bufferSizeKbps = 2_400;
      request.endpoint = {
        protocol: "srt",
        host: "127.0.0.1",
        port: srtPort,
        mode: "caller",
        latencyMs: 120,
        passphrase: "",
        streamId: "",
      };

      await supervisor.start(request);
      const deadline = Date.now() + 20_000;
      while (["starting", "running"].includes(supervisor.getStatus().state)) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for SRT playout");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const status = supervisor.getStatus();
      assert.equal(status.state, "completed", status.logs.slice(-20).join("\n"));
      assert.equal(status.scte35.state, "disabled");
      assert.match(status.logs.join("\n"), /TSDuck SRT relay started/);
      assert.doesNotMatch(status.logs.join("\n"), /dts < pcr/i);

      if (receiver.exitCode == null) {
        receiver.kill("SIGTERM");
        await new Promise<void>((resolve) => receiver?.once("close", () => resolve()));
      }
      const streams = await runCommand(capabilities.ffprobePath, [
        "-v", "error", "-show_entries", "stream=codec_name", "-of", "json", capture,
      ]);
      assert.match(streams.stdout, /"codec_name": "h264"/, receiverLogs);
      assert.match(streams.stdout, /"codec_name": "aac"/, receiverLogs);
    } finally {
      receiver?.kill("SIGTERM");
      await supervisor.close();
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test(
  "Prisma persists a broadcast configuration and encrypts RTMP secret",
  { skip: process.env.GRUBER_RUN_DATABASE_TESTS !== "1", timeout: 20_000 },
  async () => {
    const connectionString = process.env.DATABASE_URL;
    assert.ok(connectionString, "DATABASE_URL is required for database integration test");
    const secretKey = Buffer.alloc(32, 7).toString("base64");
    const database = new DatabaseService(connectionString, secretKey);
    await database.connect();
    let savedId: string | null = null;
    try {
      const request = baseRequest();
      request.repeatPlaylist = true;
      request.scte35 = {
        ...request.scte35,
        enabled: true,
        defaultEventId: 12_345,
        defaultUpid: "TEST-AD-001",
      };
      request.playlist[0]!.scte35Markers = [{
        id: "cue-1",
        positionSeconds: 0.5,
        eventId: 12_345,
        kind: "break-start",
        durationSeconds: 30,
        segmentationTypeId: 0x34,
        upid: "TEST-AD-001",
      }];
      request.endpoint = {
        protocol: "rtmp",
        serverUrl: "rtmp://127.0.0.1/live",
        streamKey: "integration-secret",
      };
      const name = `Integration ${Date.now()}`;
      const saved = await database.saveConfiguration(
        { ...request, name },
        [{
          filePath: "/media/one.mp4",
          name: "one.mp4",
          durationSeconds: 2,
          videoCodec: "h264",
          videoProfile: "High",
          width: 1280,
          height: 720,
          frameRate: 25,
          bitrate: 2_500_000,
          sizeBytes: 1_000_000,
          pixelFormat: "yuv420p",
          colorSpace: "bt709",
          hasAudio: true,
          audioCodec: "aac",
          audioSampleRate: 48_000,
          audioChannels: 2,
        }],
      );
      savedId = saved.id;
      assert.equal(saved.endpoint.protocol, "rtmp");
      assert.equal(saved.endpoint.streamKey, "integration-secret");
      assert.equal(saved.repeatPlaylist, true);
      assert.equal(saved.scte35.enabled, true);
      assert.equal(saved.scte35.defaultEventId, 12_345);
      assert.equal(saved.playlist[0]?.scte35Markers[0]?.eventId, 12_345);
      const rawEndpoint = await database.client.outputEndpoint.findFirstOrThrow({
        where: { configurations: { some: { id: saved.id } } },
      });
      assert.ok(rawEndpoint.encryptedSecret);
      assert.doesNotMatch(JSON.stringify(rawEndpoint.configuration), /integration-secret/);
      assert.ok((await database.listConfigurations()).some((item) => item.id === saved.id));
    } finally {
      if (savedId) await database.deleteConfiguration(savedId);
      await database.disconnect();
    }
  },
);

/* -------------------------------------------------------------------------- *
 * Эфирные эффекты второго уровня
 * -------------------------------------------------------------------------- */

function textStyle() {
  return {
    boxColor: "#000000",
    boxEnabled: true,
    boxOpacity: 0.6,
    boxPaddingPercent: 1,
    align: "left" as const,
    color: "#FFFFFF",
    fontFamily: "",
    fontFilePath: null,
    fontSizePercent: 5,
    xPercent: 4,
    yPercent: 80,
  };
}

function textOverlay(overrides: Record<string, unknown> = {}) {
  return {
    clockFormat: "HH:MM:SS" as const,
    content: "",
    countdownFromSeconds: 0,
    direction: "left" as const,
    effectId: "fx-2",
    endSeconds: 30,
    id: "text-1",
    mode: "static" as const,
    name: "Ticker",
    regionWidthPercent: 100,
    regionXPercent: 0,
    repeat: 0,
    speedPixelsPerSecond: 120,
    startSeconds: 0,
    style: textStyle(),
    timezoneOffsetMinutes: 0,
    ...overrides,
  };
}

test("ticker drawtext keeps a constant speed and hides itself after the last loop", () => {
  const frame = { airEpochSeconds: 1_700_000_000, height: 720, width: 1_280 };
  const endless = buildTextOverlayFilter(
    textOverlay({ content: "Срочные новости • ", mode: "ticker", startSeconds: 2 }),
    frame,
  );
  // Позиция зависит от tw — ширины уже отрисованной надписи, поэтому длинный и
  // короткий текст едут одинаково быстро, а круг замыкается за (w+tw)/speed.
  assert.match(endless, /x='w-mod\(\(max\(0,t-2\)\*120\),\(w\+tw\)\)'/);
  assert.match(endless, /fontsize=36/);
  assert.match(endless, /enable='between\(t,2,30\)'/);

  const twice = buildTextOverlayFilter(
    textOverlay({ content: "Котировки", direction: "right", mode: "ticker", repeat: 2 }),
    frame,
  );
  assert.match(twice, /if\(gte\(\(max\(0,t-0\)\*120\),2\*\(w\+tw\)\),0-tw-16,/);
  assert.match(twice, /-tw\+mod\(/);
});

test("a ticker bound to a plate is clipped to its own canvas, not the whole frame", () => {
  const request = baseRequest();
  const overlay = textOverlay({
    content: "TEST TEST TEST",
    mode: "ticker",
    regionWidthPercent: 40,
    regionXPercent: 18,
    style: { ...textStyle(), yPercent: 88 },
  });
  const command = buildFfmpegCommand(
    request,
    [{ ...preparedItems()[0]!, textOverlays: [overlay] }],
    "/tmp/preview",
  );

  // Строка рисуется на своём прозрачном холсте шириной 40% кадра…
  assert.match(command.filterGraph, /color=c=black@0:s=512x65:r=25:d=2\[vtickerbg0_0\]/);
  // …внутри него координата считается от его же ширины…
  assert.match(command.filterGraph, /\[vtickerbg0_0\]drawtext=.*x='w-mod/);
  assert.match(command.filterGraph, /y='\(h-th\)\/2'/);
  // …и холст накладывается на кадр ровно в заданную полосу.
  assert.match(command.filterGraph, /\[vticker0_0\]overlay=x=230:y=601/);
});

test("a full-width ticker needs no separate canvas", () => {
  const request = baseRequest();
  const command = buildFfmpegCommand(
    request,
    [{ ...preparedItems()[0]!, textOverlays: [textOverlay({ content: "NEWS", mode: "ticker" })] }],
    "/tmp/preview",
  );
  assert.doesNotMatch(command.filterGraph, /vtickerbg/);
});

test("clock drawtext follows on-air time, not the renderer's own wall clock", () => {
  const filter = buildTextOverlayFilter(
    textOverlay({ mode: "clock", timezoneOffsetMinutes: 180 }),
    { airEpochSeconds: 1_700_000_000, height: 1_080, width: 1_920 },
  );
  // gmtime со сдвигом пояса вместо localtime: результат одинаков в любой TZ
  // сервера, а смещение равно эфирному времени первого кадра ролика.
  assert.match(filter, /%\{pts\\:gmtime\\:1700010800\\:%H\}\\:%\{pts\\:gmtime\\:1700010800\\:%M\}/);
  assert.doesNotMatch(filter, /localtime/);
});

test("countdown drawtext reaches zero without accumulating error", () => {
  const filter = buildTextOverlayFilter(
    textOverlay({
      clockFormat: "MM:SS",
      countdownFromSeconds: 90,
      endSeconds: 120,
      mode: "countdown",
      startSeconds: 10,
    }),
    { airEpochSeconds: 0, height: 720, width: 1_280 },
  );
  assert.match(filter, /%\{eif\\:trunc\(mod\(max\(0,90-\(t-10\)\)\/60,60\)\)\\:d\\:2\}/);
  assert.match(filter, /%\{eif\\:trunc\(mod\(max\(0,90-\(t-10\)\),60\)\)\\:d\\:2\}/);
});

test("static drawtext escapes an operator percent sign instead of expanding it", () => {
  const filter = buildTextOverlayFilter(
    textOverlay({ content: "Скидка 20% в 12:00" }),
    { airEpochSeconds: 0, height: 720, width: 1_280 },
  );
  assert.match(filter, /text='Скидка 20\\% в 12\\:00'/);
});

test("stinger halves come from one file: the tail at zero, the head from the cut point", () => {
  const request = baseRequest();
  request.playlist[0] = {
    ...request.playlist[0]!,
    effects: [{
      id: "stinger-head",
      effectId: "fx-stinger",
      name: "Stinger",
      filePath: "/media/stinger.mov",
      kind: "video",
      sourceDurationSeconds: 1.2,
      startSeconds: 0,
      endSeconds: 0.68,
      sourceInSeconds: 0.52,
      blendMode: "luma" as const,
      lumaThreshold: 0.1,
      offsetXPercent: 0,
      offsetYPercent: 0,
      tier: 2 as const,
      titlePaths: [],
    }],
  };
  const command = buildFfmpegCommand(
    request,
    [{ ...preparedItems()[0]!, effects: request.playlist[0]!.effects }],
    "/tmp/preview",
  );
  // Вторая половина перехода берётся из середины файла и вырезает чёрный фон.
  assert.match(command.filterGraph, /trim=start=0\.52:duration=0\.68/);
  assert.match(command.filterGraph, /lumakey=threshold=0\.1:tolerance=0\.05:softness=0\.02/);
});

test("stinger audio mixes into every track before the length tail, not after it", () => {
  const request = baseRequest();
  const item = {
    ...preparedItems()[0]!,
    audioOverlays: [{
      id: "sfx-1",
      effectId: "fx-stinger",
      filePath: "/media/stinger.mov",
      sourceInSeconds: 0.52,
      startSeconds: 0,
      durationSeconds: 0.68,
      gainDb: -6,
    }],
  };
  const command = buildFfmpegClipAudioProducerCommand(request, item);
  const sampleCount = clipAudioSampleCount(item.durationSeconds, request.audio.sampleRate);

  assert.deepEqual(command.args.slice(command.args.indexOf("-i")), [
    "-i", "/media/one.mp4",
    "-i", "/media/stinger.mov",
    "-filter_complex", command.filterGraph,
    "-map", "[aprogram]",
    "-c:a", "pcm_s16le",
    "-ar", String(request.audio.sampleRate),
    "-ac", String(request.audio.channels),
    "-f", "s16le",
    "pipe:1",
  ]);
  assert.match(command.filterGraph, /\[1:a:0\]atrim=start=0\.52:duration=0\.68/);
  assert.match(command.filterGraph, /volume=-6dB\[afx0\]/);
  assert.match(command.filterGraph, /amix=inputs=2:duration=first:normalize=0/);
  // Хвост, задающий длину дорожки, обязан остаться последним: мультиплексор
  // встаёт, если один вход отдаёт другое число сэмплов.
  const mixIndex = command.filterGraph.indexOf("amix=");
  const padIndex = command.filterGraph.indexOf(`apad=whole_len=${sampleCount}`);
  assert.ok(mixIndex > 0 && padIndex > mixIndex);
  assert.match(command.filterGraph, new RegExp(`atrim=end_sample=${sampleCount}`));
});

test("a task file accepts scalar and nested fields and describes them for JSON Parser", () => {
  const single = parseBroadcastTaskDocument({
    name: " Инзерские зубчатки ",
    eng: "Inzer Cogs",
    region: "Республика Башкортостан",
  });
  assert.deepEqual(single.entries, [{
    name: "Инзерские зубчатки",
    values: { eng: "Inzer Cogs", region: "Республика Башкортостан" },
  }]);
  assert.deepEqual(single.warnings, []);
  assert.equal(single.records[0]?.region, "Республика Башкортостан");
  assert.equal(single.fields.find((field) => field.key === "eng")?.populatedCount, 1);

  const batch = parseBroadcastTaskDocument([
    { name: "Первый", eng: "First" },
    { name: "Первый", eng: "Again" },
    { name: "Второй", duration: 12, programme: { title: "Новости" }, live: true },
  ]);
  assert.deepEqual(batch.entries.map((entry) => entry.name), ["Первый", "Второй"]);
  assert.deepEqual(batch.entries[0]!.values, { eng: "Again" });
  assert.equal(batch.entries[1]!.values.duration, "12");
  assert.equal(batch.entries[1]!.values["programme.title"], "Новости");
  assert.equal(batch.entries[1]!.values.live, "true");
  assert.match(batch.warnings.join("\n"), /appears more than once/);

  const withoutName = parseBroadcastTaskDocument([{ media_id: "clip-42", eng: "no name" }]);
  assert.equal(withoutName.records[0]?.media_id, "clip-42");
  assert.deepEqual(withoutName.entries, []);
  assert.match(withoutName.warnings.join("\n"), /JSON Parser/);

  const largeArray = parseBroadcastTaskDocument(Array.from(
    { length: 8_347 },
    (_, index) => ({ title: `Ролик ${index + 1}.MP4`, text_title: `Плашка ${index + 1}` }),
  ));
  assert.equal(largeArray.records.length, 8_347);
  assert.equal(largeArray.fields.find((field) => field.key === "title")?.populatedCount, 8_347);
  assert.equal(largeArray.records[8_346]?.text_title, "Плашка 8347");
});

test("ticker source reads plain lines and both supported JSON shapes", () => {
  assert.deepEqual(
    parseTickerSourceDocument("first\n\n  second  \n", ".txt").items,
    ["first", "second"],
  );
  assert.deepEqual(parseTickerSourceDocument('["one","two"]', ".json").items, ["one", "two"]);
  assert.deepEqual(
    parseTickerSourceDocument('{"items":["one",7]}', ".json"),
    { items: ["one"], warnings: ["A non-string ticker message was skipped"] },
  );
  assert.throws(() => parseTickerSourceDocument('{"rows":[]}', ".json"), /must be an array/);
});

/* -------------------------------------------------------------------------- *
 * Суточный журнал работы
 * -------------------------------------------------------------------------- */

function airStatus(overrides: Record<string, unknown> = {}) {
  return playoutStatusSchema.parse({
    state: "running",
    sessionId: "session-1",
    startedAt: "2026-08-19T09:00:00.000Z",
    stoppedAt: null,
    currentItemIndex: 0,
    currentItemId: "clip-a",
    currentItemName: "Инзерские зубчатки",
    currentItemDurationSeconds: 120,
    totalItems: 3,
    outTimeSeconds: 30,
    totalDurationSeconds: 360,
    progressPercent: 8,
    frame: 750,
    fps: 25,
    bitrateKbps: 4_000,
    speed: 1,
    endpointLabel: "udp://239.0.0.1:1234",
    previewPath: null,
    transportBitrateBps: 8_000_000,
    error: null,
    logs: [],
    ...overrides,
  });
}

test("log line carries the local date, time and level for every entry", () => {
  const at = new Date(2026, 7, 19, 9, 5, 3, 42);
  assert.equal(
    formatLogLine(at, "error", "PLAYOUT", "Clip 2 renderer failed\n  broken pipe"),
    "[2026-08-19 09:05:03.042] ERROR PLAYOUT   Clip 2 renderer failed broken pipe",
  );
  assert.equal(logFileName(at), "fluxio-2026-08-19.log");
});

test("daily stats follow the air from status snapshots, not from log text", () => {
  const at = new Date(2026, 7, 19, 9, 0, 0);
  const opened = observeStatus(emptyDailyStats("2026-08-19"), airStatus(), at);
  assert.deepEqual(opened.entries.map((entry) => entry.category), ["AIR", "AIR"]);
  assert.match(opened.entries[0]!.message, /Эфирная сессия session-1 начата: 3 ролик\(ов\)/);
  assert.match(opened.entries[1]!.message, /В эфире 1\/3: "Инзерские зубчатки" \(00:02:00\)/);

  // Тот же ролик повторно не считается — иначе закольцованный эфир врал бы.
  const same = observeStatus(opened.stats, airStatus({ outTimeSeconds: 60 }), at);
  assert.deepEqual(same.entries, []);
  assert.deepEqual(same.stats.sessions[0]!.airedItemIds, ["clip-a"]);

  const next = observeStatus(
    same.stats,
    airStatus({ currentItemId: "clip-b", currentItemIndex: 1, currentItemName: "Новости", outTimeSeconds: 130 }),
    at,
  );
  assert.equal(next.stats.sessions[0]!.airedItemIds.length, 2);
  assert.equal(next.stats.sessions[0]!.transportBitrateKbps, 8_000);

  const failed = observeStatus(
    next.stats,
    airStatus({ state: "failed", error: "Clip 2 renderer failed", stoppedAt: "2026-08-19T09:10:00.000Z" }),
    at,
  );
  assert.deepEqual(failed.stats.errors, ["Clip 2 renderer failed"]);
  assert.equal(failed.stats.sessions[0]!.endState, "failed");
  // Повторный снимок той же аварии второй записи не создаёт.
  assert.deepEqual(observeStatus(failed.stats, airStatus({ state: "failed", error: "Clip 2 renderer failed" }), at).entries, []);

  const report = buildDailyReport(failed.stats, at);
  assert.match(report, /СУТОЧНЫЙ ОТЧЁТ ЗА 2026-08-19/);
  assert.match(report, /Эфирных сессий:        1 \(аварийно завершено: 1\)/);
  assert.match(report, /Роликов выдано:        2/);
  assert.match(report, /udp:\/\/239\.0\.0\.1:1234 @ 8000 кбит\/с/);
  assert.match(report, /ОШИБКА: Clip 2 renderer failed/);
});

test("ticker feed takes headlines from RSS and Atom and unescapes their text", () => {
  const rss = parseTickerFeed(`<rss><channel>
    <title>Лента</title>
    <item><title><![CDATA[Срочно: курс вырос]]></title></item>
    <item><title>Пленум &amp; совет &#171;итоги&#187;</title></item>
    <item><description>без заголовка</description></item>
  </channel></rss>`, 30);
  // Заголовок самой ленты не новость: берутся только заголовки записей.
  assert.deepEqual(rss.items, ["Срочно: курс вырос", "Пленум & совет «итоги»"]);
  assert.match(rss.warnings[0]!, /без заголовка пропущена/);

  const atom = parseTickerFeed(
    "<feed><entry><title>Первая</title></entry><entry><title>Вторая</title></entry></feed>",
    1,
  );
  assert.deepEqual(atom.items, ["Первая"]);

  assert.throws(() => parseTickerFeed("<html><body>not a feed</body></html>", 30), /no <item>/);
});

test("font scan reads the family name and detects Cyrillic coverage", async () => {
  const candidates = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Geneva.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  let checked = 0;
  for (const candidate of candidates) {
    let buffer: Buffer;
    try {
      buffer = await readFile(candidate);
    } catch {
      continue;
    }
    checked += 1;
    assert.equal(typeof supportsCyrillic(buffer), "boolean");
    const family = readFontFamily(buffer);
    assert.ok(family && family.length > 0, `${candidate} has no family name`);
    assert.doesNotMatch(family, /\0/);
  }
  if (checked === 0) return; // На машине сборки системных шрифтов может не быть.
  // Заведомо не шрифт разбирается без исключения и без ложного «есть кириллица».
  assert.equal(supportsCyrillic(Buffer.from("not a font at all")), false);
  assert.equal(readFontFamily(Buffer.from("not a font at all")), null);
});

function baseRequest(): StartPlayoutRequest {
  return {
    playlist: [{
      id: "one",
      name: "one.mp4",
      filePath: "/media/one.mp4",
      trimInSeconds: 0,
      trimOutSeconds: null,
      scte35Markers: [],
      scheduleType: null,
      declaredDurationSeconds: null,
      ageTitle: null,
      itemLogo: null,
    }],
    nextPlaylist: [],
    video: {
      codec: "h264",
      width: 1280,
      height: 720,
      frameRate: 25,
      rateControl: "cbr",
      targetBitrateKbps: 2_500,
      maxBitrateKbps: 2_500,
      bufferSizeKbps: 5_000,
      crf: 20,
      preset: "veryfast",
      profile: "high",
      level: "4.1",
      deinterlace: false,
      fieldOrder: "progressive",
      gopSize: 50,
      bFrames: 0,
      closedGop: true,
    },
    audio: {
      codec: "aac",
      sampleRate: 48_000,
      channels: 2,
      bitrateKbps: 128,
      loudnessNormalization: {
        enabled: false,
        targetLufs: -23,
        truePeakDbtp: -1,
        loudnessRangeLufs: 7,
      },
    },
    logo: null,
    endpoint: {
      protocol: "udp",
      host: "239.1.1.1",
      port: 5_000,
      packetSize: 1_316,
      ttl: 16,
      localAddress: "",
      mpegTs: { ...defaultMpegTsOutputSettings },
    },
    subtitleOutput: { ...defaultSubtitleOutput },
    repeatPlaylist: false,
    scte35: {
      enabled: false,
      command: "time_signal",
      owner: "provider",
      pid: 500,
      preRollMs: 4_000,
      defaultEventId: 1,
      defaultBreakDurationSeconds: 120,
      upidType: "ad-id",
      defaultUpid: "",
      loopEventStrategy: "increment",
    },
  };
}

function preparedItems() {
  return [{
    id: "one",
    name: "one.mp4",
    filePath: "/media/one.mp4",
    trimInSeconds: 0,
    durationSeconds: 2,
    hasAudio: true,
  }];
}

async function testUdpPort(): Promise<number> {
  const socket = createSocket("udp4");
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  assert.notEqual(typeof address, "string");
  socket.close();
  return typeof address === "string" ? 0 : address.port;
}

interface UdpDatagram {
  payload: Buffer;
  receivedAtMs: number;
}

function analyzeUdpTransport(datagrams: UdpDatagram[], clipBoundarySeconds: number) {
  assert.ok(datagrams.length > 20, "Expected UDP datagrams from FFmpeg");
  const firstTime = datagrams[0]!.receivedAtMs;
  const lastTime = datagrams.at(-1)!.receivedAtMs;
  const elapsedSeconds = Math.max(0.001, (lastTime - firstTime) / 1_000);
  let totalBytes = 0;
  let nullPackets = 0;
  for (const { payload } of datagrams) {
    totalBytes += payload.length;
    for (let offset = 0; offset + 188 <= payload.length; offset += 188) {
      if (payload[offset] !== 0x47) continue;
      const pid = ((payload[offset + 1]! & 0x1f) << 8) | payload[offset + 2]!;
      if (pid === 0x1fff) nullPackets += 1;
    }
  }
  const boundaryStartMs = firstTime + clipBoundarySeconds * 1_000 - 300;
  const boundaryEndMs = boundaryStartMs + 600;
  const boundaryBytes = datagrams
    .filter(({ receivedAtMs }) => receivedAtMs >= boundaryStartMs && receivedAtMs < boundaryEndMs)
    .reduce((sum, { payload }) => sum + payload.length, 0);
  // Ignore MPEG-TS mux warm-up/drain. Those fixed offsets distort short
  // synthetic captures but disappear inside a week-long on-air session.
  const steadyStartMs = firstTime + 1_000;
  const steadyEndMs = lastTime - 1_000;
  const steadyBytes = datagrams
    .filter(({ receivedAtMs }) => receivedAtMs >= steadyStartMs && receivedAtMs < steadyEndMs)
    .reduce((sum, { payload }) => sum + payload.length, 0);
  const steadySeconds = Math.max(0.001, (steadyEndMs - steadyStartMs) / 1_000);
  return {
    averageBitrateBps: totalBytes * 8 / elapsedSeconds,
    boundaryBitrateBps: boundaryBytes * 8 / 0.6,
    elapsedSeconds,
    nullPackets,
    steadyBitrateBps: steadyBytes * 8 / steadySeconds,
  };
}

function extractPcrIntervalsMs(stream: Buffer): number[] {
  const packetSize = 188;
  const wrap = (1n << 33n) * 300n;
  const previousByPid = new Map<number, bigint>();
  const intervals: number[] = [];
  for (let offset = 0; offset + packetSize <= stream.length; offset += packetSize) {
    if (stream[offset] !== 0x47) continue;
    const pid = ((stream[offset + 1]! & 0x1f) << 8) | stream[offset + 2]!;
    const adaptationControl = (stream[offset + 3]! >> 4) & 0x03;
    if (adaptationControl !== 2 && adaptationControl !== 3) continue;
    const adaptationLength = stream[offset + 4]!;
    if (adaptationLength < 7 || (stream[offset + 5]! & 0x10) === 0) continue;
    const start = offset + 6;
    const base =
      (BigInt(stream[start]!) << 25n) |
      (BigInt(stream[start + 1]!) << 17n) |
      (BigInt(stream[start + 2]!) << 9n) |
      (BigInt(stream[start + 3]!) << 1n) |
      (BigInt(stream[start + 4]!) >> 7n);
    const extension = (BigInt(stream[start + 4]! & 0x01) << 8n) |
      BigInt(stream[start + 5]!);
    const value = base * 300n + extension;
    const previous = previousByPid.get(pid);
    if (previous != null) {
      const delta = value >= previous ? value - previous : wrap - previous + value;
      const milliseconds = Number(delta) / 27_000;
      if (milliseconds > 0 && milliseconds < 1_000) intervals.push(milliseconds);
    }
    previousByPid.set(pid, value);
  }
  return intervals;
}

function findContinuityCounterErrors(stream: Buffer): Array<{
  actual: number;
  expected: number;
  packetIndex: number;
  pid: number;
}> {
  const packetSize = 188;
  const previousByPid = new Map<number, number>();
  const errors: Array<{
    actual: number;
    expected: number;
    packetIndex: number;
    pid: number;
  }> = [];
  for (let offset = 0; offset + packetSize <= stream.length; offset += packetSize) {
    if (stream[offset] !== 0x47) continue;
    const pid = ((stream[offset + 1]! & 0x1f) << 8) | stream[offset + 2]!;
    if (pid === 0x1fff) continue;
    const adaptationControl = (stream[offset + 3]! >> 4) & 0x03;
    const hasPayload = adaptationControl === 1 || adaptationControl === 3;
    if (!hasPayload) continue;
    const continuityCounter = stream[offset + 3]! & 0x0f;
    const adaptationLength = adaptationControl === 3 ? stream[offset + 4]! : 0;
    const discontinuity = adaptationControl === 3 && adaptationLength > 0 &&
      (stream[offset + 5]! & 0x80) !== 0;
    const previous = previousByPid.get(pid);
    if (previous != null && !discontinuity) {
      const expected = (previous + 1) & 0x0f;
      if (continuityCounter !== expected) {
        errors.push({
          actual: continuityCounter,
          expected,
          packetIndex: offset / packetSize,
          pid,
        });
      }
    }
    previousByPid.set(pid, continuityCounter);
  }
  return errors;
}

function estimatePcrBitrateBps(stream: Buffer): number {
  const packetSize = 188;
  const wrap = (1n << 33n) * 300n;
  const firstByPid = new Map<number, { packetIndex: number; value: bigint }>();
  const lastByPid = new Map<number, { packetIndex: number; value: bigint }>();
  for (let offset = 0; offset + packetSize <= stream.length; offset += packetSize) {
    if (stream[offset] !== 0x47) continue;
    const pid = ((stream[offset + 1]! & 0x1f) << 8) | stream[offset + 2]!;
    const adaptationControl = (stream[offset + 3]! >> 4) & 0x03;
    if (adaptationControl !== 2 && adaptationControl !== 3) continue;
    const adaptationLength = stream[offset + 4]!;
    if (adaptationLength < 7 || (stream[offset + 5]! & 0x10) === 0) continue;
    const start = offset + 6;
    const base =
      (BigInt(stream[start]!) << 25n) |
      (BigInt(stream[start + 1]!) << 17n) |
      (BigInt(stream[start + 2]!) << 9n) |
      (BigInt(stream[start + 3]!) << 1n) |
      (BigInt(stream[start + 4]!) >> 7n);
    const extension = (BigInt(stream[start + 4]! & 0x01) << 8n) |
      BigInt(stream[start + 5]!);
    const sample = { packetIndex: offset / packetSize, value: base * 300n + extension };
    firstByPid.set(pid, firstByPid.get(pid) ?? sample);
    lastByPid.set(pid, sample);
  }
  const estimates: number[] = [];
  for (const [pid, first] of firstByPid) {
    const last = lastByPid.get(pid);
    if (!last || last.packetIndex <= first.packetIndex) continue;
    const ticks = last.value >= first.value
      ? last.value - first.value
      : wrap - first.value + last.value;
    if (ticks <= 0n) continue;
    const packetBits = BigInt(last.packetIndex - first.packetIndex) * 188n * 8n;
    estimates.push(Number(packetBits * 27_000_000n / ticks));
  }
  assert.ok(estimates.length > 0, "Expected PCR samples for bitrate estimation");
  return median(estimates);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
