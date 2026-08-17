import type { RouteContext } from "./router/context.js";

const checkpointIntervalMs = 5_000;

/**
 * Периодически переносит статус эфира в recovery checkpoint PostgreSQL.
 * Ошибка записи логируется один раз, чтобы не залить журнал при обрыве базы.
 */
export class WorkspaceCheckpoint {
  #context: RouteContext;
  #timer: NodeJS.Timeout | null = null;
  #errorReported = false;

  constructor(context: RouteContext) {
    this.#context = context;
  }

  start(intervalMs = checkpointIntervalMs): void {
    if (this.#timer) return;

    this.#timer = setInterval(() => void this.#sync(), intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (!this.#timer) return;

    clearInterval(this.#timer);
    this.#timer = null;
  }

  async #sync(): Promise<void> {
    const database = this.#context.database;
    if (!database) return;

    try {
      await database.syncWorkspaceCheckpoint(this.#context.playout.getStatus());
      this.#errorReported = false;
    } catch (error) {
      this.#reportOnce(error);
    }
  }

  #reportOnce(error: unknown): void {
    if (this.#errorReported) return;

    console.error("[DATABASE] Failed to update recovery checkpoint", error);
    this.#errorReported = true;
  }
}
