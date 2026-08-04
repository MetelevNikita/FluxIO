import { z } from "zod";

export const serviceHealthSchema = z.object({
  service: z.literal("gruber-media-server"),
  version: z.string(),
  apiVersion: z.literal("v1"),
  status: z.enum(["ready", "degraded"]),
  startedAt: z.iso.datetime(),
});

export type ServiceHealth = z.infer<typeof serviceHealthSchema>;

export const systemMetricsSchema = z.object({
  cpuPercent: z.number().min(0).max(100),
  networkMbps: z.number().nonnegative(),
  collectedAt: z.iso.datetime(),
});

export type SystemMetrics = z.infer<typeof systemMetricsSchema>;

export const mediaProbeSchema = z.object({
  filePath: z.string().min(1),
  name: z.string().min(1),
  durationSeconds: z.number().nonnegative(),
  videoCodec: z.string(),
  videoProfile: z.string(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  frameRate: z.number().nonnegative(),
  bitrate: z.number().nonnegative(),
  sizeBytes: z.number().nonnegative(),
  pixelFormat: z.string(),
  colorSpace: z.string(),
  hasAudio: z.boolean(),
  audioCodec: z.string().nullable(),
  audioSampleRate: z.number().int().nonnegative().nullable(),
  audioChannels: z.number().int().nonnegative().nullable(),
});

export const probeMediaRequestSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(500),
});

export const scanMediaRequestSchema = z.object({
  directoryPath: z.string().min(1),
});

export const startClipPreviewRequestSchema = z.object({
  filePath: z.string().min(1),
  startSeconds: z.number().nonnegative().default(0),
});

export const clipPreviewSessionSchema = z.object({
  sessionId: z.string().uuid(),
  manifestPath: z.string().startsWith("/api/media/clip-preview/"),
  offsetSeconds: z.number().nonnegative(),
});

export type ClipPreviewSession = z.infer<typeof clipPreviewSessionSchema>;

export const ffmpegCapabilitiesSchema = z.object({
  ffmpegPath: z.string(),
  ffprobePath: z.string(),
  version: z.string(),
  videoEncoders: z.array(z.string()),
  audioEncoders: z.array(z.string()),
  outputProtocols: z.array(z.string()),
  hardwareAccelerators: z.array(z.string()),
  supports: z.object({
    udp: z.boolean(),
    srt: z.boolean(),
    rtmp: z.boolean(),
    h264: z.boolean(),
    h265: z.boolean(),
    mpeg2: z.boolean(),
    aac: z.boolean(),
  }),
});

export const scte35MarkerSchema = z.object({
  id: z.string().min(1),
  positionSeconds: z.number().nonnegative(),
  eventId: z.number().int().min(0).max(4_294_967_295),
  kind: z.enum(["break-start", "break-end"]),
  durationSeconds: z.number().positive().nullable().default(null),
  segmentationTypeId: z.number().int().min(0).max(255),
  upid: z.string().max(255).default(""),
});

export const playoutItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  filePath: z.string().min(1),
  trimInSeconds: z.number().nonnegative().default(0),
  trimOutSeconds: z.number().positive().nullable().default(null),
  scte35Markers: z.array(scte35MarkerSchema).max(1_000).default([]),
});

export const videoEncodingSchema = z.object({
  codec: z.enum(["h264", "h265", "mpeg2"]),
  width: z.number().int().min(320).max(7680),
  height: z.number().int().min(240).max(4320),
  frameRate: z.number().min(1).max(120),
  rateControl: z.enum(["cbr", "vbr", "crf"]),
  targetBitrateKbps: z.number().int().min(250).max(200_000),
  maxBitrateKbps: z.number().int().min(250).max(250_000),
  bufferSizeKbps: z.number().int().min(250).max(500_000),
  crf: z.number().int().min(0).max(51),
  preset: z.enum([
    "ultrafast",
    "superfast",
    "veryfast",
    "faster",
    "fast",
    "medium",
    "slow",
    "slower",
    "veryslow",
  ]),
  profile: z.string().default("high"),
  level: z.string().default("4.1"),
  deinterlace: z.boolean().default(false),
});

export const audioEncodingSchema = z.object({
  codec: z.enum(["aac", "mp2", "ac3"]),
  sampleRate: z.number().int().min(8_000).max(192_000),
  channels: z.union([z.literal(1), z.literal(2), z.literal(6)]),
  bitrateKbps: z.number().int().min(32).max(640),
});

export const logoOverlaySchema = z.object({
  filePath: z.string().min(1),
  position: z.enum([
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
    "center",
  ]),
  widthPercent: z.number().min(1).max(50),
  margin: z.number().int().min(0).max(500),
  opacity: z.number().min(0.05).max(1),
});

