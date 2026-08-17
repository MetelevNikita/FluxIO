import type { FastifyInstance, FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";

//

import {
  startPlayoutRequestSchema,
  updateCurrentPlaylistRequestSchema,
  updateNextPlaylistRequestSchema,
  type PlayoutStatus,
  type StartPlayoutRequest,
} from "@gruber/contracts";
import {
  PlayoutConflictError,
  PlayoutPreflightError,
} from "../../ffmpeg/playout-supervisor.js";
import {
  errorMessage,
  largePlaylistBodyLimitBytes,
  type RouteContext,
} from "../context.js";
import { hlsContentType } from "./mediaRoute.js";

const activeStates = ["starting", "running", "stopping"];
const previewFilePattern =
  /^(?:(?:transport-)?index\.m3u8|(?:transport-)?segment-\d+\.ts)$/;

export async function playoutRoute(app: FastifyInstance, context: RouteContext) {
  app.get("/api/playout/status", async () => {
    const status = context.playout.getStatus();
    await syncFinishedSession(context, status);
    return status;
  });

  app.get("/api/playout/audio-level", async () => ({
    audioLevelDbfs: context.playout.getAudioLevelDbfs(),
  }));

  app.post(
    "/api/playout/start",
    { bodyLimit: largePlaylistBodyLimitBytes },
    async (request, reply) => {
      try {
        const body = startPlayoutRequestSchema.parse(request.body);
        const status = await context.playout.start(body);
        await recordSessionStart(context, body, status, "broadcast session start");
        return status;
      } catch (error) {
        return playoutErrorReply(reply, error);
      }
    },
  );

  app.post(
    "/api/playout/take",
    { bodyLimit: largePlaylistBodyLimitBytes },
    async (request, reply) => {
      try {
        const body = startPlayoutRequestSchema.parse(request.body);
        const status = await context.playout.take(body);
        await recordSessionStart(context, body, status, "hot-take session start");
        return status;
      } catch (error) {
        return playoutErrorReply(reply, error);
      }
    },
  );

  app.post("/api/playout/stop", async () => context.playout.stop());

  app.put(
    "/api/playout/next-playlist",
    { bodyLimit: largePlaylistBodyLimitBytes },
    async (request, reply) => {
      try {
        const body = updateNextPlaylistRequestSchema.parse(request.body);
        return context.playout.updateNextPlaylist(body.nextPlaylist);
      } catch (error) {
        return playoutErrorReply(reply, error);
      }
    },
  );

  app.put(
    "/api/playout/playlist",
    { bodyLimit: largePlaylistBodyLimitBytes },
    async (request, reply) => {
      try {
        const body = updateCurrentPlaylistRequestSchema.parse(request.body);
        return await context.playout.updatePlaylist(body.playlist);
      } catch (error) {
        return playoutErrorReply(reply, error);
      }
    },
  );

  app.get<{ Params: { file: string } }>(
    "/api/playout/preview/:file",
    async (request, reply) => {
      const file = request.params.file;
      if (!previewFilePattern.test(file)) {
        return reply.code(404).send({ error: "Preview file not found" });
      }

      try {
        const content = await readFile(path.join(context.previewDirectory, file));
        reply.header("cache-control", "no-store, max-age=0");
        reply.type(hlsContentType(file));
        return reply.send(content);
      } catch {
        return reply.code(404).send({ error: "Preview is not ready" });
      }
    },
  );
}

//

function playoutErrorReply(reply: FastifyReply, error: unknown) {
  if (error instanceof PlayoutConflictError) {
    return reply.code(409).send({ error: error.message });
  }
  if (error instanceof PlayoutPreflightError) {
    return reply.code(400).send({ error: error.message });
  }

  return reply.code(400).send({ error: errorMessage(error) });
}

async function recordSessionStart(
  context: RouteContext,
  request: StartPlayoutRequest,
  status: PlayoutStatus,
  label: string,
): Promise<void> {
  if (!context.database) return;

  try {
    await context.database.recordSessionStart(request, status);
  } catch (error) {
    console.error(`[DATABASE] Failed to persist ${label}`, error);
  }
}

async function syncFinishedSession(
  context: RouteContext,
  status: PlayoutStatus,
): Promise<void> {
  if (!context.database) return;
  if (!status.sessionId) return;
  if (activeStates.includes(status.state)) return;
  if (context.syncedSessions.has(status.sessionId)) return;

  await context.database.syncSession(status);
  context.syncedSessions.add(status.sessionId);
}
