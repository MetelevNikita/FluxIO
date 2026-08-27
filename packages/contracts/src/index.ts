import { z } from "zod";
import { sceneTemplateSchema } from "./scene.js";

export * from "./scene.js";
export * from "./scene-timing.js";
export * from "./title-file.js";
export * from "./title-presets.js";
export * from "./title-presets-export.js";


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

/**
 * Каким ускорителем кодировать. `off` — программный кодировщик, `auto` —
 * первый доступный из тех, что умеет выбранный кодек.
 *
 * Это не оптимизация: на 2160 программный `libx264` не укладывается в реальное
 * время на разумном железе, и без ускорителя UHD-профиль недостижим.
 */
export const videoHardwareSchema = z.enum([
  "off",
  "auto",
  "nvenc",
  "qsv",
  "vaapi",
  "videotoolbox",
  "amf",
]);

export const portableEncodingSettingsSchema = z.object({
  videoCodec: z.enum(["H.264", "H.265", "MPEG-2 Video"]),
  /**
   * Ускоритель кодирования. Едет в профиле намеренно: он описывает задуманное
   * кодирование, а не машину. Если на целевой машине такого ускорителя нет,
   * preflight откажет внятно — это лучше тихого отката на программный, при
   * котором оператор считал бы, что кодирует UHD аппаратно.
   */
  videoHardware: videoHardwareSchema.default("off"),
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
  loudnessNormalizationEnabled: z.boolean().default(false),
  loudnessTargetLufs: z.number().min(-70).max(-5).default(-23),
  audioTracksEnabled: z.boolean().default(false),
  audioTrackDirectory: profileTextSchema.default(""),
  audioOriginalLanguage: z.string().regex(/^[a-z]{3}$/).default("rus"),
  audioOriginalLabel: z.string().trim().min(1).max(32).default("orig"),
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
  subtitlePtsOffsetMs: z.number().int().min(0).max(10_000).default(0),
  ageTitleDurationSeconds: z.number().int().min(10).max(60).default(10),
  logoEnabled: z.boolean(),
  logoPath: profileTextSchema,
  /** Анимированный логотип: старые профили его не знают, поэтому со значением. */
  logoLoop: z.boolean().default(true),
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
  paths: z.array(z.string().min(1)).min(1).max(1_000),
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
    // фильтр subtitles есть только в сборках FFmpeg с libass
    burnInSubtitles: z.boolean().default(false),
    // фильтр drawtext есть только в сборках с libfreetype; без него не работают
    // бегущая строка, экранные часы и обратный отсчёт
    dynamicText: z.boolean().default(false),
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
  /**
   * Анимированный логотип (mov, webm, gif): повторять до
   * конца ролика или проиграть один раз и остаться последним кадром. У
   * неподвижной картинки значения не имеет.
   */
  loop: z.boolean().default(true),
}).refine((logo) => !logo.filePath.toLowerCase().endsWith(".json"), {
  // Логотип обязан быть готовым файлом, а не проектом: в
  // запросе должен оказаться уже он. Иначе эфир падал бы на «Invalid data».
  message: "A logo must be a rendered file before it goes on air",
  path: ["filePath"],
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

/* ------------------------------------------------------------------------- *
 * Эфирные эффекты второго уровня.
 *
 * Уровень 1 — служебная графика ролика (логотип, возрастная плашка).
 * Уровень 2 — параметрические эфирные эффекты этого блока: у каждого есть своё
 *   поведение и набор настроек, а сцена или alpha-медиа для них лишь оформление.
 * Оформление принадлежит эффекту и отдельным элементом библиотеки не является.
 *
 * Эффект второго уровня не рисуется напрямую: перед стартом он *разрешается*
 * в обычные слои (`graphicEffectLayerSchema`), показы сцен
 * (`playoutSceneShowSchema`) и звуковые вставки (`clipAudioOverlaySchema`),
 * поэтому эфирный контур ничего не знает про уровни.
 * ------------------------------------------------------------------------- */

/** Выключка надписи. */
export const textAlignSchema = z.enum(["left", "center", "right"]);

export const broadcastEffectKindSchema = z.enum([
  "animation-in-out",
  "dynamic-title",
  "next-program",
  "ticker-crawl",
  "clock-countdown",
  "stinger-transition",
]);

export const animationInOutModeSchema = z.enum(["in", "out", "in-out"]);
export const tickerDirectionSchema = z.enum(["left", "right"]);
export const tickerSourceSchema = z.enum(["manual", "file", "feed"]);
export const clockModeSchema = z.enum(["clock", "countdown"]);
/**
 * Откуда берётся длительность отсчёта: заданное число секунд или остаток
 * хронометража того ролика, на котором эффект запущен.
 */
export const countdownSourceSchema = z.enum(["fixed", "clip-remaining"]);
export const clockFormatSchema = z.enum(["HH:MM:SS", "HH:MM", "MM:SS", "SS"]);
export const nextProgramSourceSchema = z.enum(["playlist-name", "task-file"]);
/** `alpha` — у файла есть альфа-канал; `luma` — чёрный фон вырезается lumakey. */
export const stingerBlendModeSchema = z.enum(["alpha", "luma"]);

/** Оформление текста, который рисует drawtext (бегущая строка, часы, отсчёт). */
export const broadcastTextStyleSchema = z.object({
  fontFilePath: z.string().min(1).nullable().default(null),
  fontFamily: z.string().max(256).default(""),
  /** Как `xPercent` относится к надписи: её левый край, центр или правый край. */
  align: textAlignSchema.default("left"),
  /** Кегль в процентах от высоты кадра, чтобы SD/FHD/UHD выглядели одинаково. */
  fontSizePercent: z.number().positive().max(40).default(4.2),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#FFFFFF"),
  boxEnabled: z.boolean().default(true),
  boxColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
  boxOpacity: z.number().min(0).max(1).default(0.62),
  boxPaddingPercent: z.number().min(0).max(10).default(0.9),
  /**
   * Позиция базовой линии в процентах кадра. Запас за пределами 0..100 нужен,
   * чтобы надпись могла выйти за край вместе со сдвинутым FX-слоем.
   */
  xPercent: z.number().min(-100).max(200).default(4),
  yPercent: z.number().min(-100).max(200).default(86),
});

/**
 * Звуковая вставка поверх дорожек ролика (сейчас — звук стингера). Подмешивается
 * во все языковые дорожки одинаково: программа одна, и дорожки обязаны совпадать
 * по длине и содержанию служебных звуков.
 */
export const clipAudioOverlaySchema = z.object({
  id: z.string().min(1),
  effectId: z.string().min(1),
  filePath: z.string().min(1),
  /** С какой секунды исходного файла берём вставку. */
  sourceInSeconds: z.number().nonnegative().default(0),
  /** Куда её ставим внутри ролика. */
  startSeconds: z.number().nonnegative().default(0),
  durationSeconds: z.number().positive().max(60),
  gainDb: z.number().min(-60).max(12).default(0),
});

export const animationInOutSettingsSchema = z.object({
  mode: animationInOutModeSchema.default("in"),
  /** Момент запуска входной анимации от начала ролика. */
  startSeconds: z.number().nonnegative().max(86_400).default(0),
  /** Момент завершения выходной анимации, отсчитывается от конца ролика. */
  endSeconds: z.number().nonnegative().max(86_400).default(0),
  durationSeconds: z.number().positive().max(60).default(5),
  taskFilePath: z.string().min(1).nullable().default(null),
});

export const dynamicTitleSettingsSchema = z.object({
  /** Вручную заданная строка или значение из записи файла задания для ролика. */
  source: z.enum(["manual", "task-file"]).default("manual"),
  /** Текст надписи; для файла задания служит резервным значением. */
  text: z.string().max(2_000).default(""),
  /** Ключ значения в записи файла задания, сопоставленной с роликом по `name`. */
  taskKey: z.string().min(1).max(128).default("text"),
  taskFilePath: z.string().min(1).nullable().default(null),
  startSeconds: z.number().nonnegative().max(86_400).default(0),
  durationSeconds: z.number().positive().max(86_400).default(5),
  /** Постоянная подпись рядом с основной строкой. */
  captionKey: z.string().max(128).default(""),
  captionText: z.string().max(512).default(""),
  /** Text Layer пресета, который очищается и заменяется живым drawtext. */
  dynamicKey: z.string().max(128).default(""),
  style: broadcastTextStyleSchema.default(() => broadcastTextStyleSchema.parse({})),
});

export const nextProgramSettingsSchema = z.object({
  /** За сколько секунд до конца ролика показать плашку. */
  startOffsetSeconds: z.number().positive().max(3_600).default(30),
  durationSeconds: z.number().positive().max(60).default(7),
  source: nextProgramSourceSchema.default("playlist-name"),
  /** Text Layer, который очищается и заменяется живым названием через drawtext. */
  titleKey: z.string().min(1).max(128).default("next_title"),
  /** Необязательная постоянная подпись. */
  subtitleKey: z.string().min(1).max(128).default("next_subtitle"),
  subtitleText: z.string().max(512).default(""),
  /** Текст на случай, когда следующего элемента нет; пустой — эффект пропускается. */
  fallbackTitle: z.string().max(512).default(""),
  taskFilePath: z.string().min(1).nullable().default(null),
  style: broadcastTextStyleSchema.default(() => broadcastTextStyleSchema.parse({})),
});

export const tickerCrawlSettingsSchema = z.object({
  source: tickerSourceSchema.default("manual"),
  items: z.array(z.string().max(2_000)).max(200).default([]),
  filePath: z.string().min(1).nullable().default(null),
  /** Адрес RSS/Atom-ленты, откуда берутся заголовки. */
  feedUrl: z.string().max(2_048).default(""),
  separator: z.string().max(32).default("   •   "),
  speedPixelsPerSecond: z.number().positive().max(4_000).default(120),
  direction: tickerDirectionSchema.default("left"),
  repeat: z.number().int().nonnegative().max(999).default(0),
  startSeconds: z.number().nonnegative().max(86_400).default(0),
  durationSeconds: z.number().positive().max(86_400).default(60),
  /** Полоса строки в процентах ширины кадра; по умолчанию — весь кадр. */
  regionXPercent: z.number().min(0).max(100).default(0),
  regionWidthPercent: z.number().positive().max(100).default(100),
  /** Ключ текстового поля пресета, куда подставляется постоянная подпись. */
  captionKey: z.string().max(128).default(""),
  captionText: z.string().max(512).default(""),
  /**
   * Текстовое поле пресета, на место которого встаёт живое значение эффекта.
   * Поле шаблона при этом очищается: значение меняется покадрово и в
   * оформление, отрисованное один раз, не запекается.
   */
  dynamicKey: z.string().max(128).default(""),
  style: broadcastTextStyleSchema.default(() => broadcastTextStyleSchema.parse({})),
});

export const clockCountdownSettingsSchema = z.object({
  mode: clockModeSchema.default("clock"),
  format: clockFormatSchema.default("HH:MM:SS"),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).default(0),
  countdownSource: countdownSourceSchema.default("fixed"),
  /** countdown + fixed: длительность отсчёта в секундах. */
  countdownSeconds: z.number().positive().max(86_400).default(60),
  startSeconds: z.number().nonnegative().max(86_400).default(0),
  durationSeconds: z.number().positive().max(86_400).default(60),
  captionKey: z.string().max(128).default(""),
  captionText: z.string().max(512).default(""),
  dynamicKey: z.string().max(128).default(""),
  style: broadcastTextStyleSchema.default(() => broadcastTextStyleSchema.parse({})),
});

/**
 * Чем задан переход: одним видеофайлом или последовательностью кадров.
 *
 * У последовательности нет ни собственной частоты кадров, ни звука, поэтому
 * форма настроек у неё другая — отсюда явный признак, а не догадка по пути.
 */
export const stingerSourceKindSchema = z.enum(["file", "sequence"]);

export const stingerTransitionSettingsSchema = z.object({
  /** Для `sequence` здесь лежит printf-шаблон, а не путь к одному файлу. */
  assetPath: z.string().min(1).nullable().default(null),
  sourceKind: stingerSourceKindSchema.default("file"),
  /** Номер первого кадра последовательности. */
  sequenceStartNumber: z.number().int().nonnegative().max(1_000_000).nullable().default(null),
  sequenceFrameCount: z.number().int().positive().max(10_000).nullable().default(null),
  sourceFrameRate: z.number().positive().max(240).nullable().default(null),
  sourcePixelFormat: z.string().max(64).nullable().default(null),
  sourceHasAlpha: z.boolean().nullable().default(null),
  sourceHasAudio: z.boolean().nullable().default(null),
  durationSeconds: z.number().positive().max(30).default(1),
  /**
   * Момент внутри перехода, в котором графика полностью закрывает кадр. Ровно
   * здесь рвётся стык роликов: кадры [0, cutPoint) ложатся на хвост предыдущего
   * ролика, кадры [cutPoint, duration) — на голову следующего.
   */
  cutPointSeconds: z.number().nonnegative().max(30).default(0.5),
  blendMode: stingerBlendModeSchema.default("alpha"),
  /** Порог яркости для `luma`: всё темнее считается фоном. */
  lumaThreshold: z.number().min(0).max(1).default(0.08),
  audioEnabled: z.boolean().default(false),
  audioLevelDb: z.number().min(-60).max(12).default(-6),
}).refine((settings) => settings.cutPointSeconds < settings.durationSeconds, {
  message: "Stinger cut point must be inside its duration",
  path: ["cutPointSeconds"],
}).refine(
  // Частота кадров в самих .png не записана: без неё длительность перехода
  // не определена, и FFmpeg взял бы своё умолчание в 25 fps.
  (settings) => settings.sourceKind !== "sequence" || settings.sourceFrameRate != null,
  {
    message: "Для последовательности .png нужно задать частоту кадров",
    path: ["sourceFrameRate"],
  },
).refine(
  // Звука в последовательности нет физически. Молча выключать нельзя: оператор
  // считал бы, что переход звучит.
  (settings) => settings.sourceKind !== "sequence" || !settings.audioEnabled,
  {
    message: "У последовательности .png нет звуковой дорожки",
    path: ["audioEnabled"],
  },
);

export const broadcastEffectSettingsSchema = z.object({
  animationInOut: animationInOutSettingsSchema.default(() => animationInOutSettingsSchema.parse({})),
  dynamicTitle: dynamicTitleSettingsSchema.default(() => dynamicTitleSettingsSchema.parse({})),
  nextProgram: nextProgramSettingsSchema.default(() => nextProgramSettingsSchema.parse({})),
  tickerCrawl: tickerCrawlSettingsSchema.default(() => tickerCrawlSettingsSchema.parse({})),
  clockCountdown: clockCountdownSettingsSchema.default(() => clockCountdownSettingsSchema.parse({})),
  stingerTransition: stingerTransitionSettingsSchema.default(
    () => stingerTransitionSettingsSchema.parse({}),
  ),
});

/** Описание эффекта второго уровня. */
/**
 * Сдвиг графики эффекта относительно того места, куда её поставил дизайнер.
 *
 * У готового alpha-медиа положение задано внутри файла, и подвинуть его там
 * нельзя — а поправить в эфире надо. Сдвиг считается в процентах кадра, поэтому
 * одна и та же настройка одинаково ложится на SD, FHD и UHD. Ноль — «как в файле».
 */
export const effectPlacementSchema = z.object({
  offsetXPercent: z.number().min(-100).max(100).default(0),
  offsetYPercent: z.number().min(-100).max(100).default(0),
});

/**
 * Явная связь поля входного JSON с редактируемым текстовым полем шаблона.
 * Имена не обязаны совпадать: например, `program.title` можно направить в
 * Text Layer `next_title` без переделки выгрузки или проекта After Effects.
 */
export const broadcastDataBindingSchema = z.object({
  sourceKey: z.string().trim().min(1).max(256),
  targetKey: z.string().trim().min(1).max(128),
});

export const broadcastDataMappingSchema = z.object({
  filePath: z.string().min(1).nullable().default(null),
  /** Поле JSON, по которому запись находится для конкретного ролика. */
  matchSourceKey: z.string().trim().min(1).max(256).default("name"),
  bindings: z.array(broadcastDataBindingSchema).max(128).default([]),
});

/**
 * Чем оформлен эффект.
 *
 * `file` — загруженный шаблон или alpha-медиа: оформление рисует он, а живое
 * значение ложится поверх штатной надписью. `plate` — прямоугольник, который
 * эффект рисует сам: цвет, прозрачность и отступ лежат в стиле надписи.
 *
 * У Animation in/out и Stinger выбора нет — без файла этих эффектов просто не
 * существует, поэтому им оформление всегда `file` (см. `fileOnlyEffectKinds`).
 */
export const effectDecorationSchema = z.enum(["file", "plate"]);

export const broadcastEffectDefinitionSchema = z.object({
  kind: broadcastEffectKindSchema,
  /** Файл оформления: alpha-медиа у Animation in/out и Stinger. */
  decorationFilePath: z.string().min(1).nullable().default(null),
  /** Отсутствует у сессий до v8.0.0 — восстанавливается ниже по `presetEffectId`. */
  decoration: effectDecorationSchema.optional(),
  /**
   * Сцена, которой оформлен эффект. Заменяет связку «запечённый шаблон плюс
   * отдельная живая надпись»: текст стал узлом сцены, поэтому появиться раньше
   * своей плашки он не может.
   */
  scene: sceneTemplateSchema.nullable().default(null),
  settings: broadcastEffectSettingsSchema.default(() => broadcastEffectSettingsSchema.parse({})),
  placement: effectPlacementSchema.default(() => effectPlacementSchema.parse({})),
  dataMapping: broadcastDataMappingSchema.default(() => broadcastDataMappingSchema.parse({})),
}).transform((definition) => ({
  ...definition,
  // Сессии, записанные до появления поля, о выборе оформления не знают. Если
  // графика эффекту назначена — значит он оформлен ею, и простой `default`
  // молча погасил бы плашку, которая уже выходит в эфир.
  decoration: definition.decoration
    ?? (definition.decorationFilePath ? ("file" as const) : ("plate" as const)),
}));

/** Одна сырая запись допускает произвольную структуру; сервер распрямит её в dotted keys. */
export const broadcastTaskEntrySchema = z.record(z.string(), z.unknown());

/** 4 MiB JSON достаточно для крупных суточных/архивных выгрузок до 10 000 строк. */
export const maximumBroadcastTaskRecords = 10_000;

/** Файл задания принимает и один объект, и массив объектов на всю сетку. */
export const broadcastTaskFileSchema = z.union([
  broadcastTaskEntrySchema,
  z.array(broadcastTaskEntrySchema).min(1).max(maximumBroadcastTaskRecords),
]).transform((value) => (Array.isArray(value) ? value : [value]));

export const readBroadcastTaskRequestSchema = z.object({
  filePath: z.string().min(1),
});

export const broadcastTaskFileContentSchema = z.object({
  filePath: z.string().min(1),
  /** Сырые нормализованные строки, из которых UI строит пользовательский mapping. */
  records: z.array(z.record(z.string(), z.string())).min(1).max(maximumBroadcastTaskRecords),
  fields: z.array(z.object({
    key: z.string().min(1).max(256),
    populatedCount: z.number().int().nonnegative().max(maximumBroadcastTaskRecords),
    samples: z.array(z.string().max(512)).max(3),
  })).max(512),
  /** Совместимое представление для старых файлов, где идентификатор называется `name`. */
  entries: z.array(z.object({
    name: z.string().min(1),
    values: z.record(z.string(), z.string()),
  })).max(maximumBroadcastTaskRecords),
  warnings: z.array(z.string().max(512)).max(200).default([]),
});

export const readTickerSourceRequestSchema = z.object({
  filePath: z.string().min(1),
});

export const tickerSourceContentSchema = z.object({
  filePath: z.string().min(1),
  items: z.array(z.string().max(2_000)).max(200),
  warnings: z.array(z.string().max(512)).max(200).default([]),
});

export const graphicEffectKindSchema = z.enum(["static", "video"]);

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
  /** Непусто у эффектов второго уровня. */
  broadcast: broadcastEffectDefinitionSchema.nullable().default(null),
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
  /**
   * С какой секунды исходного файла берётся картинка. Ненулевое значение нужно
   * стингеру: вторая половина перехода начинается с середины файла.
   */
  sourceInSeconds: z.number().nonnegative().default(0),
  /** `luma` вырезает чёрный фон у переходов без альфа-канала. */
  blendMode: stingerBlendModeSchema.default("alpha"),
  lumaThreshold: z.number().min(0).max(1).default(0.08),
  /**
   * Слой собран из пронумерованных кадров: `filePath` — printf-шаблон, а не
   * файл. Частоту кадров задаёт оператор, в самих .png её нет.
   */
  sequenceFrameRate: z.number().positive().max(240).nullable().default(null),
  sequenceStartNumber: z.number().int().nonnegative().max(1_000_000).nullable().default(null),
  /**
   * Сдвиг слоя по кадру в процентах его ширины и высоты. Слой рисуется во весь
   * кадр, поэтому сдвиг двигает всю графику разом — и вместе с ней надпись
   * эффекта, которой планировщик поправил координаты на те же проценты.
   */
  offsetXPercent: z.number().min(-100).max(100).default(0),
  offsetYPercent: z.number().min(-100).max(100).default(0),
  /** Каким уровнем эффектов слой создан — только для подсветки в интерфейсе. */
  tier: z.union([z.literal(2), z.literal(3)]).default(3),
  backgroundPath: z.string().min(1).nullable().optional(),
  titlePath: z.string().min(1).nullable().optional(),
  titlePaths: z.array(z.string().max(4_096)).max(2_000).default([]),
}).refine((layer) => layer.endSeconds > layer.startSeconds, {
  message: "FX layer end must be after its start",
  path: ["endSeconds"],
});

