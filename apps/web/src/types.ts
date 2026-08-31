import type {
  ClipAudioOverlay,
  PlayoutSceneShow,
  GraphicEffectLayer,
  VideoHardware,
} from "@gruber/contracts";

export type AppView = "import" | "effects" | "playlist" | "broadcast";

type AssetStatus = "analyzed" | "pending" | "error" | "queued";
export type ScheduleSlot = "current" | "future";
type ScheduleItemType = "movie" | "chop" | "clip";

export type Scte35MarkerKind = "break-start" | "break-end";

export interface Scte35Marker {
  id: string;
  positionSeconds: number;
  eventId: number;
  kind: Scte35MarkerKind;
  durationSeconds: number | null;
  segmentationTypeId: number;
  upid: string;
}

export interface MediaAsset {
  id: string;
  name: string;
  duration: string;
  durationSeconds: number;
  codec: string;
  codecFamily: string;
  codecProfile: string;
  resolution: string;
  fps: string;
  bitrate: string;
  size: string;
  status: AssetStatus;
  progress?: number;
  preview: string;
  filePath: string;
  colorSpace: string;
  audio: string;
  hasAudio?: boolean;
  sha256: string;
  scte35Markers?: Scte35Marker[];
  scheduleType?: ScheduleItemType;
  declaredDurationSeconds?: number;
  scheduleLineNumber?: number;
  ageTitle?: {
    durationSeconds: number;
    enabled: boolean;
    text: string;
    filePath?: string | null;
  };
  itemLogo?: {
    enabled: boolean;
    filePath: string;
    /** Анимированный логотип: крутить по кругу или замереть на последнем кадре. */
    loop: boolean;
    margin: number;
    opacity: number;
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
    widthPercent: number;
  };
  effects?: GraphicEffectLayer[];
  /** Звуковые вставки второго уровня — сейчас только звук стингера. */
  audioOverlays?: ClipAudioOverlay[];
  /** Показы сцен второго уровня, поставленные на этот ролик. */
  scenes?: PlayoutSceneShow[];
  subtitles?: {
    enabled: boolean;
    filePath: string | null;
  };
  audioTracks?: AudioTrackInfo[];
}

/** Дополнительная звуковая дорожка ролика, найденная по имени файла. */
export interface AudioTrackInfo {
  languageCode: string;
  label: string;
  filePath: string;
  streamIndex: number;
  /** Длительность файла дорожки; `null` — ffprobe её не определил. */
  durationSeconds: number | null;
}

export interface AudioTrackLibrary {
  directoryPath: string;
  languages: { languageCode: string; label: string; itemCount: number }[];
}

export interface ScheduleOverlayLibrary {
  directoryPath: string;
  imagePaths: string[];
}

export interface SubtitleLibrary {
  directoryPath: string;
  filePaths: string[];
}

export interface ScheduleMetadata {
  sourceFilePath: string;
  sourceName: string;
  encoding: "utf-8" | "windows-1251";
  startTime: string;
  anchorDate?: string;
  delaySeconds: number;
  targetDurationSeconds: number;
  warnings: string[];
}

export interface BroadcastSettings {
  videoCodec: string;
  /** Ускоритель кодирования. Для UHD это условие, а не оптимизация. */
  videoHardware: VideoHardware;
  /**
   * Поднимать эфир сразу после запуска программы — с того места, где он
   * оборвался. Для станции без оператора: машина перезагрузилась, FluxIO
   * стартовал сам, расписание пошло дальше.
   */
  autoResumeOnLaunch: boolean;
  profile: string;
  level: string;
  preset: number;
  width: number;
  height: number;
  dimensionsLocked: boolean;
  frameRate: string;
  deinterlace: boolean;
  fieldOrder: string;
  gopSize: number;
  bFrames: number;
  closedGop: boolean;
  rateControl: string;
  targetBitrate: number;
  maxBitrate: number;
  bufferSize: number;
  crf: number;
  audioCodec: string;
  sampleRate: string;
  channels: string;
  audioBitrate: number;
  loudnessNormalizationEnabled: boolean;
  loudnessTargetLufs: number;
  audioTracksEnabled: boolean;
  audioTrackDirectory: string;
  audioOriginalLanguage: string;
  audioOriginalLabel: string;
  streamingEnabled: boolean;
  protocol: string;
  serverUrl: string;
  streamKey: string;
  latency: string;
  udpHost: string;
  udpPort: number;
  udpPacketSize: number;
  udpTtl: number;
  udpLocalAddress: string;
  udpServiceName: string;
  udpServiceId: number;
  udpProviderName: string;
  udpVideoPid: number;
  udpAudioPid: number;
  udpServiceType: string;
  udpPcrPeriodMs: number;
  udpTransportBitrate: number;
  srtHost: string;
  srtPort: number;
  srtMode: string;
  srtLatencyMs: number;
  srtPassphrase: string;
  srtStreamId: string;
  rtmpServerUrl: string;
  rtmpStreamKey: string;
  subtitleOutputMode: "Burn-in" | "DVB Subtitles";
  subtitlePid: number;
  subtitleLanguage: string;
  subtitleType: "Normal" | "Hearing impaired";
  subtitleFontFamily: string;
  subtitleFontSize: number;
  subtitleBottomMargin: number;
  subtitleOutline: boolean;
  subtitleMaxColours: 4 | 16 | 256;
  subtitleBitrateKbps: number;
  subtitlePtsOffsetMs: number;
  ageTitleDurationSeconds: number;
  logoEnabled: boolean;
  logoPath: string;
  /** Крутить анимированный логотип по кругу; у картинки значения не имеет. */
  logoLoop: boolean;
  logoPosition: string;
  logoWidthPercent: number;
  logoMargin: number;
  logoOpacity: number;
  repeatSchedule: boolean;
  scte35PlanningEnabled: boolean;
  scte35Command: string;
  scte35Owner: string;
  scte35Pid: number;
  scte35PreRollMs: number;
  scte35DefaultEventId: number;
  scte35DefaultBreakDuration: number;
  scte35UpidType: string;
  scte35DefaultUpid: string;
  scte35LoopEventStrategy: string;
}
