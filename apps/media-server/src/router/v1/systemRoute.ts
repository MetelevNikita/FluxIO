import type { FastifyInstance } from "fastify";

//

import {
  networkInterfaceListSchema,
  serviceHealthSchema,
  systemMetricsSchema,
  type ServiceHealth,
} from "@gruber/contracts";
import { listNetworkInterfaces } from "../../network-interfaces.js";
import { errorMessage, type RouteContext } from "../context.js";

export const serviceVersion = "7.0.12";

const streamingStates = ["starting", "running", "stopping"];

export async function systemRoute(app: FastifyInstance, context: RouteContext) {
  app.get("/api/health", async (): Promise<ServiceHealth> => {
    return serviceHealthSchema.parse({
      service: "gruber-media-server",
      version: serviceVersion,
      apiVersion: "v1",
      status: context.database ? "ready" : "degraded",
      startedAt: context.startedAt,
    });
  });

  app.get("/api/capabilities", async (_request, reply) => {
    try {
      return await context.capabilities.get();
    } catch (error) {
      return reply.code(503).send({ error: errorMessage(error) });
    }
  });

  app.get("/api/system/metrics", async () => {
    const status = context.playout.getStatus();
    const streamingMbps = streamingStates.includes(status.state)
      ? status.bitrateKbps / 1_000
      : 0;

    return systemMetricsSchema.parse(context.systemMetrics.sample(streamingMbps));
  });

  app.get("/api/system/network-interfaces", async () => {
    return networkInterfaceListSchema.parse({ items: listNetworkInterfaces() });
  });
}
