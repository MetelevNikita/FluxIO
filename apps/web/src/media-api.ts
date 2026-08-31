import {
  audioTrackScanSchema,
  type AudioTrackScan,
  ffmpegCapabilitiesSchema,
  graphicEffectImportResultSchema,
  graphicEffectVerificationSchema,
  imageSequenceSchema,
  type ImageSequence,
  broadcastTaskFileContentSchema,
  tickerSourceContentSchema,
  systemFontListSchema,
  clipPreviewSessionSchema,
  mediaProbeSchema,
  networkInterfaceListSchema,
  playoutStatusSchema,
  savedWorkspaceSessionSchema,
  systemMetricsSchema,
  workspaceSessionEnvelopeSchema,
  parsedScheduleSchema,
  serializedScheduleSchema,
  type BroadcastTaskFileContent,
  type TickerSourceContent,
  type SystemFont,
  type ClipPreviewSession,
  type FfmpegCapabilities,
  type GraphicEffectImportResult,
  type MediaProbe,
  type NetworkInterfaceInfo,
  type PlayoutStatus,
  type ParsedSchedule,
  type SerializeScheduleRequest,
  type SerializedSchedule,
  type SavedWorkspaceSession,
  type StartPlayoutRequest,
  type SystemMetrics,
  type WorkspaceSessionSaveRequest,
  vectorLayerImportSchema,
  type VectorLayerImport,
} from "@gruber/contracts";
import { mediaApiUrl } from "./runtime.js";
import { mediaRequestTimeoutMs } from "./media-request-timeout.js";

export async function getFfmpegCapabilities(): Promise<FfmpegCapabilities> {
  return ffmpegCapabilitiesSchema.parse(await request("/api/capabilities"));
}

