export type AppView = "import" | "playlist" | "broadcast";

export type AssetStatus = "analyzed" | "pending" | "error" | "queued";
export type ScheduleSlot = "current" | "future";
export type ScheduleItemType = "movie" | "chop" | "clip";

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
    margin: number;
    opacity: number;
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
    widthPercent: number;
  };
}

export interface ScheduleOverlayLibrary {
  directoryPath: string;
  imagePaths: string[];
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
  ageTitleDurationSeconds: number;
  logoEnabled: boolean;
  logoPath: string;
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

export interface EncodingJob {
  id: string;
  name: string;
  progress: number;
  eta: string;
  bitrate: string;
}
