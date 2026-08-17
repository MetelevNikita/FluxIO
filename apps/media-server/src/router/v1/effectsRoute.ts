import type { FastifyInstance } from "fastify";

//

import {
  analyzeGraphicEffectsRequestSchema,
  graphicEffectAssetListSchema,
  graphicEffectAssetSchema,
  lottieSourceRequestSchema,
  renderLottieEffectRequestSchema,
  scanGraphicEffectsRequestSchema,
} from "@gruber/contracts";
import {
  analyzeGraphicEffectPaths,
  scanGraphicEffectDirectory,
} from "../../effects/library.js";
import {
  lottieWasmBytes,
  readRenderableLottieDocument,
  rerenderLottieEffect,
} from "../../effects/lottie.js";
import { badRequest, type RouteContext } from "../context.js";

export async function effectsRoute(app: FastifyInstance, context: RouteContext) {
  app.post("/api/effects/analyze", async (request, reply) => {
    try {
      const body = analyzeGraphicEffectsRequestSchema.parse(request.body);
      const items = await analyzeGraphicEffectPaths(
        body.paths,
        context.capabilities.ffprobePath,
        context.capabilities.ffmpegPath,
      );

      return graphicEffectAssetListSchema.parse({ items });
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.post("/api/effects/scan", async (request, reply) => {
    try {
      const body = scanGraphicEffectsRequestSchema.parse(request.body);
      const items = await scanGraphicEffectDirectory(
        body.directoryPath,
        context.capabilities.ffprobePath,
        context.capabilities.ffmpegPath,
      );

      return graphicEffectAssetListSchema.parse({ items });
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.get("/api/effects/lottie/wasm", async (_request, reply) => {
    return reply.type("application/wasm").send(await lottieWasmBytes());
  });

  app.post("/api/effects/lottie/source", async (request, reply) => {
    try {
      const body = lottieSourceRequestSchema.parse(request.body);
      return { document: await readRenderableLottieDocument(body.sourcePath) };
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.put("/api/effects/lottie/render", async (request, reply) => {
    try {
      const body = renderLottieEffectRequestSchema.parse(request.body);
      const effect = await rerenderLottieEffect(
        body.effect,
        context.capabilities.ffmpegPath,
        context.effectCacheDirectory,
      );

      return graphicEffectAssetSchema.parse(effect);
    } catch (error) {
      return badRequest(reply, error);
    }
  });
}
