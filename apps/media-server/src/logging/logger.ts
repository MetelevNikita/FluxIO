import { appendFile, mkdir } from "node:fs/promises";
import { statSync } from "node:fs";
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
  playoutEventLevel,
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

  /**
   * Событие эфирного контура: тот же поток, что уходит в консоль и статус.
   *
   * Уровень берётся из текста, потому что supervisor отдаёт строку, а не код.
   * Исключение объявляет он же: `expected` — ожидаемая жалоба на остановке,
   * и красить ею штатное завершение нельзя.
   */
  playoutEvent(message: string, at = new Date(), expected = false): void {
    this.log(playoutEventLevel(message, expected), "PLAYOUT", message, at);
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

  /**
   * Наблюдатель за задержкой цикла событий.
   *
   * Пока media-service занят одной длинной синхронной операцией — рендером
   * разбором большого расписания — он не отвечает ни на один запрос, и
   * оператор видит это как «залипший» интерфейс. Понять причину по интерфейсу
   * невозможно, поэтому каждая такая заминка пишется в журнал с длительностью:
   * в следующий раз будет видно, что именно держало сервис.
   */
  watchEventLoop(thresholdMs = 500, sampleMs = 250, sleepMs = 30_000): () => void {
    let previous = Date.now();
    let previousCpu = process.cpuUsage();
    const timer = setInterval(() => {
      const now = Date.now();
      const busyMs = cpuMilliseconds(process.cpuUsage(previousCpu));
      const lag = now - previous - sampleMs;
      previous = now;
      previousCpu = process.cpuUsage();
      if (lag < thresholdMs) return;
      // Сон машины останавливает таймер ровно так же, как заминка, и по одним
      // часам они неразличимы: закрытый на ночь ноутбук писал в журнал «сервис
      // не отвечал 900 с» — заминку, которой не было. Отличает их процессорное
      // время: служба, стоявшая на длинной синхронной работе, его потратила,
      // спящая — нет. Порог мягкий, потому что ждать диска (разбор шрифтов) —
      // тоже заминка, а процессор при этом почти простаивает; поэтому одного
      // процессорного времени мало и нужен ещё потолок: заминка в четверть
      // часа — это уже не «интерфейс замер», это остановленная машина.
      const slept = lag > sleepMs && busyMs < lag / 4;
      this.log(
        slept ? "info" : "warn",
        "SERVICE",
        slept
          ? `Служба простояла ${(lag / 1_000).toFixed(2)} с без работы — машина спала или была приостановлена`
          : `Сервис не отвечал ${(lag / 1_000).toFixed(2)} с — на это время интерфейс замирает`,
        new Date(now),
      );
    }, sampleMs);
    timer.unref?.();
    return () => clearInterval(timer);
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
function defaultLogDirectory(): string {
  const override = process.env.GRUBER_LOG_DIR;
  if (override) return override;
  const homeDirectory = homedir();
  const desktop = path.join(homeDirectory, "Desktop");
  try {
    if (statSync(desktop).isDirectory()) return path.join(desktop, "FluxIO logs");
  } catch {
    // Рабочего стола нет.
  }
  return path.join(homeDirectory, "FluxIO logs");
}

/** Процессорное время замера в миллисекундах: `cpuUsage` считает микросекунды. */
function cpuMilliseconds(usage: NodeJS.CpuUsage): number {
  return (usage.user + usage.system) / 1_000;
}