export const subtitleOverlaySchema = z.object({
  enabled: z.boolean().default(false),
  filePath: z.string().min(1).nullable().default(null),
});

/**
 * Дополнительная звуковая дорожка ролика. Файл лежит рядом с видео или в отдельной
 * папке и назван `{язык} <то же имя, что у видео>`; язык приводится к ISO 639-2.
 */
export const audioTrackSchema = z.object({
  languageCode: z.string().regex(/^[a-z]{3}$/, "Language must be an ISO 639-2 code"),
  label: z.string().trim().min(1).max(32),
  filePath: z.string().min(1),
  streamIndex: z.number().int().nonnegative().default(0),
  // Длительность самого файла дорожки. `null` — ffprobe не смог её определить.
  // Дорожка короче ролика доигрывает тишиной, и это видно в таймлайне.
  durationSeconds: z.number().nonnegative().nullable().default(null),
});

export const maximumProgramAudioTracks = 8;

/** Дорожка программы: набор фиксируется на старте сессии, потому что PMT неизменна. */
export const programAudioTrackSchema = z.object({
  languageCode: z.string().regex(/^[a-z]{3}$/, "Language must be an ISO 639-2 code"),
  label: z.string().trim().min(1).max(32),
  pid: z.number().int().min(32).max(8_190),
  original: z.boolean().default(false),
});

