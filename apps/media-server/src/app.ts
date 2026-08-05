import Fastify, { type FastifyServerOptions } from "fastify";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  saveBroadcastConfigurationRequestSchema,
  networkInterfaceListSchema,
  probeMediaRequestSchema,
  scanMediaRequestSchema,
  serviceHealthSchema,
  startPlayoutRequestSchema,
  startClipPreviewRequestSchema,
  systemMetricsSchema,
  type ServiceHealth,
} from "@gruber/contracts";
import { DatabaseService } from "./database/database.js";
import { FfmpegCapabilitiesService } from "./ffmpeg/capabilities.js";
import {
  PlayoutConflictError,
  PlayoutPreflightError,
  PlayoutSupervisor,
} from "./ffmpeg/playout-supervisor.js";
import { probeMedia, scanMediaDirectory } from "./ffmpeg/probe.js";
import { MediaPreviewService } from "./ffmpeg/media-preview.js";
import { SystemMetricsSampler } from "./system-metrics.js";
import { listNetworkInterfaces } from "./network-interfaces.js";

const serviceVersion = "4.2.3";

export function buildApp(options: FastifyServerOptions = {}) {
  const startedAt = new Date().toISOString();
  const app = Fastify(options);
  const capabilities = new FfmpegCapabilitiesService();
  const database = DatabaseService.fromEnvironment();
  const syncedSessions = new Set<string>();
  const previewDirectory = process.env.GRUBER_PREVIEW_DIR ??
    path.join(tmpdir(), "gruber-playout-preview");
  const mediaPreview = new MediaPreviewService(
    capabilities.ffmpegPath,
    path.join(tmpdir(), "gruber-media-preview"),
  );
  const playout = new PlayoutSupervisor(
    capabilities,
    previewDirectory,
    (entry) => console.info(`[PLAYOUT] ${entry}`),
  );
  const systemMetrics = new SystemMetricsSampler();

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "Origin");
      reply.header("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
      reply.header("access-control-allow-headers", "content-type");
    }
    if (request.method === "OPTIONS") {
      await reply.code(204).send();
    }
  });

  app.get("/api/health", async (): Promise<ServiceHealth> => {
    return serviceHealthSchema.parse({
      service: "gruber-media-server",
      version: serviceVersion,
      apiVersion: "v1",
      status: database ? "ready" : "degraded",
      startedAt,
    });
  });

  app.addHook("onReady", async () => {
    if (database) {
      await database.connect();
    }
  });

  app.get("/api/capabilities", async (_request, reply) => {
    try {
      return await capabilities.get();
    } catch (error) {
      return reply.code(503).send({ error: errorMessage(error) });
    }
  });

  app.get("/api/system/metrics", async () => {
    const status = playout.getStatus();
    const isStreaming = ["starting", "running", "stopping"].includes(status.state);
    return systemMetricsSchema.parse(
      systemMetrics.sample(isStreaming ? status.bitrateKbps / 1_000 : 0),
    );
  });

  app.get("/api/system/network-interfaces", async () => {
    return networkInterfaceListSchema.parse({ items: listNetworkInterfaces() });
  });

  app.post("/api/media/probe", async (request, reply) => {
    try {
      const body = probeMediaRequestSchema.parse(request.body);
      const probes = [];
      for (const filePath of body.paths) {
        const probe = await probeMedia(filePath, capabilities.ffprobePath);
        mediaPreview.register(probe.filePath, probe.durationSeconds);
        probes.push(probe);
      }
      return { items: probes };
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.post("/api/media/scan", async (request, reply) => {
    try {
      const body = scanMediaRequestSchema.parse(request.body);
      const paths = await scanMediaDirectory(body.directoryPath);
      const probes = [];
      for (const filePath of paths) {
        const probe = await probeMedia(filePath, capabilities.ffprobePath);
        mediaPreview.register(probe.filePath, probe.durationSeconds);
        probes.push(probe);
      }
      return { items: probes };
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.get<{ Querystring: { at?: string; path?: string } }>(
    "/api/media/thumbnail",
    async (request, reply) => {
      try {
        const filePath = request.query.path;
        if (!filePath) return reply.code(400).send({ error: "Media path is required" });
        const at = request.query.at == null ? undefined : Number(request.query.at);
        if (at != null && (!Number.isFinite(at) || at < 0)) {
          return reply.code(400).send({ error: "Thumbnail time must be non-negative" });
        }
        const content = await mediaPreview.thumbnail(filePath, at);
        reply.header("cache-control", "private, max-age=86400");
        reply.type("image/jpeg");
        return reply.send(content);
      } catch (error) {
        return reply.code(404).send({ error: errorMessage(error) });
      }
    },
  );

  app.post("/api/media/clip-preview/start", async (request, reply) => {
    try {
      const body = startClipPreviewRequestSchema.parse(request.body);
      return await mediaPreview.start(body.filePath, body.startSeconds);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.post("/api/media/clip-preview/stop", async () => {
    await mediaPreview.stop();
    return { stopped: true };
  });

  app.get<{ Params: { sessionId: string; file: string } }>(
    "/api/media/clip-preview/:sessionId/:file",
    async (request, reply) => {
      try {
        const content = await mediaPreview.readPreviewFile(
          request.params.sessionId,
          request.params.file,
        );
        reply.header("cache-control", "no-store, max-age=0");
        reply.type(request.params.file.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : "video/mp2t");
        return reply.send(content);
      } catch (error) {
        return reply.code(404).send({ error: errorMessage(error) });
      }
    },
  );

  app.get("/api/playout/status", async () => {
    const status = playout.getStatus();
    if (
      database &&
      status.sessionId &&
      !["starting", "running", "stopping"].includes(status.state) &&
      !syncedSessions.has(status.sessionId)
    ) {
      await database.syncSession(status);
      syncedSessions.add(status.sessionId);
    }
    return status;
  });

  app.post("/api/playout/start", async (request, reply) => {
    try {
      const body = startPlayoutRequestSchema.parse(request.body);
      const status = await playout.start(body);
      if (database) {
        try {
          await database.recordSessionStart(body, status);
        } catch (error) {
          console.error("[DATABASE] Failed to persist broadcast session start", error);
        }
      }
      return status;
    } catch (error) {
      if (error instanceof PlayoutConflictError) {
        return reply.code(409).send({ error: error.message });
      }
      if (error instanceof PlayoutPreflightError) {
        return reply.code(400).send({ error: error.message });
      }
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.post("/api/playout/stop", async () => playout.stop());

  app.get("/api/configurations", async (_request, reply) => {
    if (!database) {
      return databaseUnavailable(reply);
    }
    return { items: await database.listConfigurations() };
  });

  app.get<{ Params: { id: string } }>(
    "/api/configurations/:id",
    async (request, reply) => {
      if (!database) {
        return databaseUnavailable(reply);
      }
      try {
        return await database.getConfiguration(request.params.id);
      } catch (error) {
        return reply.code(404).send({ error: errorMessage(error) });
      }
    },
  );

  app.put("/api/configurations", async (request, reply) => {
    if (!database) {
      return databaseUnavailable(reply);
    }
    try {
      const body = saveBroadcastConfigurationRequestSchema.parse(request.body);
      const probes = [];
      for (const item of body.playlist) {
        probes.push(await probeMedia(item.filePath, capabilities.ffprobePath));
      }
      return await database.saveConfiguration(body, probes);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.delete<{ Params: { id: string } }>(
    "/api/configurations/:id",
    async (request, reply) => {
      if (!database) {
        return databaseUnavailable(reply);
      }
      try {
        await database.deleteConfiguration(request.params.id);
        return reply.code(204).send();
      } catch (error) {
        return reply.code(404).send({ error: errorMessage(error) });
      }
    },
  );

  app.get<{ Params: { file: string } }>(
    "/api/playout/preview/:file",
    async (request, reply) => {
      const file = request.params.file;
      if (!/^(?:index\.m3u8|segment-\d{6}\.ts)$/.test(file)) {
        return reply.code(404).send({ error: "Preview file not found" });
      }
      try {
        const content = await readFile(path.join(previewDirectory, file));
        reply.header("cache-control", "no-store, max-age=0");
        reply.type(file.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : "video/mp2t");
        return reply.send(content);
      } catch {
        return reply.code(404).send({ error: "Preview is not ready" });
      }
    },
  );

  app.addHook("onClose", async () => {
    await mediaPreview.close();
    await playout.close();
    if (database) {
      await database.disconnect();
    }
  });

  return app;
}

function isAllowedOrigin(origin: string): boolean {
  return origin === "null" || /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function databaseUnavailable(reply: {
  code: (statusCode: number) => { send: (payload: unknown) => unknown };
}) {
  return reply.code(503).send({
    error: "PostgreSQL is not configured. Set DATABASE_URL and run migrations.",
  });
}
