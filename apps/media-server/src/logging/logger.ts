import { appendFile, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { PlayoutStatus } from "@gruber/contracts";
import {
  buildDailyReport,
  emptyDailyStats,
  formatLocalStamp,
  formatLogLine,
  localDateKey,
  logFileName,
  observeStatus,
  recordError,
  type DailyStats,
  type LogLevel,
} from "./daily-log.js";

/**
 * Файловый журнал приложения. Пишет на рабочий стол той машины, где запущен
 * media-service: инженер эфира должен добраться до журнала, не заходя в
 * служебные папки.
 *
 * Каждые сутки — новый файл. При смене суток в закрываемый файл дописывается
 * суточный отчёт, поэтому отчёт лежит там же, к чему относится.
 *
 * Запись асинхронная и последовательная. Любая ошибка файловой системы гасится:
 * журнал не имеет права уронить эфир.
 */
export class ApplicationLogger {
  readonly directory: string;
  #stats: DailyStats;
  #queue: Promise<void> = Promise.resolve();
  #failed = false;

  constructor(directory = defaultLogDirectory(), now = new Date()) {
    this.directory = directory;
    this.#stats = emptyDailyStats(localDateKey(now));
  }

  get stats(): DailyStats {
    return this.#stats;
  }

  serviceStarted(version: string, at = new Date()): void {
    this.#stats = { ...this.#stats, serviceStartedAt: formatLocalStamp(at) };
    this.log("info", "SERVICE", `FluxIO media-service v${version} запущен`, at);
    this.log("info", "SERVICE", `Журнал: ${path.join(this.directory, logFileName(at))}`, at);
  }

  async serviceStopping(at = new Date()): Promise<void> {
    this.log("info", "SERVICE", "FluxIO media-service останавливается", at);
    this.#write(buildDailyReport(this.#stats, at));
    await this.flush();
  }

  log(level: LogLevel, category: string, message: string, at = new Date()): void {
    this.#rollOver(at);
    if (level === "warn") this.#stats = { ...this.#stats, warnings: this.#stats.warnings + 1 };
    if (level === "error") this.#stats = recordError(this.#stats, message);
    this.#write(formatLogLine(at, level, category, message));
  }

  /** Событие эфирного контура: тот же поток, что уходит в консоль и статус. */
  playoutEvent(message: string, at = new Date()): void {
    this.log(/fail|error|ошибк/i.test(message) ? "error" : "info", "PLAYOUT", message, at);
  }

  /** Снимок состояния эфира. Из него набирается вся суточная статистика. */
  observe(status: PlayoutStatus, at = new Date()): void {
    this.#rollOver(at);
    const result = observeStatus(this.#stats, status, at);
    this.#stats = result.stats;
    for (const entry of result.entries) {
      this.#write(formatLogLine(at, entry.level, entry.category, entry.message));
    }
  }

  async flush(): Promise<void> {
    await this.#queue;
  }

  /** Смена суток: отчёт уходит в старый файл, статистика начинается заново. */
  #rollOver(at: Date): void {
    const date = localDateKey(at);
    if (date === this.#stats.date) return;
    const closing = this.#stats;
    const previousFile = `fluxio-${closing.date}.log`;
    this.#queue = this.#queue
      .then(() => this.#append(previousFile, buildDailyReport(closing, at)))
      .catch(() => undefined);
    this.#stats = { ...emptyDailyStats(date), serviceStartedAt: closing.serviceStartedAt };
  }

  #write(text: string): void {
    if (this.#failed) return;
    const fileName = `fluxio-${this.#stats.date}.log`;
    this.#queue = this.#queue
      .then(() => this.#append(fileName, text))
      .catch(() => undefined);
  }

  async #append(fileName: string, text: string): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true });
      await appendFile(path.join(this.directory, fileName), `${text}\n`, "utf8");
    } catch (error) {
      // Один раз сообщаем в консоль и больше не пытаемся: заваливать stderr
      // одинаковыми ошибками записи во время эфира бессмысленно.
      if (!this.#failed) {
        this.#failed = true;
        console.warn(
          `[LOG] Не удалось писать журнал в ${this.directory}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

/**
 * Рабочий стол текущего пользователя. Если папки нет (сервер без графической
 * оболочки, systemd-установка) — домашняя папка. Переопределяется
 * `GRUBER_LOG_DIR`, чтобы production-развёртывание клало журнал куда нужно.
 */
export function defaultLogDirectory(): string {
  const override = process.env.GRUBER_LOG_DIR;
  if (override) return override;
  return path.join(homedir(), "Desktop", "FluxIO logs");
}

/** Проверка при старте: есть ли рабочий стол вообще. */
export async function resolveLogDirectory(candidate = defaultLogDirectory()): Promise<string> {
  if (process.env.GRUBER_LOG_DIR) return candidate;
  const desktop = path.dirname(candidate);
  try {
    if ((await stat(desktop)).isDirectory()) return candidate;
  } catch {
    // Рабочего стола нет.
  }
  return path.join(homedir(), "FluxIO logs");
}
