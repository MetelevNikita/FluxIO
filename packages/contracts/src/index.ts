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

export const networkInterfaceSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  family: z.enum(["IPv4", "IPv6"]),
  cidr: z.string().nullable(),
  netmask: z.string().min(1),
  mac: z.string().min(1),
  internal: z.boolean(),
});

export const networkInterfaceListSchema = z.object({
  items: z.array(networkInterfaceSchema),
});

export type NetworkInterfaceInfo = z.infer<typeof networkInterfaceSchema>;

const profileTextSchema = z.string().max(4_096);

export const portableEncodingSettingsSchema = z.object({
  videoCodec: z.enum(["H.264", "H.265", "MPEG-2 Video"]),
  profile: z.enum(["Main Profile", "High Profile", "Main 10"]),
  level: z.enum(["4.0", "4.1", "5.0", "5.1", "5.2"]),
  preset: z.number().min(0).max(100),
  width: z.number().int().min(16).max(16_384),
  height: z.number().int().min(16).max(16_384),
  dimensionsLocked: z.boolean(),
  frameRate: z.enum([
    "23.976 fps",
    "24.000 fps",
    "25.000 fps",
    "29.970 fps",
    "50.000 fps",
    "59.940 fps",
  ]),
  deinterlace: z.boolean(),
  fieldOrder: z.enum(["progressive", "upper", "lower"]),
  gopSize: z.number().int().min(1).max(600),
  bFrames: z.number().int().min(0).max(16),
  closedGop: z.boolean(),
  rateControl: z.enum(["CBR", "VBR", "CRF"]),
  targetBitrate: z.number().positive().max(1_000),
  maxBitrate: z.number().positive().max(1_000),
  bufferSize: z.number().int().positive().max(1_000_000_000),
  crf: z.number().min(0).max(51),
  audioCodec: z.enum(["AAC-LC", "MP2", "AC-3"]),
  sampleRate: z.enum(["44100 Hz", "48000 Hz", "96000 Hz"]),
  channels: z.enum(["Mono", "Stereo (L/R)", "5.1"]),
  audioBitrate: z.number().int().min(32).max(1_536),
  streamingEnabled: z.boolean(),
  protocol: z.enum(["SRT", "UDP", "RTMP", "RTMPS"]),
  serverUrl: profileTextSchema,
  latency: profileTextSchema,
  udpHost: profileTextSchema,
  udpPort: z.number().int().min(1).max(65_535),
  udpPacketSize: z.number().int().min(188).max(65_507),
  udpTtl: z.number().int().min(0).max(255),
  udpLocalAddress: profileTextSchema,
  udpServiceName: profileTextSchema,
  udpServiceId: z.number().int().min(1).max(65_535),
  udpProviderName: profileTextSchema,
  udpVideoPid: z.number().int().min(32).max(8_190),
  udpAudioPid: z.number().int().min(32).max(8_190),
  udpServiceType: profileTextSchema,
  udpPcrPeriodMs: z.number().int().min(1).max(1_000),
  udpTransportBitrate: z.number().min(0).max(1_000),
  srtHost: profileTextSchema,
  srtPort: z.number().int().min(1).max(65_535),
  srtMode: z.enum(["caller", "listener", "rendezvous"]),
  srtLatencyMs: z.number().int().min(20).max(60_000),
  srtStreamId: profileTextSchema,
  rtmpServerUrl: profileTextSchema,
  subtitleOutputMode: z.enum(["Burn-in", "DVB Subtitles"]).default("Burn-in"),
  subtitlePid: z.number().int().min(32).max(8_190).default(288),
  subtitleLanguage: z.string().regex(/^[A-Za-z]{3}$/).default("rus"),
  subtitleType: z.enum(["Normal", "Hearing impaired"]).default("Normal"),
  subtitleFontFamily: z.string().trim().min(1).max(128).default("Sans"),
  subtitleFontSize: z.number().int().min(12).max(160).default(48),
  subtitleBottomMargin: z.number().int().min(0).max(1_000).default(72),
  subtitleOutline: z.boolean().default(true),
  subtitleMaxColours: z.union([z.literal(4), z.literal(16), z.literal(256)]).default(16),
  subtitleBitrateKbps: z.number().int().min(32).max(2_000).default(128),
  subtitlePtsOffsetMs: z.number().int().min(0).max(10_000).default(1_400),
  ageTitleDurationSeconds: z.number().int().min(10).max(60).default(10),
  logoEnabled: z.boolean(),
  logoPath: profileTextSchema,
  logoPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]),
  logoWidthPercent: z.number().min(1).max(50),
  logoMargin: z.number().int().min(0).max(500),
  logoOpacity: z.number().min(0.05).max(1),
  repeatSchedule: z.boolean(),
  scte35PlanningEnabled: z.boolean(),
  scte35Command: z.enum([
    "time_signal + segmentation_descriptor",
    "splice_insert (legacy)",
  ]),
  scte35Owner: z.enum(["Provider", "Distributor"]),
  scte35Pid: z.number().int().min(32).max(8_190),
  scte35PreRollMs: z.number().int().min(0).max(60_000),
  scte35DefaultEventId: z.number().int().min(0).max(4_294_967_295),
  scte35DefaultBreakDuration: z.number().int().min(1).max(86_400),
  scte35UpidType: z.enum(["Ad-ID", "UUID", "URI", "None"]),
  scte35DefaultUpid: z.string().max(255),
  scte35LoopEventStrategy: z.enum([
    "Increment each loop",
    "Reuse playlist Event IDs",
  ]),
}).strict();

