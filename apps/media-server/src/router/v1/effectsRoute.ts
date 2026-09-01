import type { FastifyInstance } from "fastify";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

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
  vectorLayerImportRequestSchema,
  vectorLayerImportSchema,
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
import { probeMedia } from "../../ffmpeg/probe.js";
import { readImageSequence } from "../../effects/image-sequence.js";
import { importVectorLayers } from "../../effects/vector-import.js";
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

  app.post("/api/effects/vector-layers", async (request, reply) => {
    try {
      const body = vectorLayerImportRequestSchema.parse(request.body);
      return vectorLayerImportSchema.parse(
        await importVectorLayers(body.filePath, context.effectCacheDirectory),
      );
    } catch (error) {
      return badRequest(reply, error);
    }
  });

  app.get("/api/effects/vector-layer-preview", async (request, reply) => {
    try {
      const { filePath } = vectorLayerImportRequestSchema.parse(request.query);
      const root = await realpath(path.join(context.effectCacheDirectory, "vector-layers"));
      const resolved = await realpath(filePath);
      const relative = path.relative(root, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative) || path.extname(resolved).toLowerCase() !== ".png") {
        throw new Error("Vector preview path is outside the import cache");
      }
      reply.header("cache-control", "private, max-age=86400");
      return reply.type("image/png").send(await readFile(resolved));
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

  // Список системных шрифтов с признаком кириллицы: шрифт без кириллицы
  // выдаёт в эфир пустые прямоугольники. Список кешируется службой: разбор
  // читает каждый файл шрифта целиком и на Windows стоит секунд.
  app.get("/api/effects/fonts", async (_request, reply) => {
    try {
      return systemFontListSchema.parse({ items: await context.systemFonts.get() });
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
