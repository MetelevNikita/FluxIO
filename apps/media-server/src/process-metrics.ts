import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { PlayoutResourceUsage } from "@gruber/contracts";

/**
 * Сколько машины забирает эфирная цепочка, по процессам.
 *
 * Нужно это ровно для одного вопроса: сколько выходов ещё поместится. Общий
 * процент машины на него не отвечает — он одинаково выглядит и при одном
 * кодировщике на восьми ядрах, и при трёх на двух, — поэтому считается каждая
 * группа процессов отдельно и в долях **одного** ядра, как в top.
 *
 * Мерка везде одна: накопленное процессорное время процесса и разность между
 * двумя снимками. Мгновенный `%cpu` у `ps` на Linux — среднее за всю жизнь
 * процесса, и у долгоживущего кодировщика он показывает погоду позапрошлой
 * недели.
 */

export interface ProcessSample {
  pid: number;
  cpuSeconds: number;
  rssBytes: number;
}

export interface ProcessSnapshot {
  takenAtMs: number;
  samples: Map<number, ProcessSample>;
}

/** USER_HZ интерфейса /proc: 100 независимо от HZ ядра. */
const linuxClockTicksPerSecond = 100;
const linuxPageSizeBytes = 4_096;
const sampleTimeoutMs = 5_000;

export function emptySnapshot(): ProcessSnapshot {
  return { takenAtMs: 0, samples: new Map() };
}

/**
 * `ps -o pid=,rss=,time=` на macOS и прочих BSD.
 *
 * Время приходит как `[[ДД-]ЧЧ:]ММ:СС[.СС]`, RSS — в килобайтах.
 */
export function parsePosixProcessList(output: string): ProcessSample[] {
  const samples: ProcessSample[] = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const pid = Number.parseInt(parts[0] ?? "", 10);
    const rssKb = Number.parseInt(parts[1] ?? "", 10);
    const cpuSeconds = parsePosixCpuTime(parts[2] ?? "");
    if (!Number.isInteger(pid) || !Number.isFinite(rssKb) || cpuSeconds == null) continue;
    samples.push({ pid, cpuSeconds, rssBytes: rssKb * 1_024 });
  }
  return samples;
}

