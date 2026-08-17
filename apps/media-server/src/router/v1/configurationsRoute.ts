import type { FastifyInstance } from "fastify";

//

import {
  saveBroadcastConfigurationRequestSchema,
  type MediaProbe,
} from "@gruber/contracts";
import { probeMedia } from "../../ffmpeg/probe.js";
import {
  badRequest,
  databaseUnavailable,
  notFound,
  type RouteContext,
} from "../context.js";

export async function configurationsRoute(app: FastifyInstance, context: RouteContext) {
  app.get("/api/configurations", async (_request, reply) => {
    const database = context.database;
    if (!database) return databaseUnavailable(reply);

    return { items: await database.listConfigurations() };
  });

  app.get<{ Params: { id: string } }>(
    "/api/configurations/:id",
    async (request, reply) => {
      const database = context.database;
      if (!database) return databaseUnavailable(reply);

      try {
        return await database.getConfiguration(request.params.id);
      } catch (error) {
        return notFound(reply, error);
      }
    },
  );

  app.put("/api/configurations", async (request, reply) => {
    const database = context.database;
    if (!database) return databaseUnavailable(reply);

    try {
      const body = saveBroadcastConfigurationRequestSchema.parse(request.body);
      const probes = await probePlaylist(context, body.playlist);
      return await database.saveConfiguration(body, probes);
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>(
    "/api/configurations/:id",
    async (request, reply) => {
      const database = context.database;
      if (!database) return databaseUnavailable(reply);

      try {
        await database.deleteConfiguration(request.params.id);
        return reply.code(204).send();
      } catch (error) {
        return notFound(reply, error);
      }
    },
  );
}

//

async function probePlaylist(
  context: RouteContext,
  playlist: { filePath: string }[],
): Promise<MediaProbe[]> {
  const probes: MediaProbe[] = [];

  for (const item of playlist) {
    probes.push(await probeMedia(item.filePath, context.capabilities.ffprobePath));
  }

  return probes;
}
