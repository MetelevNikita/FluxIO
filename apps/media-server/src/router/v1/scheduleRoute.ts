import type { FastifyInstance } from "fastify";

//

import {
  parseScheduleRequestSchema,
  serializeScheduleRequestSchema,
} from "@gruber/contracts";
import { parseScheduleFile } from "../../schedule/parser.js";
import { serializeSchedule } from "../../schedule/serializer.js";
import { badRequest } from "../context.js";

export async function scheduleRoute(app: FastifyInstance) {
  app.post("/api/schedule/parse", async (request, reply) => {
    try {
      const body = parseScheduleRequestSchema.parse(request.body);
      return await parseScheduleFile(body.filePath);
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.post("/api/schedule/serialize", async (request, reply) => {
    try {
      return serializeSchedule(serializeScheduleRequestSchema.parse(request.body));
    } catch (error) {
      return badRequest(reply, error);
    }
  });
}
