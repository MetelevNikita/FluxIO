import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

//

import {
  cacheControlFor,
  contentTypeFor,
  isApplicationRoute,
  resolveWebAsset,
} from "../../web/static.js";
import type { RouteContext } from "../context.js";

/* -------------------------------------------------------------------------- *
 * Интерфейс оператора по сети.
 *
 * Регистрируется только в серверном профиле — когда мастер указал каталог
 * собранного интерфейса. На рабочем месте его отдаёт Electron из своих
 * ресурсов, и второй раздачи не нужно.
 * ------------------------------------------------------------------------- */

export async function webRoute(app: FastifyInstance, context: RouteContext) {
  const root = context.webDirectory;
  if (!root) return;

  app.get("/", async (request, reply) => sendAsset(reply, root, "/", request.url));
  app.get("/*", async (request, reply) => sendAsset(reply, root, request.url, request.url));
}

async function sendAsset(
  reply: { code: (status: number) => typeof reply; header: (name: string, value: string) => typeof reply; send: (payload: unknown) => unknown },
  root: string,
  urlPath: string,
  originalUrl: string,
): Promise<unknown> {
  const resolved = resolveWebAsset(root, urlPath);
  if (!resolved) return reply.code(400).send({ error: "Некорректный путь" });

  const file = await readableFile(resolved);
  if (file) return streamFile(reply, resolved);

  // Внутренний экран приложения: файла на диске нет, но отдавать 404 нельзя —
  // оператор по прямой ссылке увидел бы пустую страницу вместо интерфейса.
  if (isApplicationRoute(originalUrl)) {
    const index = path.join(root, "index.html");
    if (await readableFile(index)) return streamFile(reply, index);
  }
  return reply.code(404).send({ error: "Файл интерфейса не найден" });
}

function streamFile(
  reply: { header: (name: string, value: string) => typeof reply; send: (payload: unknown) => unknown },
  filePath: string,
): unknown {
  return reply
    .header("content-type", contentTypeFor(filePath))
    .header("cache-control", cacheControlFor(filePath))
    .send(createReadStream(filePath));
}

async function readableFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
