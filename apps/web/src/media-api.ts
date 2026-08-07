import {
  ffmpegCapabilitiesSchema,
  broadcastConfigurationSummarySchema,
  clipPreviewSessionSchema,
  mediaProbeSchema,
  networkInterfaceListSchema,
  playoutStatusSchema,
  savedBroadcastConfigurationSchema,
  savedWorkspaceSessionSchema,
  systemMetricsSchema,
  workspaceSessionEnvelopeSchema,
  parsedScheduleSchema,
  serializedScheduleSchema,
  type BroadcastConfigurationSummary,
  type ClipPreviewSession,
  type FfmpegCapabilities,
  type MediaProbe,
  type NetworkInterfaceInfo,
  type PlayoutStatus,
  type ParsedSchedule,
  type SerializeScheduleRequest,
  type SerializedSchedule,
  type SaveBroadcastConfigurationRequest,
  type SavedBroadcastConfiguration,
  type SavedWorkspaceSession,
  type StartPlayoutRequest,
  type SystemMetrics,
  type WorkspaceSessionSaveRequest,
} from "@gruber/contracts";
import { mediaApiUrl } from "./runtime";

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

export async function startClipPreview(
  filePath: string,
  startSeconds: number,
): Promise<ClipPreviewSession> {
  return clipPreviewSessionSchema.parse(
    await request("/api/media/clip-preview/start", {
      body: JSON.stringify({ filePath, startSeconds }),
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

export async function stopPlayout(): Promise<PlayoutStatus> {
  return playoutStatusSchema.parse(
    await request("/api/playout/stop", { method: "POST" }),
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

export async function listBroadcastConfigurations(): Promise<
  BroadcastConfigurationSummary[]
> {
  const payload = await request("/api/configurations");
  if (!payload || typeof payload !== "object" || !("items" in payload)) {
    throw new Error("Media service returned an invalid configuration list");
  }
  return broadcastConfigurationSummarySchema.array().parse(payload.items);
}

export async function getBroadcastConfiguration(
  id: string,
): Promise<SavedBroadcastConfiguration> {
  return savedBroadcastConfigurationSchema.parse(
    await request(`/api/configurations/${encodeURIComponent(id)}`),
  );
}

export async function saveBroadcastConfiguration(
  configuration: SaveBroadcastConfigurationRequest,
): Promise<SavedBroadcastConfiguration> {
  return savedBroadcastConfigurationSchema.parse(
    await request("/api/configurations", {
      body: JSON.stringify(configuration),
      headers: { "content-type": "application/json" },
      method: "PUT",
    }),
  );
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(mediaApiUrl(path), init);
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