export const encodingSettingsFileSchema = z.object({
  format: z.literal("fluxio-encoding-settings"),
  formatVersion: z.literal(1),
  applicationVersion: z.string().min(1).max(64),
  exportedAt: z.iso.datetime(),
  secretsOmitted: z.array(z.enum([
    "streamKey",
    "srtPassphrase",
    "rtmpStreamKey",
  ])).max(3),
  settings: portableEncodingSettingsSchema,
}).strict();

export type PortableEncodingSettings = z.infer<typeof portableEncodingSettingsSchema>;
export type EncodingSettingsFile = z.infer<typeof encodingSettingsFileSchema>;

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

export const scheduleItemTypeSchema = z.enum(["movie", "chop", "clip"]);

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

export const ageTitleOverlaySchema = z.object({
  enabled: z.boolean().default(true),
  text: z.string().trim().min(1).max(32),
  durationSeconds: z.number().positive().max(60).default(5),
  filePath: z.string().min(1).nullable().optional(),
});

export const itemLogoOverlaySchema = logoOverlaySchema.extend({
  enabled: z.boolean().default(true),
});

export const graphicEffectKindSchema = z.enum(["static", "video"]);

export const lottiePropertyTypeSchema = z.enum([
  "boolean",
  "number",
  "vector",
  "color",
  "text",
]);

export const lottiePropertyValueSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string().max(4_096),
  z.array(z.number().finite()).min(2).max(4),
]);

export const lottieEditablePropertySchema = z.object({
  id: z.string().min(1).max(128),
  path: z.string().startsWith("/").max(1_024),
  group: z.string().min(1).max(256),
  label: z.string().min(1).max(256),
  type: lottiePropertyTypeSchema,
  value: lottiePropertyValueSchema,
  originalValue: lottiePropertyValueSchema.optional(),
  animated: z.boolean().default(false),
  overridden: z.boolean().default(false),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
});

export const lottieEffectMetadataSchema = z.object({
  sourcePath: z.string().min(1),
  version: z.string().max(64),
  frameRate: z.number().positive().max(240),
  inPoint: z.number().finite(),
  outPoint: z.number().finite(),
  backgroundColor: z.string().regex(/^(?:transparent|#[0-9a-fA-F]{6})$/),
  properties: z.array(lottieEditablePropertySchema).max(2_000),
  warnings: z.array(z.string().max(512)).max(100).default([]),
});

export const graphicEffectAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  filePath: z.string().min(1),
  kind: graphicEffectKindSchema,
  durationSeconds: z.number().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  titleDirectoryPath: z.string().min(1).nullable().default(null),
  titlePaths: z.array(z.string().min(1)).max(2_000).default([]),
  lottie: lottieEffectMetadataSchema.nullable().default(null),
});

