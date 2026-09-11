import type { FastifyInstance } from "fastify";

//

import {
  parseScheduleRequestSchema,
  serializeScheduleRequestSchema,
} from "@gruber/contracts";
import { parseScheduleFile } from "../../schedule/parser.js";
import { serializeSchedule } from "../../schedule/serializer.js";
import { badRequest, largePlaylistBodyLimitBytes } from "../context.js";

export async function scheduleRoute(app: FastifyInstance) {
  app.post("/api/schedule/parse", async (request, reply) => {
    try {
      const body = parseScheduleRequestSchema.parse(request.body);
      return await parseScheduleFile(body.filePath);
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  // Сюда приходит всё расписание целиком — и на «Сохранить .txt», и на каждое
  // автосохранение в FluxIO Sessions. Неделя в мегабайт по умолчанию не влезает:
  // служба отвечала 413, а браузер, не успевший дослать тело, — «Failed to fetch».
  app.post("/api/schedule/serialize", { bodyLimit: largePlaylistBodyLimitBytes }, async (request, reply) => {
    try {
      return serializeSchedule(serializeScheduleRequestSchema.parse(request.body));
    } catch (error) {
      return badRequest(reply, error);
    }
  });
}
