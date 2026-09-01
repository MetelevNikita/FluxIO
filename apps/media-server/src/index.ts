import { buildApp } from "./app.js";
import { installBrokenPipeGuard } from "./ffmpeg/pipe-errors.js";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

try {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
    throw error;
  }
}

function readPort(value: string | undefined): number {
  const port = Number(value ?? "4310");

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid GRUBER_PORT: ${value ?? ""}`);
  }

  return port;
}

const app = buildApp({
  logger: false,
});

// Труба, закрывшаяся без обработчика, уносила службу целиком: эфир обрывался
// на середине ролика, а в журнале не оставалось ни строки. Пропущенный кадр
// дешевле пропущенного эфира.
const stopBrokenPipeGuard = installBrokenPipeGuard((message) => {
  console.error(`[MEDIA] ${message}`);
  app.applicationLogger.log("error", "SERVICE", message);
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.info(`[MEDIA] Graceful shutdown requested (${signal})`);
  stopBrokenPipeGuard();
  await app.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  const address = await app.listen({
    host: process.env.GRUBER_HOST ?? "127.0.0.1",
    port: readPort(process.env.GRUBER_PORT),
  });
  console.info(`[MEDIA] Active at ${address}; waiting for playout`);
} catch (error) {
  console.error("[MEDIA] Failed to start media-service", error);
  process.exitCode = 1;
}
