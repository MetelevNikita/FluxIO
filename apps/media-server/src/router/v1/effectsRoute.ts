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
  imageSequenceRequestSchema,
  imageSequenceSchema,
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
import { probeMedia } from "../../ffmpeg/probe.js";
import { readImageSequence } from "../../effects/image-sequence.js";
import { badRequest, type RouteContext } from "../context.js";

export async function effectsRoute(app: FastifyInstance, context: RouteContext) {
  app.post("/api/effects/analyze", async (request, reply) => {
    try {
      const body = analyzeGraphicEffectsRequestSchema.parse(request.body);
      const result = await analyzeGraphicEffectPathsPartial(
        body.paths,
        context.capabilities.ffprobePath,
      );

      return graphicEffectImportResultSchema.parse(result);
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  /**
   * Разбор последовательности кадров. Оператор выбирает любой кадр, шаблон
   * нумерации и границы диапазона выводятся из его имени и соседей в каталоге.
   */
  app.post("/api/effects/sequence", async (request, reply) => {
    try {
      const body = imageSequenceRequestSchema.parse(request.body);
      const sequence = await readImageSequence(body.framePath);
      // Размер берётся с первого кадра: у последовательности он одинаков у
      // всех, а альфа у .png есть всегда — проверять её нечем и незачем.
      const probe = await probeMedia(
        sequence.firstFramePath,
        context.capabilities.ffprobePath,
      ).catch(() => null);
      return imageSequenceSchema.parse({
        ...sequence,
        width: probe?.width ?? 0,
        height: probe?.height ?? 0,
      });
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
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
