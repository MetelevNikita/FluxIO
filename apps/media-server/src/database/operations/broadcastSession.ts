import type { PlayoutStatus, StartPlayoutRequest } from "@gruber/contracts";

//

import { BroadcastSessionState } from "../../generated/prisma/enums.js";
import type { DatabaseContext } from "../context.js";
import { jsonValue, redactRequest, sessionState } from "../mappers.js";

const activeStates = ["starting", "running", "stopping"];

export async function recordSessionStart(
  database: DatabaseContext,
  request: StartPlayoutRequest,
  status: PlayoutStatus,
): Promise<void> {
  if (!status.sessionId) return;

  await database.client.broadcastSession.create({
    data: {
      runtimeSessionId: status.sessionId,
      state: BroadcastSessionState.RUNNING,
      requestSnapshot: jsonValue(redactRequest(request)),
    },
  });
}

export async function syncSession(
  database: DatabaseContext,
  status: PlayoutStatus,
): Promise<void> {
  if (!status.sessionId) return;
  if (activeStates.includes(status.state)) return;

  await database.client.broadcastSession.updateMany({
    data: {
      state: sessionState(status.state),
      error: status.error,
      stoppedAt: status.stoppedAt ? new Date(status.stoppedAt) : new Date(),
    },
    where: {
      runtimeSessionId: status.sessionId,
      stoppedAt: null,
    },
  });
}