export async function probeMediaPaths(paths: string[]): Promise<MediaProbe[]> {
  return parseProbeResponse(
    await request("/api/media/probe", {
      body: JSON.stringify({ paths }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

export async function scanMediaDirectory(
  directoryPath: string,
): Promise<MediaProbe[]> {
  return parseProbeResponse(
    await request("/api/media/scan", {
      body: JSON.stringify({ directoryPath }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

export async function analyzeGraphicEffectPaths(
  paths: string[],
): Promise<GraphicEffectImportResult> {
  return graphicEffectImportResultSchema.parse(
    await request("/api/effects/analyze", {
      body: JSON.stringify({ paths }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

/**
 * Разбор последовательности кадров по одному выбранному файлу: служба выводит
 * шаблон нумерации, границы диапазона и пропуски.
 */
export async function readImageSequence(framePath: string): Promise<ImageSequence> {
  return imageSequenceSchema.parse(
    await request("/api/effects/sequence", {
      body: JSON.stringify({ framePath }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

export async function verifyGraphicEffectPaths(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  return graphicEffectVerificationSchema.parse(
    await request("/api/effects/verify", {
      body: JSON.stringify({ paths }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  ).missing;
}

export async function scanAudioTracks(
  directoryPath: string | null,
  mediaPaths: string[],
): Promise<AudioTrackScan> {
  return audioTrackScanSchema.parse(
    await request("/api/audio-tracks/scan", {
      body: JSON.stringify({ directoryPath, mediaPaths }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

/** Системные шрифты машины, где работает media-service. */
export async function listSystemFonts(): Promise<SystemFont[]> {
  return systemFontListSchema.parse(await request("/api/effects/fonts")).items;
}

export async function importVectorLayers(filePath: string): Promise<VectorLayerImport> {
  return vectorLayerImportSchema.parse(
    await request("/api/effects/vector-layers", {
      body: JSON.stringify({ filePath }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

export function vectorLayerPreviewUrl(filePath: string): string {
  return mediaApiUrl(`/api/effects/vector-layer-preview?filePath=${encodeURIComponent(filePath)}`);
}

/** Заголовки новостной ленты. Качает сервер: у окна Electron строгий CSP. */
export async function readTickerFeed(
  url: string,
  limit = 30,
): Promise<TickerSourceContent> {
  return tickerSourceContentSchema.parse(
    await request("/api/effects/broadcast/ticker-feed", {
      body: JSON.stringify({ limit, url }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

/** Файл задания эффекта второго уровня: читает и проверяет его media-service. */
export async function readBroadcastTaskFile(filePath: string): Promise<BroadcastTaskFileContent> {
  return broadcastTaskFileContentSchema.parse(
    await request("/api/effects/broadcast/task", {
      body: JSON.stringify({ filePath }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

export async function readTickerSourceFile(filePath: string): Promise<TickerSourceContent> {
  return tickerSourceContentSchema.parse(
    await request("/api/effects/broadcast/ticker-source", {
      body: JSON.stringify({ filePath }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

export async function parseScheduleFile(filePath: string): Promise<ParsedSchedule> {
  return parsedScheduleSchema.parse(
    await request("/api/schedule/parse", {
      body: JSON.stringify({ filePath }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

export async function serializeScheduleFile(
  schedule: SerializeScheduleRequest,
): Promise<SerializedSchedule> {
  return serializedScheduleSchema.parse(
    await request("/api/schedule/serialize", {
      body: JSON.stringify(schedule),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

export async function getPlayoutStatus(): Promise<PlayoutStatus> {
  return playoutStatusSchema.parse(await request("/api/playout/status"));
}

export async function getPlayoutAudioLevel(): Promise<number | null> {
  const payload = await request("/api/playout/audio-level");
  if (!payload || typeof payload !== "object" || !("audioLevelDbfs" in payload)) {
    throw new Error("Media service returned an invalid audio level");
  }
  const value = payload.audioLevelDbfs;
  if (value !== null && typeof value !== "number") {
    throw new Error("Media service returned an invalid audio level");
  }
  return value;
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  return systemMetricsSchema.parse(await request("/api/system/metrics"));
}

export async function getNetworkInterfaces(): Promise<NetworkInterfaceInfo[]> {
  return networkInterfaceListSchema.parse(
    await request("/api/system/network-interfaces"),
  ).items;
}

export function mediaThumbnailUrl(filePath: string, atSeconds?: number): string {
  const query = new URLSearchParams({ path: filePath });
  if (atSeconds != null) query.set("at", atSeconds.toFixed(3));
  return mediaApiUrl(`/api/media/thumbnail?${query}`);
}

export async function startCompositeClipPreview(
  requestBody: StartPlayoutRequest,
  startSeconds: number,
): Promise<ClipPreviewSession> {
  return clipPreviewSessionSchema.parse(
    await request("/api/media/clip-preview/composite", {
      body: JSON.stringify({ request: requestBody, startSeconds }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

export async function stopClipPreview(): Promise<void> {
  await request("/api/media/clip-preview/stop", { method: "POST" });
}

export async function startPlayout(
  requestBody: StartPlayoutRequest,
): Promise<PlayoutStatus> {
  return playoutStatusSchema.parse(
    await request("/api/playout/start", {
      body: JSON.stringify(requestBody),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

export async function takePlayout(
  requestBody: StartPlayoutRequest,
): Promise<PlayoutStatus> {
  return playoutStatusSchema.parse(
    await request("/api/playout/take", {
      body: JSON.stringify(requestBody),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

export async function stopPlayout(): Promise<PlayoutStatus> {
  return playoutStatusSchema.parse(
    await request("/api/playout/stop", { method: "POST" }),
  );
}

export async function updateNextPlayoutPlaylist(
  nextPlaylist: StartPlayoutRequest["nextPlaylist"],
): Promise<PlayoutStatus> {
  return playoutStatusSchema.parse(
    await request("/api/playout/next-playlist", {
      body: JSON.stringify({ nextPlaylist }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    }),
  );
}

export async function updateCurrentPlayoutPlaylist(
  playlist: StartPlayoutRequest["playlist"],
): Promise<PlayoutStatus> {
  return playoutStatusSchema.parse(
    await request("/api/playout/playlist", {
      body: JSON.stringify({ playlist }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    }),
  );
}

export async function getWorkspaceSession(): Promise<SavedWorkspaceSession | null> {
  return workspaceSessionEnvelopeSchema.parse(
    await request("/api/workspace-session"),
  ).session;
}

export async function saveWorkspaceSession(
  session: WorkspaceSessionSaveRequest,
): Promise<SavedWorkspaceSession> {
  return savedWorkspaceSessionSchema.parse(
    await request("/api/workspace-session", {
      body: JSON.stringify(session),
      headers: { "content-type": "application/json" },
      method: "PUT",
    }),
  );
}

export async function deleteWorkspaceSession(): Promise<void> {
  await request("/api/workspace-session", { method: "DELETE" });
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(mediaApiUrl(path), {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(mediaRequestTimeoutMs(path)),
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? String(payload.error)
      : `Media service returned ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function parseProbeResponse(payload: unknown): MediaProbe[] {
  if (!payload || typeof payload !== "object" || !("items" in payload)) {
    throw new Error("Media service returned an invalid probe response");
  }
  return mediaProbeSchema.array().parse(payload.items);
}