export const graphicEffectLayerSchema = z.object({
  id: z.string().min(1),
  effectId: z.string().min(1),
  name: z.string().min(1),
  filePath: z.string().min(1),
  kind: graphicEffectKindSchema,
  sourceDurationSeconds: z.number().nonnegative(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  backgroundPath: z.string().min(1).nullable().optional(),
  titlePath: z.string().min(1).nullable().optional(),
}).refine((layer) => layer.endSeconds > layer.startSeconds, {
  message: "FX layer end must be after its start",
  path: ["endSeconds"],
});

export const subtitleOverlaySchema = z.object({
  enabled: z.boolean().default(false),
  filePath: z.string().min(1).nullable().default(null),
});

export const playoutItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  filePath: z.string().min(1),
  trimInSeconds: z.number().nonnegative().default(0),
  trimOutSeconds: z.number().positive().nullable().default(null),
  scte35Markers: z.array(scte35MarkerSchema).max(1_000).default([]),
  scheduleType: scheduleItemTypeSchema.nullable().optional(),
  declaredDurationSeconds: z.number().positive().nullable().optional(),
  ageTitle: ageTitleOverlaySchema.nullable().optional(),
  itemLogo: itemLogoOverlaySchema.nullable().optional(),
  effects: z.array(graphicEffectLayerSchema).max(64).optional(),
  subtitles: subtitleOverlaySchema.nullable().optional(),
});

export const analyzeGraphicEffectsRequestSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(200),
});

export const scanGraphicEffectsRequestSchema = z.object({
  directoryPath: z.string().min(1),
});

export const graphicEffectAssetListSchema = z.object({
  items: z.array(graphicEffectAssetSchema).max(200),
});

export const renderLottieEffectRequestSchema = z.object({
  effect: graphicEffectAssetSchema.refine((effect) => Boolean(effect.lottie), {
    message: "A Lottie effect is required",
    path: ["lottie"],
  }),
});

export const lottieSourceRequestSchema = z.object({
  sourcePath: z.string().min(1),
});

export const parseScheduleRequestSchema = z.object({
  filePath: z.string().min(1),
});

export const scheduleGraphicElementSchema = z.object({
  name: z.string().trim().min(1).max(128),
  backgroundPath: z.string().min(1).nullable(),
  titlePath: z.string().min(1).nullable(),
  durationSeconds: z.number().positive(),
  startOnSeconds: z.number().nonnegative(),
}).refine((element) => Boolean(element.backgroundPath || element.titlePath), {
  message: "Graphic element requires backgroundPath or titlePath",
  path: ["backgroundPath"],
});

export const parsedScheduleItemSchema = z.object({
  type: scheduleItemTypeSchema,
  declaredDurationSeconds: z.number().positive(),
  declaredDuration: z.string().min(1),
  filePath: z.string().min(1),
  ageTitle: z.string().nullable(),
  ageTitleDurationSeconds: z.number().int().min(10).max(60).nullable(),
  logoPath: z.string().nullable(),
  graphicElements: z.array(scheduleGraphicElementSchema).max(64).default([]),
  srtPath: z.string().nullable().default(null),
  lineNumber: z.number().int().positive(),
  warnings: z.array(z.string()),
});

export const parsedScheduleSchema = z.object({
  sourceFilePath: z.string().min(1),
  encoding: z.enum(["utf-8", "windows-1251"]),
  startTime: z.string().regex(/^\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/),
  startSeconds: z.number().nonnegative().max(86_400),
  delaySeconds: z.number().nonnegative(),
  targetDurationSeconds: z.literal(604_800),
  totalDurationSeconds: z.number().nonnegative(),
  varianceSeconds: z.number(),
  items: z.array(parsedScheduleItemSchema).min(1),
  warnings: z.array(z.string()),
});

export const scheduleExportExtensionSchema = z.enum(["air", "txt"]);

