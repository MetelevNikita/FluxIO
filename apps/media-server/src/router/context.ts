import type { FastifyReply } from "fastify";

//

import { DatabaseService } from "../database/database.js";
import type { SystemFontsService } from "../effects/system-fonts.js";
import { FfmpegCapabilitiesService } from "../ffmpeg/capabilities.js";
import { MediaPreviewService } from "../ffmpeg/media-preview.js";
import { PlayoutSupervisor } from "../ffmpeg/playout-supervisor.js";
import type { ApplicationLogger } from "../logging/logger.js";
import { SystemMetricsSampler } from "../system-metrics.js";

export const largePlaylistBodyLimitBytes = 32 * 1_024 * 1_024;

export interface RouteContext {
  capabilities: FfmpegCapabilitiesService;
  database: DatabaseService | null;
  effectCacheDirectory: string;
  mediaPreview: MediaPreviewService;
  playout: PlayoutSupervisor;
  logger: ApplicationLogger;
  previewDirectory: string;
  startedAt: string;
  syncedSessions: Set<string>;
  systemFonts: SystemFontsService;
  systemMetrics: SystemMetricsSampler;
  /** Каталог собранного интерфейса; null — раздаёт Electron, а не служба. */
  webDirectory: string | null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Короткая причина отказа для журнала.
 *
 * Zod отдаёт весь разбор целиком — на снимке рабочей области это тысячи строк,
 * и в журнале от них нет пользы. Оператору нужно одно: какое поле и чем не
 * устроило.
 */
export function describeValidationError(error: unknown, limit = 3): string {
  const issues = (error as { issues?: { path?: unknown[]; message?: string }[] } | null)?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return errorMessage(error);
  const listed = issues
    .slice(0, limit)
    .map((issue) => `${(issue.path ?? []).join(".") || "снимок"}: ${issue.message ?? "?"}`)
    .join("; ");
  return issues.length > limit ? `${listed}; ещё ${issues.length - limit}` : listed;
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
