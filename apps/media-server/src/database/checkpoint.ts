import {
  savedWorkspaceSessionSchema,
  workspaceSessionCheckpointSchema,
  type PlayoutStatus,
  type SavedWorkspaceSession,
  type WorkspaceSessionSaveRequest,
  type WorkspaceSessionSnapshot,
} from "@gruber/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import type { SecretCipher } from "./secrets.js";

const activeStates = ["starting", "running", "stopping"];
const secretKeys = ["streamKey", "srtPassphrase", "rtmpStreamKey"] as const;

export interface StoredWorkspaceSession {
  id: string;
  snapshot: Prisma.JsonValue;
  checkpoint: Prisma.JsonValue | null;
  encryptedSecrets: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Вынимает секреты из snapshot: в PostgreSQL они уходят зашифрованными отдельно. */
export function sanitizeWorkspaceSnapshot(
  snapshot: WorkspaceSessionSaveRequest["snapshot"],
): {
  sanitized: WorkspaceSessionSaveRequest["snapshot"];
  secrets: Record<string, string>;
} {
  const settings = { ...snapshot.settings };
  const secrets: Record<string, string> = {};

  for (const key of secretKeys) {
    const value = settings[key];
    if (typeof value === "string" && value) secrets[key] = value;
    settings[key] = "";
  }

  if (Array.isArray(settings.outputStreams)) {
    settings.outputStreams = settings.outputStreams.map((stream) => {
      if (stream.endpoint.protocol === "srt") {
        if (stream.endpoint.passphrase) {
          secrets[`output:${stream.id}`] = stream.endpoint.passphrase;
        }
        return { ...stream, endpoint: { ...stream.endpoint, passphrase: "" } };
      }
      if (stream.endpoint.protocol === "rtmp") {
        if (stream.endpoint.streamKey) secrets[`output:${stream.id}`] = stream.endpoint.streamKey;
        return { ...stream, endpoint: { ...stream.endpoint, streamKey: "" } };
      }
      return stream;
    });
  }

  return { sanitized: { ...snapshot, settings }, secrets };
}

export function checkpointFromStatus(status: PlayoutStatus) {
  return workspaceSessionCheckpointSchema.parse({
    sessionId: status.sessionId,
    state: status.state,
    currentItemIndex: status.currentItemIndex,
    currentItemId: status.currentItemId,
    currentItemName: status.currentItemName,
    currentItemElapsedSeconds: status.currentItemElapsedSeconds,
    outTimeSeconds: status.outTimeSeconds,
    totalDurationSeconds: status.totalDurationSeconds,
    progressPercent: status.progressPercent,
    loopCount: status.loopCount,
    updatedAt: new Date().toISOString(),
    interrupted: false,
  });
}

export function recoverableCheckpointFromStatus(status: PlayoutStatus) {
  if (!status.sessionId) return null;
  if (activeStates.includes(status.state)) return checkpointFromStatus(status);
  if (status.state === "failed" && hasProgress(status)) return checkpointFromStatus(status);

  return null;
}

/**
 * Восстанавливает сохранённую сессию и решает, был ли прошлый эфир прерван:
 * либо упал уже после первого кадра, либо остался «активным» от чужого runtime.
 */
export function restoreWorkspaceSession(
  session: StoredWorkspaceSession,
  currentStatus: PlayoutStatus,
  secrets: SecretCipher,
): SavedWorkspaceSession {
  const snapshot = session.snapshot as Record<string, unknown>;
  const settings = {
    ...((snapshot.settings as Record<string, unknown> | undefined) ?? {}),
  };

  if (session.encryptedSecrets) {
    const restoredSecrets = decodeSecrets(session.encryptedSecrets, secrets);
    for (const key of secretKeys) settings[key] = restoredSecrets[key] ?? settings[key];
    if (Array.isArray(settings.outputStreams)) {
      settings.outputStreams = settings.outputStreams.map((stream) => {
        if (!stream || typeof stream !== "object" || !("id" in stream) || !("endpoint" in stream)) {
          return stream;
        }
        const endpoint = stream.endpoint;
        const value = restoredSecrets[`output:${String(stream.id)}`];
        if (!value || !endpoint || typeof endpoint !== "object" || !("protocol" in endpoint)) {
          return stream;
        }
        if (endpoint.protocol === "srt") {
          return { ...stream, endpoint: { ...endpoint, passphrase: value } };
        }
        if (endpoint.protocol === "rtmp") {
          return { ...stream, endpoint: { ...endpoint, streamKey: value } };
        }
        return stream;
      });
    }
  }

  const checkpoint = session.checkpoint
    ? workspaceSessionCheckpointSchema.parse(session.checkpoint)
    : null;

  const restored = savedWorkspaceSessionSchema.parse({
    id: session.id,
    snapshot: { ...snapshot, settings },
    checkpoint: checkpoint
      ? { ...checkpoint, interrupted: wasInterrupted(checkpoint, currentStatus) }
      : null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  });
  return { ...restored, snapshot: promoteWorkspaceSnapshot(restored.snapshot, currentStatus.sessionId ? currentStatus : checkpoint) };
}

//

type StoredCheckpoint = ReturnType<typeof checkpointFromStatus>;

function decodeSecrets(
  encryptedSecrets: string,
  secrets: SecretCipher,
): Record<string, string> {
  return JSON.parse(secrets.decrypt(encryptedSecrets)) as Record<string, string>;
}

function wasInterrupted(
  checkpoint: StoredCheckpoint,
  currentStatus: PlayoutStatus,
): boolean {
  if (checkpoint.state === "failed" && hasProgress(checkpoint)) return true;
  if (!activeStates.includes(checkpoint.state)) return false;

  return !isSameRuntimeSession(checkpoint, currentStatus);
}

function isSameRuntimeSession(
  checkpoint: StoredCheckpoint,
  currentStatus: PlayoutStatus,
): boolean {
  if (!checkpoint.sessionId) return false;
  if (currentStatus.sessionId !== checkpoint.sessionId) return false;

  return activeStates.includes(currentStatus.state);
}

function hasProgress(
  value: Pick<
    PlayoutStatus,
    "outTimeSeconds" | "currentItemElapsedSeconds" | "currentItemIndex" | "progressPercent"
  >,
): boolean {
  return value.outTimeSeconds > 0 ||
    value.currentItemElapsedSeconds > 0 ||
    value.currentItemIndex > 0 ||
    value.progressPercent > 0;
}

/** A checkpoint in Future must never be restored against last week's Current. */
export function promoteWorkspaceSnapshot(snapshot: WorkspaceSessionSnapshot, status: { currentItemId: string | null } | null): WorkspaceSessionSnapshot {
  const id = status?.currentItemId;
  if (!id || snapshot.currentPlaylist.some((item) => item.id === id) || !snapshot.futurePlaylist.some((item) => item.id === id)) return snapshot;
  return { ...snapshot, currentPlaylist: snapshot.futurePlaylist, futurePlaylist: [], currentScheduleMetadata: snapshot.futureScheduleMetadata, futureScheduleMetadata: null, activeSchedule: "current", selectedAssetId: id, startMarker: null };
}
