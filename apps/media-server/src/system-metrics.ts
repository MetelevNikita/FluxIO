import { cpus } from "node:os";
import type { SystemMetrics } from "@gruber/contracts";

export interface CpuSnapshot {
  idle: number;
  total: number;
}

export class SystemMetricsSampler {
  #previousCpu = readCpuSnapshot();

  sample(networkMbps: number): SystemMetrics {
    const currentCpu = readCpuSnapshot();
    const cpuPercent = calculateCpuPercent(this.#previousCpu, currentCpu);
    this.#previousCpu = currentCpu;

    return {
      cpuPercent,
      networkMbps: Number.isFinite(networkMbps) ? Math.max(0, networkMbps) : 0,
      collectedAt: new Date().toISOString(),
    };
  }
}

export function calculateCpuPercent(
  previous: CpuSnapshot,
  current: CpuSnapshot,
): number {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100));
}

function readCpuSnapshot(): CpuSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return { idle, total };
}