export const scheduleExportItemSchema = z.object({
  type: scheduleItemTypeSchema,
  declaredDurationSeconds: z.number().positive(),
  filePath: z.string().min(1).refine((value) => !/[\r\n]/.test(value), {
    message: "Media path must not contain line breaks",
  }),
  ageTitle: z.object({
    enabled: z.boolean(),
    text: z.string().trim().min(1).max(32).refine((value) => !/[\r\n{}]/.test(value), {
      message: "AGE title must not contain braces or line breaks",
    }),
    durationSeconds: z.number().int().min(10).max(60).default(10),
  }).nullable().optional(),
  logoPath: z.string().min(1).refine((value) => !/[\r\n{}]/.test(value), {
    message: "Logo path must not contain braces or line breaks",
  }).nullable().optional(),
  graphicElements: z.array(scheduleGraphicElementSchema).max(64).default([]),
  srtPath: z.string().min(1).refine((value) => !/[\r\n{}]/.test(value), {
    message: "SRT path must not contain braces or line breaks",
  }).nullable().optional(),
});

export const serializeScheduleRequestSchema = z.object({
  extension: scheduleExportExtensionSchema,
  startTime: z.string().regex(/^\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/),
  delaySeconds: z.number().nonnegative(),
  items: z.array(scheduleExportItemSchema).min(1),
});

export const serializedScheduleSchema = z.object({
  extension: scheduleExportExtensionSchema,
  content: z.string().min(1),
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
  fieldOrder: z.enum(["upper", "lower", "progressive"]).default("progressive"),
  gopSize: z.number().int().min(1).max(600).default(50),
  bFrames: z.number().int().min(0).max(16).default(0),
  closedGop: z.boolean().default(true),
}).superRefine((video, context) => {
  if (video.bFrames >= video.gopSize) {
    context.addIssue({
      code: "custom",
      message: "B-frame count must be smaller than GOP length",
      path: ["bFrames"],
    });
  }
  if (video.codec === "mpeg2" && video.bFrames > 2) {
    context.addIssue({
      code: "custom",
      message: "MPEG-2 supports at most 2 consecutive B-frames",
      path: ["bFrames"],
    });
  }
  if (video.profile.toLowerCase().includes("baseline") && video.bFrames > 0) {
    context.addIssue({
      code: "custom",
      message: "H.264 Baseline profile does not support B-frames",
      path: ["bFrames"],
    });
  }
});

export const audioEncodingSchema = z.object({
  codec: z.enum(["aac", "mp2", "ac3"]),
  sampleRate: z.number().int().min(8_000).max(192_000),
  channels: z.union([z.literal(1), z.literal(2), z.literal(6)]),
  bitrateKbps: z.number().int().min(32).max(640),
});

export const mpegTsServiceTypes = [
  "digital_tv",
  "digital_radio",
  "teletext",
  "advanced_codec_digital_radio",
  "mpeg2_digital_hdtv",
  "advanced_codec_digital_sdtv",
  "advanced_codec_digital_hdtv",
  "hevc_digital_hdtv",
] as const;

export const defaultMpegTsOutputSettings = {
  serviceName: "FluxIO",
  serviceId: 1,
  providerName: "FluxIO",
  videoPid: 256,
  audioPid: 257,
  serviceType: "digital_tv" as const,
  pcrPeriodMs: 20,
  transportBitrateKbps: 0,
};

export const mpegTsOutputSettingsSchema = z.object({
  serviceName: z.string().trim().min(1).max(64).default("FluxIO"),
  serviceId: z.number().int().min(1).max(65_535).default(1),
  providerName: z.string().trim().min(1).max(64).default("FluxIO"),
  videoPid: z.number().int().min(32).max(8_190).default(256),
  audioPid: z.number().int().min(32).max(8_190).default(257),
  serviceType: z.enum(mpegTsServiceTypes).default("digital_tv"),
  pcrPeriodMs: z.number().int().min(1).max(1_000).default(20),
  transportBitrateKbps: z.number().int().min(0).max(500_000).default(0),
}).refine((settings) => settings.videoPid !== settings.audioPid, {
  message: "Video PID and audio PID must be different",
  path: ["audioPid"],
});

