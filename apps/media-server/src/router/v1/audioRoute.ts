import type { FastifyInstance } from "fastify";

//

import { scanAudioTracksRequestSchema } from "@gruber/contracts";
import { scanAudioTracks } from "../../audio/tracks.js";
import { badRequest, largePlaylistBodyLimitBytes } from "../context.js";

export async function audioRoute(app: FastifyInstance) {
  app.post(
    "/api/audio-tracks/scan",
    { bodyLimit: largePlaylistBodyLimitBytes },
    async (request, reply) => {
      try {
        const body = scanAudioTracksRequestSchema.parse(request.body);
        return await scanAudioTracks(body.directoryPath, body.mediaPaths);
      } catch (error) {
        return badRequest(reply, error);
      }
    },
  );
}
