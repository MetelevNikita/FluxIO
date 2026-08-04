import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  playoutStatusSchema,
  serviceHealthSchema,
  startPlayoutRequestSchema,
  systemMetricsSchema,
  type StartPlayoutRequest,
} from "@gruber/contracts";
import { buildApp } from "./app.js";
import { buildFfmpegCommand } from "./ffmpeg/command-builder.js";
import { FfmpegCapabilitiesService } from "./ffmpeg/capabilities.js";
import { MediaPreviewService } from "./ffmpeg/media-preview.js";
import { PlayoutSupervisor } from "./ffmpeg/playout-supervisor.js";
import { runCommand } from "./ffmpeg/process.js";
import { DatabaseService } from "./database/database.js";
import { calculateCpuPercent } from "./system-metrics.js";
import { buildScte35CueXml, planScte35Cues } from "./tsduck/cue-builder.js";
import {
  buildTsdDuckCommand,
  calculateTransportMuxRate,
} from "./tsduck/command-builder.js";

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
    assert.equal(health.status, process.env.DATABASE_URL ? "ready" : "degraded");
  } finally {
    await app.close();
  }
});

test("GET /api/playout/status starts idle", async () => {
  const app = buildApp({ logger: false });
  try {
    const response = await app.inject({ method: "GET", url: "/api/playout/status" });
    assert.equal(response.statusCode, 200);
    assert.equal(playoutStatusSchema.parse(response.json()).state, "idle");
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

test("FFmpeg command concatenates clips and creates UDP plus HLS outputs", () => {
  const request = baseRequest();
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
    "/tmp/gruber-test-preview",
  );
  const rendered = command.args.join(" ");
  assert.match(rendered, /concat=n=2:v=1:a=1/);
  assert.match(rendered, /anullsrc=r=48000:cl=stereo/);
  assert.match(rendered, /udp:\/\/239\.1\.1\.1:5000\?pkt_size=1316&ttl=16/);
  assert.match(rendered, /\/tmp\/gruber-test-preview\/index\.m3u8/);
  assert.equal(command.totalDurationSeconds, 5);
});

test("FFmpeg command burns logo before program and preview split", () => {
  const request: StartPlayoutRequest = {
    ...baseRequest(),
    logo: {
      filePath: "/media/logo.png",
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
  assert.match(filter, /\[vrealtime\]split=2\[vprogram\]\[vpreviewbase\]/);
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
  assert.equal(cues[0]?.pts, 540_000);
  assert.equal(cues[0]?.durationTicks, 2_700_000);

  const xml = buildScte35CueXml(request, cues);
  assert.match(xml, /<time_signal pts_time="540000"\/>/);
  assert.match(xml, /segmentation_event_id="12345"/);
  assert.match(xml, /segmentation_duration="2700000"/);
  assert.match(xml, /segmentation_type_id="0x34"/);
  assert.match(xml, /544553542D41442D303031/);
});

test("TSDuck command adds CUEI PMT signaling, SCTE PID and UDP output", () => {
  const request = baseRequest();
  request.scte35.enabled = true;
  request.scte35.pid = 500;
  const command = buildTsdDuckCommand({
    cueCount: 1,
    cueFilePath: "/tmp/cues.xml",
    inputPort: 19_001,
    request,
  });
  const rendered = command.args.join(" ");
  assert.match(rendered, /-I ip --local-address 127\.0\.0\.1 19001/);
  assert.match(rendered, /--add-registration 0x43554549/);
  assert.match(rendered, /--add-pid 500\/0x86/);
  assert.match(rendered, /spliceinject .*--files \/tmp\/cues\.xml/);
  assert.match(rendered, /splicemonitor .*--splice-pid 500/);
  assert.match(rendered, /-O ip .*239\.1\.1\.1:5000/);
  assert.ok(calculateTransportMuxRate(request) > 2_628_000);
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
    },
    transportMuxRateBps: 3_700_000,
  });
  const rendered = command.args.join(" ");
  assert.match(rendered, /-force_key_frames 6,12\.5/);
  assert.match(rendered, /-muxrate 3700000/);
  assert.match(rendered, /-mpegts_service_id 1/);
  assert.match(rendered, /udp:\/\/127\.0\.0\.1:19001/);
  assert.equal(command.endpointLabel, "UDP 239.1.1.1:5000");
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

test(
  "real FFmpeg session plays two clips to UDP and writes HLS preview",
  { skip: process.env.GRUBER_RUN_FFMPEG_TESTS !== "1", timeout: 30_000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gruber-ffmpeg-test-"));
    const clipOne = path.join(directory, "one.mp4");
    const clipTwo = path.join(directory, "two.mp4");
    const logo = path.join(directory, "logo.png");
    const previewDirectory = path.join(directory, "preview");
    const clipPreviewDirectory = path.join(directory, "clip-preview");
    const capabilities = new FfmpegCapabilitiesService();
    const supervisor = new PlayoutSupervisor(capabilities, previewDirectory);
    const mediaPreview = new MediaPreviewService(
      capabilities.ffmpegPath,
      clipPreviewDirectory,
    );
    try {
      await runCommand(capabilities.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", "1.4", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", clipOne,
      ]);
      await runCommand(capabilities.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=blue:size=854x480:rate=30",
        "-t", "1.3", "-c:v", "libx264", "-pix_fmt", "yuv420p", clipTwo,
      ]);
      await runCommand(capabilities.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=yellow@0.8:size=120x60",
        "-frames:v", "1", logo,
      ]);
      mediaPreview.register(await realpath(clipOne), 1.4);
      const thumbnail = await mediaPreview.thumbnail(clipOne);
      assert.deepEqual([...thumbnail.subarray(0, 2)], [0xff, 0xd8]);
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
      request.video.width = 640;
      request.video.height = 360;
      request.video.targetBitrateKbps = 1_200;
      request.video.maxBitrateKbps = 1_200;
      request.video.bufferSizeKbps = 2_400;
      request.endpoint = {
        protocol: "udp",
        host: "127.0.0.1",
        port: 15_500,
        packetSize: 1_316,
        ttl: 16,
        localAddress: "",
      };
      request.logo = {
        filePath: logo,
        position: "top-right",
        widthPercent: 15,
        margin: 16,
        opacity: 0.8,
      };

      const wallStartedAt = Date.now();
      await supervisor.start(request);
      const deadline = Date.now() + 20_000;
      while (["starting", "running"].includes(supervisor.getStatus().state)) {
        if (Date.now() > deadline) {
          throw new Error("Timed out waiting for FFmpeg session");
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const status = supervisor.getStatus();
      assert.equal(status.state, "completed", status.logs.slice(-10).join("\n"));
      assert.equal(status.progressPercent, 100);
      assert.ok(
        Date.now() - wallStartedAt >= 2_300,
        "Playout must be paced close to the combined clip duration",
      );
      assert.match(await readFile(path.join(previewDirectory, "index.m3u8"), "utf8"), /#EXTM3U/);

      request.repeatPlaylist = true;
      await supervisor.start(request);
      const repeatDeadline = Date.now() + 20_000;
      while (supervisor.getStatus().loopCount < 1) {
        if (Date.now() > repeatDeadline) {
          throw new Error("Timed out waiting for repeated playlist cycle");
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
      await mediaPreview.close();
      await supervisor.close();
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
      receiver = spawn(tspPath, [
        "-I", "ip", "--local-address", "127.0.0.1",
        "--receive-timeout", "2000", String(outputPort),
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
      request.endpoint = {
        protocol: "udp",
        host: "127.0.0.1",
        port: outputPort,
        packetSize: 1_316,
        ttl: 1,
        localAddress: "",
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

function baseRequest(): StartPlayoutRequest {
  return {
    playlist: [{
      id: "one",
      name: "one.mp4",
      filePath: "/media/one.mp4",
      trimInSeconds: 0,
      trimOutSeconds: null,
      scte35Markers: [],
    }],
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
    },
    audio: {
      codec: "aac",
      sampleRate: 48_000,
      channels: 2,
      bitrateKbps: 128,
    },
    logo: null,
    endpoint: {
      protocol: "udp",
      host: "239.1.1.1",
      port: 5_000,
      packetSize: 1_316,
      ttl: 16,
      localAddress: "",
    },
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