export const udpEndpointSchema = z.object({
  protocol: z.literal("udp"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  packetSize: z.number().int().min(188).max(65_507).default(1316),
  ttl: z.number().int().min(1).max(255).default(16),
  localAddress: z.string().default(""),
  mpegTs: mpegTsOutputSettingsSchema.default(defaultMpegTsOutputSettings),
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

export const subtitleOutputSchema = z.object({
  mode: z.enum(["burn-in", "dvb"]).default("burn-in"),
  pid: z.number().int().min(32).max(8_190).default(288),
  language: z.string().regex(/^[A-Za-z]{3}$/).transform((value) => value.toLowerCase()).default("rus"),
  type: z.enum(["normal", "hearing-impaired"]).default("normal"),
  fontFamily: z.string().trim().min(1).max(128).default("Sans"),
  fontSize: z.number().int().min(12).max(160).default(48),
  bottomMargin: z.number().int().min(0).max(1_000).default(72),
  outline: z.boolean().default(true),
  maxColours: z.union([z.literal(4), z.literal(16), z.literal(256)]).default(16),
  bitrateKbps: z.number().int().min(32).max(2_000).default(128),
  ptsOffsetMs: z.number().int().min(0).max(10_000).default(1_400),
});

export const defaultSubtitleOutput = {
  mode: "burn-in" as const,
  pid: 288,
  language: "rus",
  type: "normal" as const,
  fontFamily: "Sans",
  fontSize: 48,
  bottomMargin: 72,
  outline: true,
  maxColours: 16 as const,
  bitrateKbps: 128,
  ptsOffsetMs: 1_400,
};

export const startPlayoutRequestSchema = z.object({
  playlist: z.array(playoutItemSchema).min(1).max(500),
  video: videoEncodingSchema,
  audio: audioEncodingSchema,
  logo: logoOverlaySchema.nullable().default(null),
  endpoint: playoutEndpointSchema,
  subtitleOutput: subtitleOutputSchema.default(defaultSubtitleOutput),
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
}).superRefine((request, context) => {
  if (request.subtitleOutput.mode === "dvb" && request.endpoint.protocol === "rtmp") {
    context.addIssue({
      code: "custom",
      message: "DVB subtitles require an MPEG-TS UDP or SRT output",
      path: ["subtitleOutput", "mode"],
    });
  }

  if (request.subtitleOutput.mode !== "dvb") return;
  const mpegTs = request.endpoint.protocol === "udp"
    ? request.endpoint.mpegTs
    : defaultMpegTsOutputSettings;
  const reservedPids = [mpegTs.videoPid, mpegTs.audioPid];
  if (request.scte35.enabled) reservedPids.push(request.scte35.pid);
  if (reservedPids.includes(request.subtitleOutput.pid)) {
    context.addIssue({
      code: "custom",
      message: "Subtitle PID must differ from video, audio and SCTE-35 PIDs",
      path: ["subtitleOutput", "pid"],
    });
  }
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

export const dvbSubtitleStatusSchema = z.object({
  enabled: z.boolean().default(false),
  state: z.enum(["disabled", "starting", "running", "completed", "failed"]).default("disabled"),
  pid: z.number().int().min(32).max(8_190).nullable().default(null),
  language: z.string().length(3).nullable().default(null),
  plannedCues: z.number().int().nonnegative().default(0),
  sourceItems: z.number().int().nonnegative().default(0),
  error: z.string().nullable().default(null),
});

export const playoutStatusSchema = z.object({
  state: playoutStateSchema,
  sessionId: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  stoppedAt: z.iso.datetime().nullable(),
  currentItemIndex: z.number().int().nonnegative(),
  currentItemId: z.string().nullable().default(null),
  currentItemName: z.string().nullable(),
  currentItemElapsedSeconds: z.number().nonnegative().default(0),
  currentItemProgressPercent: z.number().min(0).max(100).default(0),
  totalItems: z.number().int().nonnegative(),
  outTimeSeconds: z.number().nonnegative(),
  totalDurationSeconds: z.number().nonnegative(),
  progressPercent: z.number().min(0).max(100),
  frame: z.number().int().nonnegative(),
  fps: z.number().nonnegative(),
  bitrateKbps: z.number().nonnegative(),
  transportBitrateBps: z.number().int().nonnegative().nullable().default(null),
  transportBitrateMode: z.enum(["auto", "manual"]).nullable().default(null),
  continuityErrors: z.number().int().nonnegative().default(0),
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
  subtitles: dvbSubtitleStatusSchema.default({
    enabled: false,
    state: "disabled",
    pid: null,
    language: null,
    plannedCues: 0,
    sourceItems: 0,
    error: null,
  }),
  error: z.string().nullable(),
  logs: z.array(z.string()),
});

export const workspaceSessionAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  duration: z.string(),
  durationSeconds: z.number().nonnegative(),
  codec: z.string(),
  codecFamily: z.string(),
  codecProfile: z.string(),
  resolution: z.string(),
  fps: z.string(),
  bitrate: z.string(),
  size: z.string(),
  status: z.enum(["analyzed", "pending", "error", "queued"]),
  progress: z.number().min(0).max(100).optional(),
  preview: z.string().min(1),
  filePath: z.string().min(1),
  colorSpace: z.string(),
  audio: z.string(),
  sha256: z.string(),
  scte35Markers: z.array(scte35MarkerSchema).max(1_000).optional(),
  scheduleType: scheduleItemTypeSchema.optional(),
  declaredDurationSeconds: z.number().positive().optional(),
  scheduleLineNumber: z.number().int().positive().optional(),
  ageTitle: ageTitleOverlaySchema.optional(),
  itemLogo: itemLogoOverlaySchema.optional(),
  effects: z.array(graphicEffectLayerSchema).max(64).optional(),
  subtitles: subtitleOverlaySchema.optional(),
});

export const workspaceScheduleMetadataSchema = z.object({
  sourceFilePath: z.string(),
  sourceName: z.string(),
  encoding: z.enum(["utf-8", "windows-1251"]),
  startTime: z.string().regex(/^\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  delaySeconds: z.number().nonnegative(),
  targetDurationSeconds: z.number().positive(),
  warnings: z.array(z.string()),
});

export const workspaceOverlayLibrarySchema = z.object({
  directoryPath: z.string().min(1),
  imagePaths: z.array(z.string().min(1)).max(100),
});

export const workspaceSubtitleLibrarySchema = z.object({
  directoryPath: z.string().min(1),
  filePaths: z.array(z.string().min(1)).max(1_000),
});

export const scheduleStartMarkerSchema = z.object({
  assetId: z.string().min(1),
  updatedAt: z.iso.datetime(),
});

const workspaceSettingValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

export const workspaceSessionSnapshotSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  assets: z.array(workspaceSessionAssetSchema).max(1_000),
  currentPlaylist: z.array(workspaceSessionAssetSchema).max(500),
  futurePlaylist: z.array(workspaceSessionAssetSchema).max(500),
  activeSchedule: z.enum(["current", "future"]),
  selectedAssetId: z.string().min(1).nullable(),
  currentScheduleMetadata: workspaceScheduleMetadataSchema.nullable(),
  futureScheduleMetadata: workspaceScheduleMetadataSchema.nullable(),
  scheduleLogoPath: z.string(),
  scheduleLogoSource: z.string(),
  ageLibrary: workspaceOverlayLibrarySchema.nullable(),
  effectLibrary: z.array(graphicEffectAssetSchema).max(200).default([]),
  subtitleLibrary: workspaceSubtitleLibrarySchema.nullable().default(null),
  startMarker: scheduleStartMarkerSchema.nullable().default(null),
  settings: z.record(z.string(), workspaceSettingValueSchema),
});

export const workspaceSessionCheckpointSchema = z.object({
  sessionId: z.string().nullable(),
  state: playoutStateSchema,
  currentItemIndex: z.number().int().nonnegative(),
  currentItemId: z.string().nullable().default(null),
  currentItemName: z.string().nullable(),
  currentItemElapsedSeconds: z.number().nonnegative().default(0),
  outTimeSeconds: z.number().nonnegative(),
  totalDurationSeconds: z.number().nonnegative(),
  progressPercent: z.number().min(0).max(100),
  loopCount: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
  interrupted: z.boolean().default(false),
});

export const workspaceSessionSaveRequestSchema = z.object({
  snapshot: workspaceSessionSnapshotSchema,
});

export const savedWorkspaceSessionSchema = z.object({
  id: z.string().uuid(),
  snapshot: workspaceSessionSnapshotSchema,
  checkpoint: workspaceSessionCheckpointSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const workspaceSessionEnvelopeSchema = z.object({
  session: savedWorkspaceSessionSchema.nullable(),
});

export const saveBroadcastConfigurationRequestSchema = startPlayoutRequestSchema.safeExtend({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
});

export const savedBroadcastConfigurationSchema =
  saveBroadcastConfigurationRequestSchema.safeExtend({
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
export type ScheduleItemType = z.infer<typeof scheduleItemTypeSchema>;
export type AgeTitleOverlay = z.infer<typeof ageTitleOverlaySchema>;
export type ItemLogoOverlay = z.infer<typeof itemLogoOverlaySchema>;
export type GraphicEffectAsset = z.infer<typeof graphicEffectAssetSchema>;
export type GraphicEffectLayer = z.infer<typeof graphicEffectLayerSchema>;
export type LottieEditableProperty = z.infer<typeof lottieEditablePropertySchema>;
export type LottieEffectMetadata = z.infer<typeof lottieEffectMetadataSchema>;
export type SubtitleOverlay = z.infer<typeof subtitleOverlaySchema>;
export type ScheduleGraphicElement = z.infer<typeof scheduleGraphicElementSchema>;
export type ParsedScheduleItem = z.infer<typeof parsedScheduleItemSchema>;
export type ParsedSchedule = z.infer<typeof parsedScheduleSchema>;
export type ScheduleExportExtension = z.infer<typeof scheduleExportExtensionSchema>;
export type SerializeScheduleRequest = z.infer<typeof serializeScheduleRequestSchema>;
export type SerializedSchedule = z.infer<typeof serializedScheduleSchema>;
export type PlayoutItem = z.infer<typeof playoutItemSchema>;
export type VideoEncoding = z.infer<typeof videoEncodingSchema>;
export type AudioEncoding = z.infer<typeof audioEncodingSchema>;
export type LogoOverlay = z.infer<typeof logoOverlaySchema>;
export type MpegTsOutputSettings = z.infer<typeof mpegTsOutputSettingsSchema>;
export type PlayoutEndpoint = z.infer<typeof playoutEndpointSchema>;
export type Scte35Planning = z.infer<typeof scte35PlanningSchema>;
export type Scte35InjectorStatus = z.infer<typeof scte35InjectorStatusSchema>;
export type SubtitleOutput = z.infer<typeof subtitleOutputSchema>;
export type DvbSubtitleStatus = z.infer<typeof dvbSubtitleStatusSchema>;
export type StartPlayoutRequest = z.infer<typeof startPlayoutRequestSchema>;
export type PlayoutStatus = z.infer<typeof playoutStatusSchema>;
export type WorkspaceSessionAsset = z.infer<typeof workspaceSessionAssetSchema>;
export type WorkspaceSessionSnapshot = z.infer<typeof workspaceSessionSnapshotSchema>;
export type ScheduleStartMarker = z.infer<typeof scheduleStartMarkerSchema>;
export type WorkspaceSessionCheckpoint = z.infer<typeof workspaceSessionCheckpointSchema>;
export type WorkspaceSessionSaveRequest = z.infer<typeof workspaceSessionSaveRequestSchema>;
export type SavedWorkspaceSession = z.infer<typeof savedWorkspaceSessionSchema>;
export type SaveBroadcastConfigurationRequest = z.infer<
  typeof saveBroadcastConfigurationRequestSchema
>;
export type SavedBroadcastConfiguration = z.infer<
  typeof savedBroadcastConfigurationSchema
>;
export type BroadcastConfigurationSummary = z.infer<
  typeof broadcastConfigurationSummarySchema
>;
