import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { tmpdir } from "node:os";
import path from "node:path";

//

import { DatabaseService } from "./database/database.js";
import { FfmpegCapabilitiesService } from "./ffmpeg/capabilities.js";
import { MediaPreviewService } from "./ffmpeg/media-preview.js";
import { PlayoutSupervisor } from "./ffmpeg/playout-supervisor.js";
import { SystemMetricsSampler } from "./system-metrics.js";
import { type RouteContext } from "./router/context.js";
import { audioRoute } from "./router/v1/audioRoute.js";
import { configurationsRoute } from "./router/v1/configurationsRoute.js";
import { effectsRoute } from "./router/v1/effectsRoute.js";
import { mediaRoute } from "./router/v1/mediaRoute.js";
import { playoutRoute } from "./router/v1/playoutRoute.js";
import { scheduleRoute } from "./router/v1/scheduleRoute.js";
import { systemRoute } from "./router/v1/systemRoute.js";
import { workspaceRoute } from "./router/v1/workspaceRoute.js";
import { WorkspaceCheckpoint } from "./workspace-checkpoint.js";

export function buildApp(options: FastifyServerOptions = {}) {
  const app = Fastify(options);
  const context = createRouteContext();
  const checkpoint = new WorkspaceCheckpoint(context);

  app.addHook("onRequest", async (request, reply) => {
    applyCorsHeaders(request.headers.origin, reply);

    if (request.method === "OPTIONS") {
      await reply.code(204).send();
    }
  });

  app.addHook("onReady", async () => {
    if (!context.database) return;

    await context.database.connect();
    checkpoint.start();
  });

  app.addHook("onClose", async () => {
    checkpoint.stop();
    await closeServices(context);
  });

  registerRoutes(app, context);

  return app;
}

//
// Состав сервера: зависимости маршрутов и их регистрация
//

function createRouteContext(): RouteContext {
  const capabilities = new FfmpegCapabilitiesService();
  const previewDirectory = process.env.GRUBER_PREVIEW_DIR ??
    path.join(tmpdir(), "gruber-playout-preview");

  return {
    capabilities,
    database: DatabaseService.fromEnvironment(),
    effectCacheDirectory: process.env.GRUBER_EFFECT_CACHE_DIR ??
      path.join(tmpdir(), "gruber-playout-effects"),
    mediaPreview: new MediaPreviewService(
      capabilities.ffmpegPath,
      path.join(tmpdir(), "gruber-media-preview"),
    ),
    playout: new PlayoutSupervisor(
      capabilities,
      previewDirectory,
      (entry) => console.info(`[PLAYOUT] ${entry}`),
    ),
    previewDirectory,
    startedAt: new Date().toISOString(),
    syncedSessions: new Set<string>(),
    systemMetrics: new SystemMetricsSampler(),
  };
}

function registerRoutes(app: FastifyInstance, context: RouteContext): void {
  void app.register(systemRoute, context);
  void app.register(mediaRoute, context);
  void app.register(effectsRoute, context);
  void app.register(audioRoute, context);
  void app.register(scheduleRoute, context);
  void app.register(playoutRoute, context);
  void app.register(workspaceRoute, context);
  void app.register(configurationsRoute, context);
}

async function closeServices(context: RouteContext): Promise<void> {
  if (context.database) {
    await context.database.syncWorkspaceCheckpoint(context.playout.getStatus());
  }

  await context.mediaPreview.close();
  await context.playout.close();

  if (context.database) {
    await context.database.disconnect();
  }
}

//
// CORS: разрешён только локальный Electron-клиент
//

function applyCorsHeaders(
  origin: string | undefined,
  reply: { header: (name: string, value: string) => unknown },
): void {
  if (!origin) return;
  if (!isAllowedOrigin(origin)) return;

  reply.header("access-control-allow-origin", origin);
  reply.header("vary", "Origin");
  reply.header("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  reply.header("access-control-allow-headers", "content-type");
}

function isAllowedOrigin(origin: string): boolean {
  return origin === "null" || /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin);
}