export function parsePosixCpuTime(value: string): number | null {
  const match = value.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const days = Number.parseInt(match[1] ?? "0", 10);
  const hours = Number.parseInt(match[2] ?? "0", 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  const seconds = Number.parseFloat(match[4] ?? "0");
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

/**
 * `/proc/<pid>/stat` на Linux.
 *
 * Имя процесса стоит в скобках и само может содержать и пробелы, и скобки,
 * поэтому разбор начинается после **последней** закрывающей скобки — иначе
 * ffmpeg, запущенный из каталога со скобкой в имени, сдвинул бы все поля.
 */
export function parseLinuxProcessStat(stat: string): ProcessSample | null {
  const pid = Number.parseInt(stat.slice(0, stat.indexOf(" ")), 10);
  const tailStart = stat.lastIndexOf(")");
  if (!Number.isInteger(pid) || tailStart < 0) return null;
  const fields = stat.slice(tailStart + 1).trim().split(/\s+/);
  const utime = Number.parseInt(fields[11] ?? "", 10);
  const stime = Number.parseInt(fields[12] ?? "", 10);
  const rssPages = Number.parseInt(fields[21] ?? "", 10);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
  return {
    pid,
    cpuSeconds: (utime + stime) / linuxClockTicksPerSecond,
    rssBytes: Number.isFinite(rssPages) ? rssPages * linuxPageSizeBytes : 0,
  };
}

/**
 * Вывод PowerShell `Get-Process`: `pid;процессорные секунды;байты`.
 *
 * У процесса, поднятого от другого пользователя, `CPU` приходит пустым — такая
 * строка пропускается, а не считается нулевой нагрузкой.
 */
export function parseWindowsProcessList(output: string): ProcessSample[] {
  const samples: ProcessSample[] = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(";");
    if (parts.length < 3) continue;
    const pid = Number.parseInt(parts[0] ?? "", 10);
    const cpuSeconds = Number.parseFloat((parts[1] ?? "").replace(",", "."));
    const rssBytes = Number.parseFloat(parts[2] ?? "");
    if (!Number.isInteger(pid) || !Number.isFinite(cpuSeconds) || !Number.isFinite(rssBytes)) {
      continue;
    }
    samples.push({ pid, cpuSeconds, rssBytes });
  }
  return samples;
}

/**
 * Нагрузка группы процессов между двумя снимками.
 *
 * Процесс, которого в прошлом снимке не было, в проценты не идёт: его
 * накопленное время принадлежит времени до снимка, и на коротком интервале оно
 * дало бы всплеск в тысячи процентов на ровном месте. Память при этом
 * учитывается сразу — она мгновенная величина, а не накопленная.
 */
export function computeResourceUsage(
  previous: ProcessSnapshot,
  current: ProcessSnapshot,
  pids: readonly number[],
): PlayoutResourceUsage {
  const elapsedSeconds = (current.takenAtMs - previous.takenAtMs) / 1_000;
  let cpuPercent = 0;
  let rssBytes = 0;
  let processes = 0;

  for (const pid of new Set(pids)) {
    const sample = current.samples.get(pid);
    if (!sample) continue;
    processes += 1;
    rssBytes += sample.rssBytes;
    const before = previous.samples.get(pid);
    if (!before || elapsedSeconds <= 0) continue;
    const delta = sample.cpuSeconds - before.cpuSeconds;
    if (delta > 0) cpuPercent += (delta / elapsedSeconds) * 100;
  }

  return {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryMb: Math.round((rssBytes / 1_048_576) * 10) / 10,
    processes,
  };
}

/**
 * Снимок по списку процессов.
 *
 * Linux читает `/proc` сам — это дешевле любого запуска и точнее до 10 мс.
 * macOS обходится одним `ps`, у которого время приходит с сотыми долями.
 * Windows отвечает через PowerShell: `wmic` из системы убран, а `tasklist`
 * процессорного времени не отдаёт вовсе.
 */
export async function sampleProcesses(
  pids: readonly number[],
  platform: NodeJS.Platform = process.platform,
): Promise<ProcessSnapshot> {
  const unique = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  const snapshot: ProcessSnapshot = { takenAtMs: Date.now(), samples: new Map() };
  if (unique.length === 0) return snapshot;

  const samples = platform === "linux"
    ? await sampleLinux(unique)
    : platform === "win32"
      ? parseWindowsProcessList(await runSampler(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-Process -Id ${unique.join(",")} -ErrorAction SilentlyContinue | ` +
            `ForEach-Object { \"$($_.Id);$($_.CPU);$($_.WorkingSet64)\" }`,
        ],
      ))
      : parsePosixProcessList(await runSampler(
        "ps",
        ["-o", "pid=,rss=,time=", "-p", unique.join(",")],
      ));

  for (const sample of samples) snapshot.samples.set(sample.pid, sample);
  return snapshot;
}

async function sampleLinux(pids: readonly number[]): Promise<ProcessSample[]> {
  const samples: ProcessSample[] = [];
  for (const pid of pids) {
    try {
      const parsed = parseLinuxProcessStat(await readFile(`/proc/${pid}/stat`, "utf8"));
      if (parsed) samples.push(parsed);
    } catch {
      // Процесс закончился между сбором списка и чтением — это обычная смена
      // ролика, а не отказ.
    }
  }
  return samples;
}

function runSampler(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish("");
    }, sampleTimeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    // Измерение не имеет права уронить эфир: не вышло — покажем прочерк.
    child.once("error", () => finish(""));
    child.once("close", () => finish(output));
  });
}
