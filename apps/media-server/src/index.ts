import { buildApp } from "./app.js";
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

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.info(`[MEDIA] Graceful shutdown requested (${signal})`);
  await app.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({
    host: process.env.GRUBER_HOST ?? "127.0.0.1",
    port: readPort(process.env.GRUBER_PORT),
  });
} catch (error) {
  console.error("[MEDIA] Failed to start media-service", error);
  process.exitCode = 1;
}
