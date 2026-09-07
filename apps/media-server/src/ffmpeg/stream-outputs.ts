import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { PlayoutStreamStatus } from "@gruber/contracts";
import { emptyResourceUsage } from "@gruber/contracts";
import type { StreamBranchPlan } from "./stream-branch.js";

/**
 * Выходы программы, которые запускаются и гаснут по отдельности.
 *
 * Отдельный узел, а не ещё двести строк в супервизоре эфира, по той же
 * причине, по которой выходы вообще ответвлены от мультиплекса: у них другая
 * жизнь. Программа поднимается один раз на сессию и держится до Stop, а выход
 * оператор включает и выключает под живым эфиром — резервный канал на время
 * работ, площадку на время передачи, — и падение выхода не имеет права
 * тронуть программу.
 *
 * Отсюда же и обработка отказа: упавший выход остаётся в состоянии `failed` с
 * причиной, а сам не перезапускается. Восстанавливать связь за оператора
 * нельзя — тот же довод, что и у транспортной стадии программы: мы не знаем,
 * не занят ли адрес чужим эфиром.
 */

export type StreamOutputEvent = (message: string) => void;

interface BranchRuntime {
  plan: StreamBranchPlan;
  encoder: BranchProcess | null;
  transport: BranchProcess | null;
  /** Остановка по команде: закрытие процесса тогда не отказ. */
  expectedStop: boolean;
  /**
   * Обещание остановки.
   *
   * Выход держит порт зеркала, и следующий пуск обязан дождаться, пока прежний
   * процесс его отпустит: иначе второй tsp встаёт на занятый адрес, и выход,
   * который оператор только что включил обратно, молча не поднимается.
   */
  stopping: Promise<void> | null;
  settleStop: (() => void) | null;
  status: PlayoutStreamStatus;
  logTail: string;
}

/** У ветки нет входной трубы: она читает зеркало по сети, а не из службы. */
type BranchProcess = ChildProcessByStdio<null, Readable, Readable>;

const branchStopGraceMs = 2_000;
/** Через сколько ветка, не ушедшая по SIGTERM, добивается SIGKILL. */
const branchKillGraceMs = 5_000;

export class StreamOutputSupervisor {
  readonly #branches = new Map<string, BranchRuntime>();
  readonly #ffmpegPath: string;
  readonly #tspPath: string;
  readonly #onEvent: StreamOutputEvent;

  constructor(ffmpegPath: string, tspPath: string, onEvent: StreamOutputEvent) {
    this.#ffmpegPath = ffmpegPath;
    this.#tspPath = tspPath;
    this.#onEvent = onEvent;
  }