export const udpEndpointSchema = z.object({
  protocol: z.literal("udp"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  packetSize: z.number().int().min(188).max(65_507).default(1316),
  ttl: z.number().int().min(1).max(255).default(16),
  localAddress: z.string().default(""),
});

export const srtEndpointSchema = z.object({
  protocol: z.literal("srt"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  mode: z.enum(["caller", "listener", "rendezvous"]).default("caller"),
  latencyMs: z.number().int().min(20).max(8_000).default(120),
  passphrase: z
    .string()
    .max(79)
    .refine(
      (value) => value.length === 0 || value.length >= 10,
      "SRT passphrase must be empty or contain 10–79 characters",
    )
    .default(""),
  streamId: z.string().max(512).default(""),
});

export const rtmpEndpointSchema = z.object({
  protocol: z.literal("rtmp"),
  serverUrl: z.string().regex(/^rtmps?:\/\//i),
  streamKey: z.string().min(1),
});

export const playoutEndpointSchema = z.discriminatedUnion("protocol", [
  udpEndpointSchema,
  srtEndpointSchema,
  rtmpEndpointSchema,
]);

export const scte35PlanningSchema = z.object({
  enabled: z.boolean().default(false),
  command: z.enum(["time_signal", "splice_insert"]).default("time_signal"),
  owner: z.enum(["provider", "distributor"]).default("provider"),
  pid: z.number().int().min(32).max(8_190).default(500),
  preRollMs: z.number().int().min(0).max(60_000).default(4_000),
  defaultEventId: z.number().int().min(0).max(4_294_967_295).default(1),
  defaultBreakDurationSeconds: z.number().int().min(1).max(86_400).default(120),
  upidType: z.enum(["ad-id", "uuid", "uri", "none"]).default("ad-id"),
  defaultUpid: z.string().max(255).default(""),
  loopEventStrategy: z.enum(["increment", "reuse"]).default("increment"),
});

export const startPlayoutRequestSchema = z.object({
  playlist: z.array(playoutItemSchema).min(1).max(500),
  video: videoEncodingSchema,
  audio: audioEncodingSchema,
  logo: logoOverlaySchema.nullable().default(null),
  endpoint: playoutEndpointSchema,
  repeatPlaylist: z.boolean().default(false),
  scte35: scte35PlanningSchema.default({
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
  }),
});

export const playoutStateSchema = z.enum([
  "idle",
  "starting",
  "running",
  "stopping",
  "completed",
  "failed",
]);

export const scte35InjectorStatusSchema = z.object({
  enabled: z.boolean().default(false),
  state: z.enum([
    "disabled",
    "starting",
    "running",
    "completed",
    "failed",
  ]).default("disabled"),
  pid: z.number().int().min(32).max(8_190).nullable().default(null),
  plannedEvents: z.number().int().nonnegative().default(0),
  observedEvents: z.number().int().nonnegative().default(0),
  lastEventId: z.number().int().min(0).max(4_294_967_295).nullable().default(null),
  nextEventId: z.number().int().min(0).max(4_294_967_295).nullable().default(null),
  nextEventInSeconds: z.number().nonnegative().nullable().default(null),
  error: z.string().nullable().default(null),
});

export const playoutStatusSchema = z.object({
  state: playoutStateSchema,
  sessionId: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  stoppedAt: z.iso.datetime().nullable(),
  currentItemIndex: z.number().int().nonnegative(),
  currentItemName: z.string().nullable(),
  totalItems: z.number().int().nonnegative(),
  outTimeSeconds: z.number().nonnegative(),
  totalDurationSeconds: z.number().nonnegative(),
  progressPercent: z.number().min(0).max(100),
  frame: z.number().int().nonnegative(),
  fps: z.number().nonnegative(),
  bitrateKbps: z.number().nonnegative(),
  speed: z.number().nonnegative(),
  endpointLabel: z.string().nullable(),
  previewPath: z.string().nullable(),
  repeatPlaylist: z.boolean().default(false),
  loopCount: z.number().int().nonnegative().default(0),
  scte35: scte35InjectorStatusSchema.default({
    enabled: false,
    state: "disabled",
    pid: null,
    plannedEvents: 0,
    observedEvents: 0,
    lastEventId: null,
    nextEventId: null,
    nextEventInSeconds: null,
    error: null,
  }),
  error: z.string().nullable(),
  logs: z.array(z.string()),
});

export const saveBroadcastConfigurationRequestSchema = startPlayoutRequestSchema.extend({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
});

export const savedBroadcastConfigurationSchema =
  saveBroadcastConfigurationRequestSchema.extend({
    id: z.string().uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  });

export const broadcastConfigurationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  protocol: z.enum(["udp", "srt", "rtmp"]),
  playlistItems: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});

export type MediaProbe = z.infer<typeof mediaProbeSchema>;
export type FfmpegCapabilities = z.infer<typeof ffmpegCapabilitiesSchema>;
export type Scte35Marker = z.infer<typeof scte35MarkerSchema>;
export type PlayoutItem = z.infer<typeof playoutItemSchema>;
export type VideoEncoding = z.infer<typeof videoEncodingSchema>;
export type AudioEncoding = z.infer<typeof audioEncodingSchema>;
export type LogoOverlay = z.infer<typeof logoOverlaySchema>;
export type PlayoutEndpoint = z.infer<typeof playoutEndpointSchema>;
export type Scte35Planning = z.infer<typeof scte35PlanningSchema>;
export type Scte35InjectorStatus = z.infer<typeof scte35InjectorStatusSchema>;
export type StartPlayoutRequest = z.infer<typeof startPlayoutRequestSchema>;
export type PlayoutStatus = z.infer<typeof playoutStatusSchema>;
export type SaveBroadcastConfigurationRequest = z.infer<
  typeof saveBroadcastConfigurationRequestSchema
>;
export type SavedBroadcastConfiguration = z.infer<
  typeof savedBroadcastConfigurationSchema
>;
export type BroadcastConfigurationSummary = z.infer<
  typeof broadcastConfigurationSummarySchema
>;