export const audioTrackMatchSchema = z.object({
  mediaFilePath: z.string().min(1),
  tracks: z.array(audioTrackSchema).max(maximumProgramAudioTracks),
});

export const scanAudioTracksRequestSchema = z.object({
  directoryPath: z.string().min(1).nullable().default(null),
  mediaPaths: z.array(z.string().min(1)).min(1).max(1_000),
});

export const audioTrackScanSchema = z.object({
  items: z.array(audioTrackMatchSchema),
  languages: z.array(z.object({
    languageCode: z.string().regex(/^[a-z]{3}$/),
    label: z.string(),
    itemCount: z.number().int().nonnegative(),
  })),
});

/**
 * Показ сцены внутри ролика.
 *
 * Оператор задаёт только момент и длительность: как титр появляется и уходит —
 * дело шаблона. Режиссёр укладывает вход и выход внутрь заданной длительности.
 */
export const playoutSceneShowSchema = z.object({
  id: z.string().min(1).max(64),
  /** Откуда пришёл показ — нужно, чтобы снять его вместе с эффектом. */
  effectId: z.string().min(1).max(64),
  template: sceneTemplateSchema,
  fields: z.record(z.string(), z.string().max(2_000)).default({}),
  startSeconds: z.number().nonnegative().max(86_400).default(0),
  durationSeconds: z.number().positive().max(86_400),
});

