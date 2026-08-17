import type { FastifyInstance } from "fastify";

//

import { workspaceSessionSaveRequestSchema } from "@gruber/contracts";
import {
  badRequest,
  databaseUnavailable,
  largePlaylistBodyLimitBytes,
  type RouteContext,
} from "../context.js";

export async function workspaceRoute(app: FastifyInstance, context: RouteContext) {
  app.get("/api/workspace-session", async (_request, reply) => {
    const database = context.database;
    if (!database) return databaseUnavailable(reply);

    return { session: await database.getWorkspaceSession(context.playout.getStatus()) };
  });

  app.put(
    "/api/workspace-session",
    { bodyLimit: largePlaylistBodyLimitBytes },
    async (request, reply) => {
      const database = context.database;
      if (!database) return databaseUnavailable(reply);

      try {
        const body = workspaceSessionSaveRequestSchema.parse(request.body);
        return await database.saveWorkspaceSession(body, context.playout.getStatus());
      } catch (error) {
        return badRequest(reply, error);
      }
    },
  );

  app.delete("/api/workspace-session", async (_request, reply) => {
    const database = context.database;
    if (!database) return databaseUnavailable(reply);

    await database.deleteWorkspaceSession();
    return reply.code(204).send();
  });
}
