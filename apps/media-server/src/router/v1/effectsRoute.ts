import type { FastifyInstance } from "fastify";
import { stat } from "node:fs/promises";

//

import {
  analyzeGraphicEffectsRequestSchema,
  graphicEffectImportResultSchema,
  graphicEffectVerificationSchema,
  readBroadcastTaskRequestSchema,
  readTickerFeedRequestSchema,
  readTickerSourceRequestSchema,
  systemFontListSchema,
  verifyGraphicEffectsRequestSchema,
  graphicEffectAssetSchema,
  lottieSourceRequestSchema,
  renderLottieEffectRequestSchema,
  scanGraphicEffectsRequestSchema,
} from "@gruber/contracts";
import {
  analyzeGraphicEffectPathsPartial,
  scanGraphicEffectDirectory,
} from "../../effects/library.js";
import {
  readBroadcastTaskFile,
  readTickerFeed,
  readTickerSourceFile,
} from "../../effects/broadcast-task.js";
import { scanSystemFonts } from "../../effects/system-fonts.js";
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
      const result = await analyzeGraphicEffectPathsPartial(
        body.paths,
        context.capabilities.ffprobePath,
        context.capabilities.ffmpegPath,
      );

      return graphicEffectImportResultSchema.parse(result);
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.post("/api/effects/scan", async (request, reply) => {
    try {
      const body = scanGraphicEffectsRequestSchema.parse(request.body);
      const result = await scanGraphicEffectDirectory(
        body.directoryPath,
        context.capabilities.ffprobePath,
        context.capabilities.ffmpegPath,
      );

      return graphicEffectImportResultSchema.parse(result);
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  // Графика расписания живёт на диске сервера, а не в базе: перед работой с
  // восстановленным или импортированным расписанием интерфейс спрашивает, какие
  // файлы пропали, чтобы предложить оператору замену.
  app.post("/api/effects/verify", async (request, reply) => {
    try {
      const body = verifyGraphicEffectsRequestSchema.parse(request.body);
      const missing: string[] = [];
      for (const filePath of new Set(body.paths)) {
        if (!(await isReadableFile(filePath))) missing.push(filePath);
      }

      return graphicEffectVerificationSchema.parse({ missing });
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  // Файлы данных эффектов второго уровня читает сервер: интерфейс знает только
  // путь, выбранный в нативном диалоге, и не имеет доступа к файловой системе.
  app.post("/api/effects/broadcast/task", async (request, reply) => {
    try {
      const body = readBroadcastTaskRequestSchema.parse(request.body);
      return await readBroadcastTaskFile(body.filePath);
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.post("/api/effects/broadcast/ticker-source", async (request, reply) => {
    try {
      const body = readTickerSourceRequestSchema.parse(request.body);
      return await readTickerSourceFile(body.filePath);
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.post("/api/effects/broadcast/ticker-feed", async (request, reply) => {
    try {
      const body = readTickerFeedRequestSchema.parse(request.body);
      return await readTickerFeed(body.url, body.limit);
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  // Список системных шрифтов с признаком кириллицы: drawtext рисует конкретным
  // файлом, а шрифт без кириллицы выдаёт в эфир пустые прямоугольники.
  app.get("/api/effects/fonts", async (_request, reply) => {
    try {
      return systemFontListSchema.parse({ items: await scanSystemFonts() });
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

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