export const playoutItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  filePath: z.string().min(1),
  sourceDurationSeconds: z.number().positive().optional(),
  hasAudio: z.boolean().optional(),
  trimInSeconds: z.number().nonnegative().default(0),
  trimOutSeconds: z.number().positive().nullable().default(null),
  scte35Markers: z.array(scte35MarkerSchema).max(1_000).default([]),
  scheduleType: scheduleItemTypeSchema.nullable().optional(),
  declaredDurationSeconds: z.number().positive().nullable().optional(),
  ageTitle: ageTitleOverlaySchema.nullable().optional(),
  itemLogo: itemLogoOverlaySchema.nullable().optional(),
  effects: z.array(graphicEffectLayerSchema).max(64).optional(),
  audioOverlays: z.array(clipAudioOverlaySchema).max(8).optional(),
  subtitles: subtitleOverlaySchema.nullable().optional(),
  audioTracks: z.array(audioTrackSchema).max(maximumProgramAudioTracks).optional(),
  /** Сцены второго уровня; пусто — в конвейере ничего не меняется. */
  scenes: z.array(playoutSceneShowSchema).max(8).optional(),
});

/**
 * Псевдопуть источника цветных полос. Файла с таким именем не существует:
 * FFmpeg рисует полосы фильтром, поэтому эфир поднимается даже тогда, когда
 * в расписании нет ни одного ролика, — вместо отказа на старте в линию уходит
 * привычная инженеру заглушка.
 *
 * Соглашение то же, что у эффектов второго уровня с их `broadcast://`: путь
 * указывает на способ получить картинку, а не на файл.
 */
