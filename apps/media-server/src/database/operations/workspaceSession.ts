import type {
  PlayoutStatus,
  SavedWorkspaceSession,
  WorkspaceSessionSaveRequest,
} from "@gruber/contracts";
import { workspaceSessionSaveRequestSchema } from "@gruber/contracts";

//

import { Prisma } from "../../generated/prisma/client.js";
import type { DatabaseContext } from "../context.js";
import {
  recoverableCheckpointFromStatus,
  restoreWorkspaceSession,
  sanitizeWorkspaceSnapshot,
} from "../checkpoint.js";
import { jsonValue } from "../mappers.js";

export async function saveWorkspaceSession(
  database: DatabaseContext,
  input: WorkspaceSessionSaveRequest,
  status: PlayoutStatus,
): Promise<SavedWorkspaceSession> {
  const request = workspaceSessionSaveRequestSchema.parse(input);
  const { sanitized, secrets } = sanitizeWorkspaceSnapshot(request.snapshot);

  const payload = {
    snapshot: jsonValue(sanitized),
    checkpoint: checkpointValue(status),
    encryptedSecrets: Object.keys(secrets).length > 0
      ? database.secrets.encrypt(JSON.stringify(secrets))
      : null,
  };

  const session = await database.client.workspaceSession.upsert({
    create: { slot: "last", ...payload },
    update: payload,
    where: { slot: "last" },
  });

  return restoreWorkspaceSession(session, status, database.secrets);
}

export async function getWorkspaceSession(
  database: DatabaseContext,
  status: PlayoutStatus,
): Promise<SavedWorkspaceSession | null> {
  const session = await database.client.workspaceSession.findUnique({
    where: { slot: "last" },
  });

  if (!session) return null;

  return restoreWorkspaceSession(session, status, database.secrets);
}

export async function deleteWorkspaceSession(database: DatabaseContext): Promise<void> {
  await database.client.workspaceSession.deleteMany({ where: { slot: "last" } });
}

export async function syncWorkspaceCheckpoint(
  database: DatabaseContext,
  status: PlayoutStatus,
): Promise<void> {
  if (!status.sessionId) return;

  await database.client.workspaceSession.updateMany({
    data: { checkpoint: checkpointValue(status) },
    where: { slot: "last" },
  });
}

//

function checkpointValue(status: PlayoutStatus) {
  const checkpoint = recoverableCheckpointFromStatus(status);
  return checkpoint ? jsonValue(checkpoint) : Prisma.DbNull;
}
