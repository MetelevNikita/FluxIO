import type { FastifyInstance } from "fastify";

//

import {
  probeMediaRequestSchema,
  scanMediaRequestSchema,
  startClipPreviewRequestSchema,
  startCompositeClipPreviewRequestSchema,
  type MediaProbe,
  type StartPlayoutRequest,
} from "@gruber/contracts";
import { probeMedia, scanMediaDirectory } from "../../ffmpeg/probe.js";
import {
  badRequest,
  largePlaylistBodyLimitBytes,
  notFound,
  type RouteContext,
} from "../context.js";

export async function mediaRoute(app: FastifyInstance, context: RouteContext) {
  app.post("/api/media/probe", async (request, reply) => {
    try {
      const body = probeMediaRequestSchema.parse(request.body);
      return { items: await probeRegisteredPaths(context, body.paths) };
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.post("/api/media/scan", async (request, reply) => {
    try {
      const body = scanMediaRequestSchema.parse(request.body);
      const paths = await scanMediaDirectory(body.directoryPath);
      return { items: await probeRegisteredPaths(context, paths) };
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.get<{ Querystring: { at?: string; path?: string } }>(
    "/api/media/thumbnail",
    async (request, reply) => {
      const filePath = request.query.path;
      if (!filePath) {
        return reply.code(400).send({ error: "Media path is required" });
      }

      const at = request.query.at == null ? undefined : Number(request.query.at);
      if (at != null && (!Number.isFinite(at) || at < 0)) {
        return reply.code(400).send({ error: "Thumbnail time must be non-negative" });
      }

      try {
        const content = await context.mediaPreview.thumbnail(filePath, at);
        reply.header("cache-control", "private, max-age=86400");
        reply.type("image/jpeg");
        return reply.send(content);
      } catch (error) {
        return notFound(reply, error);
      }
    },
  );

  app.post("/api/media/clip-preview/start", async (request, reply) => {
    try {
      const body = startClipPreviewRequestSchema.parse(request.body);
      return await context.mediaPreview.start(body.filePath, body.startSeconds);
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.post(
    "/api/media/clip-preview/composite",
    { bodyLimit: largePlaylistBodyLimitBytes },
    async (request, reply) => {
      try {
        const body = startCompositeClipPreviewRequestSchema.parse(request.body);
        await assertBurnInSubtitlesSupported(context, body.request);
        return await context.mediaPreview.startComposite(body.request, body.startSeconds);
      } catch (error) {
        return badRequest(reply, error);
      }
    },
  );

  app.post("/api/media/clip-preview/stop", async () => {
    await context.mediaPreview.stop();
    return { stopped: true };
  });

  app.get<{ Params: { sessionId: string; file: string } }>(
    "/api/media/clip-preview/:sessionId/:file",
    async (request, reply) => {
      try {
        const content = await context.mediaPreview.readPreviewFile(
          request.params.sessionId,
          request.params.file,
        );
        reply.header("cache-control", "no-store, max-age=0");
        reply.type(hlsContentType(request.params.file));
        return reply.send(content);
      } catch (error) {
        return notFound(reply, error);
      }
    },
  );
}

//

async function probeRegisteredPaths(
  context: RouteContext,
  paths: string[],
): Promise<MediaProbe[]> {
  const probes: MediaProbe[] = [];

  for (const filePath of paths) {
    const probe = await probeMedia(filePath, context.capabilities.ffprobePath);
    context.mediaPreview.register(probe.filePath, probe.durationSeconds);
    probes.push(probe);
  }

  return probes;
}

/**
 * Превью строит тот же слоёный граф, что и эфир. Без libass фильтр subtitles
 * отсутствует и FFmpeg падает невнятным "AVFilterGraph: No such filter".
 */
async function assertBurnInSubtitlesSupported(
  context: RouteContext,
  request: StartPlayoutRequest,
): Promise<void> {
  if (request.subtitleOutput.mode !== "burn-in") return;
  if (!request.playlist.some((item) => item.subtitles?.enabled)) return;

  const capabilities = await context.capabilities.get();
  if (capabilities.supports.burnInSubtitles) return;

  throw new Error(
    "This FFmpeg build has no 'subtitles' filter, so burn-in captions cannot be previewed. " +
      "Install a libass-enabled build (on macOS: brew install ffmpeg-full), " +
      "switch Subtitle output to DVB, or turn SRT off for this clip.",
  );
}

export function hlsContentType(file: string): string {
  return file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t";
}