export const barsSourcePath = "bars://smpte";

/**
 * Длительность одного круга заглушки. Полосы крутятся повтором расписания,
 * поэтому число задаёт только частоту перезапуска рендерера, а не то, сколько
 * заглушка продержится в эфире.
 */
export const barsSegmentSeconds = 60;

export function isBarsSource(filePath: string): boolean {
  return filePath === barsSourcePath;
}

/** Единственный элемент расписания-заглушки. */
export function barsPlayoutItem(durationSeconds: number = barsSegmentSeconds): PlayoutItem {
  return playoutItemSchema.parse({
    id: "bars",
    name: "Colour bars",
    filePath: barsSourcePath,
    hasAudio: false,
    sourceDurationSeconds: durationSeconds,
    trimOutSeconds: durationSeconds,
  });
}

export const analyzeGraphicEffectsRequestSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(200),
});

export const scanGraphicEffectsRequestSchema = z.object({
  directoryPath: z.string().min(1),
});

/** Разбор последовательности кадров по одному выбранному файлу. */
export const imageSequenceRequestSchema = z.object({
  framePath: z.string().min(1),
});

export const imageSequenceSchema = z.object({
  /** printf-шаблон с абсолютным путём: именно он уходит в FFmpeg. */
  pattern: z.string().min(1),
  startNumber: z.number().int().nonnegative(),
  frameCount: z.number().int().positive(),
  /** Пропущенные номера внутри диапазона — дыры в переходе. */
  missing: z.array(z.number().int().nonnegative()).max(20).default([]),
  width: z.number().int().nonnegative().default(0),
  height: z.number().int().nonnegative().default(0),
});

