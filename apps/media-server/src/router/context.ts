import type { FastifyReply } from "fastify";

//

import { DatabaseService } from "../database/database.js";
import { FfmpegCapabilitiesService } from "../ffmpeg/capabilities.js";
import { MediaPreviewService } from "../ffmpeg/media-preview.js";
import { PlayoutSupervisor } from "../ffmpeg/playout-supervisor.js";
import { SystemMetricsSampler } from "../system-metrics.js";

export const largePlaylistBodyLimitBytes = 32 * 1_024 * 1_024;

export interface RouteContext {
  capabilities: FfmpegCapabilitiesService;
  database: DatabaseService | null;
  effectCacheDirectory: string;
  mediaPreview: MediaPreviewService;
  playout: PlayoutSupervisor;
  previewDirectory: string;
  startedAt: string;
  syncedSessions: Set<string>;
  systemMetrics: SystemMetricsSampler;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function badRequest(reply: FastifyReply, error: unknown) {
  return reply.code(400).send({ error: errorMessage(error) });
}

export function notFound(reply: FastifyReply, error: unknown) {
  return reply.code(404).send({ error: errorMessage(error) });
}

export function databaseUnavailable(reply: FastifyReply) {
  return reply.code(503).send({
    error: "PostgreSQL is not configured. Set DATABASE_URL and run migrations.",
  });
}