  /** Состав выходов фиксируется на старте сессии: зеркала объявляет транспорт. */
  configure(plans: readonly StreamBranchPlan[]): void {
    this.#branches.clear();
    for (const plan of plans) {
      this.#branches.set(plan.stream.id, {
        plan,
        encoder: null,
        transport: null,
        expectedStop: false,
        stopping: null,
        settleStop: null,
        logTail: "",
        status: {
          id: plan.stream.id,
          name: plan.stream.name,
          state: "idle",
          mode: plan.mode,
          endpointLabel: plan.endpointLabel,
          startedAt: null,
          resources: { ...emptyResourceUsage },
          error: null,
        },
      });
    }
  }

  has(id: string): boolean {
    return this.#branches.has(id);
  }

  statuses(): PlayoutStreamStatus[] {
    return [...this.#branches.values()].map((branch) => ({
      ...branch.status,
      resources: { ...branch.status.resources },
    }));
  }

  /** Процессы выхода: по ним считается его доля машины. */
  pids(id: string): number[] {
    const branch = this.#branches.get(id);
    if (!branch) return [];
    return [branch.encoder?.pid, branch.transport?.pid]
      .filter((pid): pid is number => typeof pid === "number");
  }

  allPids(): number[] {
    return [...this.#branches.keys()].flatMap((id) => this.pids(id));
  }

  applyResources(id: string, resources: PlayoutStreamStatus["resources"]): void {
    const branch = this.#branches.get(id);
    if (branch) branch.status.resources = resources;
  }

  async startEnabled(): Promise<void> {
    for (const branch of this.#branches.values()) {
      if (branch.plan.stream.enabled) await this.start(branch.plan.stream.id);
    }
  }

  async start(id: string): Promise<void> {
    const branch = this.#branches.get(id);
    if (!branch) throw new Error(`Output "${id}" is not part of this session`);
    // Выход, который ещё гаснет, держит порт зеркала: пуск ждёт его.
    if (branch.stopping) await branch.stopping;
    if (branch.encoder || branch.transport) return;

    branch.expectedStop = false;
    branch.status.error = null;
    branch.status.state = "starting";
    branch.status.startedAt = new Date().toISOString();

    // Транспортная стадия поднимается первой: FFmpeg ветки начинает отдавать
    // сразу, и без слушателя на локальном порте первые секунды ушли бы в никуда.
    if (branch.plan.transportArgs.length > 0) {
      branch.transport = this.#spawn(branch, this.#tspPath, branch.plan.transportArgs, "transport");
    }
    if (branch.plan.encoderArgs.length > 0) {
      branch.encoder = this.#spawn(branch, this.#ffmpegPath, branch.plan.encoderArgs, "encoder");
    }
    branch.status.state = "running";
    this.#onEvent(
      `Output "${branch.plan.stream.name}" started as ${branch.plan.mode} to ` +
        `${branch.plan.endpointLabel}`,
    );
  }

  stop(id: string): Promise<void> {
    const branch = this.#branches.get(id);
    if (!branch) throw new Error(`Output "${id}" is not part of this session`);
    if (branch.stopping) return branch.stopping;
    if (!branch.encoder && !branch.transport) {
      branch.status.state = "idle";
      return Promise.resolve();
    }

    branch.expectedStop = true;
    branch.status.state = "stopping";
    branch.stopping = new Promise<void>((resolve) => { branch.settleStop = resolve; });
    if (branch.encoder) {
      // Кодировщик гасится первым: транспортная стадия обязана выпустить то,
      // что уже приняла, а не оборвать поток на середине пакета. У выхода без
      // своей ступени кодирования ждать нечего — гасим сразу.
      terminate(branch.encoder);
      setTimeout(() => terminate(branch.transport), branchStopGraceMs).unref();
    } else {
      terminate(branch.transport);
    }
    this.#onEvent(`Output "${branch.plan.stream.name}" stopped`);
    return branch.stopping;
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.#branches.values()]
        .filter((branch) => branch.encoder || branch.transport)
        .map((branch) => this.stop(branch.plan.stream.id)),
    );
  }

  #spawn(
    branch: BranchRuntime,
    command: string,
    args: string[],
    role: "encoder" | "transport",
  ): BranchProcess {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", () => {});
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      branch.logTail = `${branch.logTail}${chunk}`.slice(-2_000);
      for (const line of chunk.split(/\r?\n/)) {
        const message = line.trim();
        if (message) this.#onEvent(`Output "${branch.plan.stream.name}" ${role}: ${message}`);
      }
    });
    child.once("error", (error: Error) => {
      this.#failBranch(branch, `${role} failed to start: ${error.message}`);
    });
    child.once("close", (code, signal) => {
      if (role === "encoder") branch.encoder = null;
      else branch.transport = null;
      this.#handleClose(branch, role, code, signal);
    });
    return child;
  }

  #handleClose(
    branch: BranchRuntime,
    role: "encoder" | "transport",
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (branch.expectedStop) {
      if (!branch.encoder && !branch.transport) {
        // Упавший выход остаётся упавшим: причина нужна оператору и после
        // того, как процессы догорели.
        if (branch.status.state !== "failed") {
          branch.status.state = "idle";
          branch.status.startedAt = null;
        }
        branch.expectedStop = false;
        this.#settleStop(branch);
      }
      return;
    }
    if (branch.status.state === "failed") return;

    const reason = code ?? signal ?? "unknown";
    this.#failBranch(
      branch,
      `${role} exited with ${reason}${branch.logTail.trim() ? `: ${lastLine(branch.logTail)}` : ""}`,
    );
  }

  /**
   * Упавший выход гасит и вторую свою половину: транскодер без транспортной
   * стадии пишет в закрытый порт, а стадия без транскодера отдаёт в эфир
   * тишину, и снаружи это выглядит хуже честной остановки.
   */
  #failBranch(branch: BranchRuntime, error: string): void {
    branch.status.state = "failed";
    branch.status.error = error;
    branch.expectedStop = true;
    branch.stopping ??= new Promise<void>((resolve) => { branch.settleStop = resolve; });
    terminate(branch.encoder);
    terminate(branch.transport);
    if (!branch.encoder && !branch.transport) this.#settleStop(branch);
    this.#onEvent(`Output "${branch.plan.stream.name}" failed: ${error}`);
  }

  #settleStop(branch: BranchRuntime): void {
    branch.settleStop?.();
    branch.settleStop = null;
    branch.stopping = null;
  }
}

/**
 * Гасит процесс ветки, а через паузу — добивает.
 *
 * Одного SIGTERM мало: FFmpeg отрабатывает сигнал в основном цикле, а ветка,
 * у которой отвалилась приёмная сторона, стоит в записи в сокет и до цикла не
 * доходит. На эфирной машине такой процесс остаётся навсегда — держит порт
 * зеркала, ест ядро и не даёт включить выход обратно.
 */
function terminate(child: BranchProcess | null): void {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
  }, branchKillGraceMs).unref();
}

function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
}