/** Системный шрифт для динамических надписей. */
export const systemFontSchema = z.object({
  family: z.string().min(1).max(256),
  filePath: z.string().min(1),
  /** Есть ли в шрифте кириллица: без неё бегущая строка выйдет прямоугольниками. */
  cyrillic: z.boolean(),
});

export const systemFontListSchema = z.object({
  items: z.array(systemFontSchema).max(400),
});

/** Новости бегущей строки из внешней ленты. */
export const readTickerFeedRequestSchema = z.object({
  url: z.string().url().max(2_048),
  limit: z.number().int().min(1).max(200).default(30),
});

/** Проверка, что файлы графики из расписания ещё лежат на диске. */
export const verifyGraphicEffectsRequestSchema = z.object({
  paths: z.array(z.string().min(1)).max(2_000),
});

export const graphicEffectVerificationSchema = z.object({
  missing: z.array(z.string().min(1)).max(2_000),
});

export const graphicEffectAssetListSchema = z.object({
  items: z.array(graphicEffectAssetSchema).max(200),
});

export const graphicEffectImportIssueSchema = z.object({
  filePath: z.string().min(1),
  message: z.string().min(1).max(2_048),
});

/** Пакетный импорт не теряет исправные файлы из-за одного несовместимого. */
export const graphicEffectImportResultSchema = z.object({
  items: z.array(graphicEffectAssetSchema).max(200),
  issues: z.array(graphicEffectImportIssueSchema).max(200).default([]),
});

export const parseScheduleRequestSchema = z.object({
  filePath: z.string().min(1),
});

/** Дорожка в расписании: строка `insertAudioTrack_{язык} {путь}` под роликом. */
export const scheduleAudioTrackSchema = z.object({
  language: z.string().trim().min(1).max(32).refine((value) => !/[\r\n{}]/.test(value), {
    message: "Audio track language must not contain braces or line breaks",
  }),
  filePath: z.string().min(1).refine((value) => !/[\r\n]/.test(value), {
    message: "Audio track path must not contain line breaks",
  }),
});

export const scheduleGraphicElementSchema = z.object({
  name: z.string().trim().min(1).max(128),
  backgroundPath: z.string().min(1).nullable(),
  titlePath: z.string().min(1).nullable(),
  titlePaths: z.array(z.string().max(4_096)).max(2_000).default([]),
  durationSeconds: z.number().positive(),
  startOnSeconds: z.number().nonnegative(),
  endOnSeconds: z.number().positive(),
}).refine((element) => Boolean(element.backgroundPath || element.titlePath), {
  message: "Graphic element requires backgroundPath or titlePath",
  path: ["backgroundPath"],
}).refine((element) => element.endOnSeconds > element.startOnSeconds, {
  message: "Graphic element endOn must be after startOn",
  path: ["endOnSeconds"],
});



/**
 * Эфирный эффект в расписании.
 *
 * Определение пишется **один раз** заголовком файла, а ролики ссылаются на него
 * опознавателем. Иначе один титр на двухстах роликах означал бы двести копий
 * своей сцены в одном текстовом файле.
 *
 * Само определение едет в base64: расписание разбирается построчно по фигурным
 * скобкам, а сцена — это JSON, и в нём скобок полно.
 */
export const scheduleBroadcastEffectSchema = z.object({
  effectId: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  kind: broadcastEffectKindSchema,
  /** JSON определения эффекта в base64. */
  data: z.string().min(1).max(4_000_000),
});

/** Показ эффекта на ролике: ссылка на определение плюс окно и значения полей. */
export const scheduleBroadcastShowSchema = z.object({
  effectId: z.string().min(1).max(64),
  startOnSeconds: z.number().nonnegative(),
  endOnSeconds: z.number().nonnegative(),
  /** Значения полей в base64; пусто — брать образцы шаблона. */
  fields: z.string().max(200_000).default(""),
});

export type ScheduleBroadcastEffect = z.infer<typeof scheduleBroadcastEffectSchema>;
export type ScheduleBroadcastShow = z.infer<typeof scheduleBroadcastShowSchema>;

export const parsedScheduleItemSchema = z.object({
  type: scheduleItemTypeSchema,
  declaredDurationSeconds: z.number().positive(),
  declaredDuration: z.string().min(1),
  filePath: z.string().min(1),
  ageTitle: z.string().nullable(),
  ageTitleDurationSeconds: z.number().int().min(10).max(60).nullable(),
  logoPath: z.string().nullable(),
  graphicElements: z.array(scheduleGraphicElementSchema).max(64).default([]),
  broadcastShows: z.array(scheduleBroadcastShowSchema).max(64).default([]),
  srtPath: z.string().nullable().default(null),
  srtEnabled: z.boolean().default(true),
  audioTracks: z.array(scheduleAudioTrackSchema).max(maximumProgramAudioTracks).default([]),
  lineNumber: z.number().int().positive(),
  warnings: z.array(z.string()),
});

export const parsedScheduleSchema = z.object({
  /** Определения эфирных эффектов из заголовка файла. */
  broadcastEffects: z.array(scheduleBroadcastEffectSchema).max(200).default([]),
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

export const scheduleExportExtensionSchema = z.literal("txt");

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
  broadcastShows: z.array(scheduleBroadcastShowSchema).max(64).default([]),
  srtPath: z.string().min(1).refine((value) => !/[\r\n{}]/.test(value), {
    message: "SRT path must not contain braces or line breaks",
  }).nullable().optional(),
  srtEnabled: z.boolean().optional(),
  audioTracks: z.array(scheduleAudioTrackSchema).max(maximumProgramAudioTracks).optional(),
});



export const serializeScheduleRequestSchema = z.object({
  extension: scheduleExportExtensionSchema,
  startTime: z.string().regex(/^\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/),
  delaySeconds: z.number().nonnegative(),
  /** Определения эффектов — заголовком, до первого ролика. */
  broadcastEffects: z.array(scheduleBroadcastEffectSchema).max(200).default([]),
  items: z.array(scheduleExportItemSchema).min(1),
});

export const serializedScheduleSchema = z.object({
  extension: scheduleExportExtensionSchema,
  content: z.string().min(1),
});


export const videoEncodingSchema = z.object({
  codec: z.enum(["h264", "h265", "mpeg2"]),
  hardware: videoHardwareSchema.default("off"),
  /**
   * Узел рендера для VAAPI. У остальных ускорителей устройство выбирается
   * драйвером, у VAAPI — путь в файловой системе.
   */
  vaapiDevice: z.string().min(1).default("/dev/dri/renderD128"),
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
  loudnessNormalization: z.object({
    enabled: z.boolean().default(false),
    targetLufs: z.number().min(-70).max(-5).default(-23),
    truePeakDbtp: z.number().min(-9).max(0).default(-1),
    loudnessRangeLufs: z.number().min(1).max(50).default(7),
  }).default({
    enabled: false,
    targetLufs: -23,
    truePeakDbtp: -1,
    loudnessRangeLufs: 7,
  }),
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

/**
 * Многоязычный звук. Набор дорожек считается по всему плейлисту при Start:
 * каждая получает собственный PID, поэтому головная станция может отбирать их
 * по отдельности. Ролик без нужного файла отдаёт тишину — состав PMT не меняется.
 */
export const audioProgramSchema = z.object({
  enabled: z.boolean().default(false),
  directoryPath: z.string().min(1).nullable().default(null),
  originalLanguageCode: z.string().regex(/^[a-z]{3}$/).default("rus"),
  originalLabel: z.string().trim().min(1).max(32).default("orig"),
  tracks: z.array(programAudioTrackSchema).max(maximumProgramAudioTracks).default([]),
});

export const defaultAudioProgram = {
  enabled: false,
  directoryPath: null,
  originalLanguageCode: "rus",
  originalLabel: "orig",
  tracks: [],
};

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
  ptsOffsetMs: z.number().int().min(0).max(10_000).default(0),
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
  ptsOffsetMs: 0,
};

export const startPlayoutRequestSchema = z.object({
  /**
   * Пустое расписание допустимо: вместо отказа на старте в линию уходят
   * цветные полосы. Подстановка живёт в supervisor, чтобы её видел любой
   * вызывающий, а не только HTTP-маршрут.
   */
  playlist: z.array(playoutItemSchema).max(1_000),
  nextPlaylist: z.array(playoutItemSchema).max(1_000).default([]),
  video: videoEncodingSchema,
  audio: audioEncodingSchema,
  logo: logoOverlaySchema.nullable().default(null),
  endpoint: playoutEndpointSchema,
  subtitleOutput: subtitleOutputSchema.default(defaultSubtitleOutput),
  audioProgram: audioProgramSchema.optional(),
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
}).superRefine((request, context) => {
  if (!request.audioProgram?.enabled) return;

  if (request.endpoint.protocol === "rtmp") {
    context.addIssue({
      code: "custom",
      message: "Multiple audio tracks require an MPEG-TS UDP or SRT output; FLV carries one track",
      path: ["audioProgram", "enabled"],
    });
    return;
  }

  const mpegTs = request.endpoint.protocol === "udp"
    ? request.endpoint.mpegTs
    : defaultMpegTsOutputSettings;
  const reserved = new Map<number, string>([
    [mpegTs.videoPid, "video"],
    [mpegTs.audioPid, "primary audio"],
  ]);
  if (request.scte35.enabled) reserved.set(request.scte35.pid, "SCTE-35");
  if (request.subtitleOutput.mode === "dvb") {
    reserved.set(request.subtitleOutput.pid, "DVB subtitles");
  }

  request.audioProgram.tracks.forEach((track, index) => {
    // Первая дорожка сознательно переиспользует основной audio PID: так поток
    // остаётся совместимым с приёмником, который знает только одну дорожку.
    if (index === 0 && track.pid === mpegTs.audioPid) return;

    const conflict = reserved.get(track.pid);
    if (conflict) {
      context.addIssue({
        code: "custom",
        message: `Audio track ${track.label} PID ${track.pid} collides with the ${conflict} PID`,
        path: ["audioProgram", "tracks", index, "pid"],
      });
      return;
    }
    reserved.set(track.pid, `audio ${track.label}`);
  });
});

export const startCompositeClipPreviewRequestSchema = z.object({
  request: startPlayoutRequestSchema,
  startSeconds: z.number().nonnegative().default(0),
});

export const updateNextPlaylistRequestSchema = z.object({
  nextPlaylist: z.array(playoutItemSchema).max(1_000),
});

export const updateCurrentPlaylistRequestSchema = z.object({
  playlist: z.array(playoutItemSchema).min(1).max(1_000),
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
  observedPes: z.number().int().nonnegative().default(0),
  lastPtsMs: z.number().int().nonnegative().nullable().default(null),
  videoPtsOriginMs: z.number().int().nonnegative().nullable().default(null),
  clockErrorMs: z.number().int().nullable().default(null),
  clockSynchronized: z.boolean().nullable().default(null),
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
  currentItemDurationSeconds: z.number().nonnegative().default(0),
  currentItemProgressPercent: z.number().min(0).max(100).default(0),
  totalItems: z.number().int().nonnegative(),
  outTimeSeconds: z.number().nonnegative(),
  totalDurationSeconds: z.number().nonnegative(),
  progressPercent: z.number().min(0).max(100),
  frame: z.number().int().nonnegative(),
  fps: z.number().nonnegative(),
  bitrateKbps: z.number().nonnegative(),
  audioLevelDbfs: z.number().min(-120).max(12).nullable().default(null),
  transportBitrateBps: z.number().int().nonnegative().nullable().default(null),
  transportBitrateMode: z.enum(["auto", "manual"]).nullable().default(null),
  continuityErrors: z.number().int().nonnegative().default(0),
  speed: z.number().nonnegative(),
  endpointLabel: z.string().nullable(),
  previewPath: z.string().nullable(),
  repeatPlaylist: z.boolean().default(false),
  loopCount: z.number().int().nonnegative().default(0),
  schedulePhase: z.enum(["current", "future"]).default("current"),
  scheduleTransitionCount: z.number().int().nonnegative().default(0),
  queuedFutureItems: z.number().int().nonnegative().default(0),
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
    observedPes: 0,
    lastPtsMs: null,
    videoPtsOriginMs: null,
    clockErrorMs: null,
    clockSynchronized: null,
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
  hasAudio: z.boolean().optional(),
  sha256: z.string(),
  scte35Markers: z.array(scte35MarkerSchema).max(1_000).optional(),
  scheduleType: scheduleItemTypeSchema.optional(),
  declaredDurationSeconds: z.number().positive().optional(),
  scheduleLineNumber: z.number().int().positive().optional(),
  ageTitle: ageTitleOverlaySchema.optional(),
  itemLogo: itemLogoOverlaySchema.optional(),
  effects: z.array(graphicEffectLayerSchema).max(64).optional(),
  audioOverlays: z.array(clipAudioOverlaySchema).max(8).optional(),
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
  assets: z.array(workspaceSessionAssetSchema).max(2_500),
  currentPlaylist: z.array(workspaceSessionAssetSchema).max(1_000),
  futurePlaylist: z.array(workspaceSessionAssetSchema).max(1_000),
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
export type BroadcastEffectKind = z.infer<typeof broadcastEffectKindSchema>;
export type BroadcastEffectDefinition = z.infer<typeof broadcastEffectDefinitionSchema>;
export type EffectDecoration = z.infer<typeof effectDecorationSchema>;
export type BroadcastEffectSettings = z.infer<typeof broadcastEffectSettingsSchema>;
export type BroadcastDataBinding = z.infer<typeof broadcastDataBindingSchema>;
export type BroadcastDataMapping = z.infer<typeof broadcastDataMappingSchema>;
export type AnimationInOutSettings = z.infer<typeof animationInOutSettingsSchema>;
export type AnimationInOutMode = z.infer<typeof animationInOutModeSchema>;
export type DynamicTitleSettings = z.infer<typeof dynamicTitleSettingsSchema>;
export type EffectPlacement = z.infer<typeof effectPlacementSchema>;
export type NextProgramSettings = z.infer<typeof nextProgramSettingsSchema>;
export type TickerCrawlSettings = z.infer<typeof tickerCrawlSettingsSchema>;
export type ClockCountdownSettings = z.infer<typeof clockCountdownSettingsSchema>;
export type StingerTransitionSettings = z.infer<typeof stingerTransitionSettingsSchema>;
export type StingerBlendMode = z.infer<typeof stingerBlendModeSchema>;
export type StingerSourceKind = z.infer<typeof stingerSourceKindSchema>;
export type CountdownSource = z.infer<typeof countdownSourceSchema>;
export type VideoHardware = z.infer<typeof videoHardwareSchema>;
export type BroadcastTextStyle = z.infer<typeof broadcastTextStyleSchema>;
export type TextAlign = z.infer<typeof textAlignSchema>;
export type ClipAudioOverlay = z.infer<typeof clipAudioOverlaySchema>;
export type BroadcastTaskFileContent = z.infer<typeof broadcastTaskFileContentSchema>;
export type GraphicEffectVerification = z.infer<typeof graphicEffectVerificationSchema>;
export type GraphicEffectImportIssue = z.infer<typeof graphicEffectImportIssueSchema>;
export type GraphicEffectImportResult = z.infer<typeof graphicEffectImportResultSchema>;
export type SystemFont = z.infer<typeof systemFontSchema>;
export type TickerSourceContent = z.infer<typeof tickerSourceContentSchema>;
export type GraphicEffectAsset = z.infer<typeof graphicEffectAssetSchema>;
export type GraphicEffectLayer = z.infer<typeof graphicEffectLayerSchema>;
export type SubtitleOverlay = z.infer<typeof subtitleOverlaySchema>;
export type ScheduleGraphicElement = z.infer<typeof scheduleGraphicElementSchema>;
export type ParsedScheduleItem = z.infer<typeof parsedScheduleItemSchema>;
export type ParsedSchedule = z.infer<typeof parsedScheduleSchema>;
export type ScheduleExportExtension = z.infer<typeof scheduleExportExtensionSchema>;
export type SerializeScheduleRequest = z.infer<typeof serializeScheduleRequestSchema>;
export type SerializedSchedule = z.infer<typeof serializedScheduleSchema>;
export type PlayoutItem = z.infer<typeof playoutItemSchema>;
export type PlayoutSceneShow = z.infer<typeof playoutSceneShowSchema>;
export type ImageSequence = z.infer<typeof imageSequenceSchema>;
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type ProgramAudioTrack = z.infer<typeof programAudioTrackSchema>;
export type AudioProgram = z.infer<typeof audioProgramSchema>;
export type AudioTrackMatch = z.infer<typeof audioTrackMatchSchema>;
export type AudioTrackScan = z.infer<typeof audioTrackScanSchema>;
export type ScanAudioTracksRequest = z.infer<typeof scanAudioTracksRequestSchema>;
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
