import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

//

import {
  INSTANCES_OVERVIEW_CHANNEL,
  ADD_INSTANCE_CHANNEL,
  DELETE_INSTANCE_CHANNEL,
  OPEN_INSTANCE_CHANNEL,
  RENAME_INSTANCE_CHANNEL,
  SHOW_INSTANCES_CHANNEL,
} from "./channels.js";
import { registerIpcHandlers } from "./ipc.js";
import {
  desktopIconPath,
  openLauncherWindow,
  openProgramWindow,
  type FluxioInstance,
} from "./windows.js";

app.setName("FluxIO");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

//

if (hasLock) void app.whenReady().then(() => {
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(desktopIconPath());
  }

  registerIpcHandlers();
  registerInstanceHandlers(configuredInstances);
  openLauncherWindow(true);

  app.on("second-instance", () => openLauncherWindow());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openLauncherWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function configuredInstances(): FluxioInstance[] {
  // Программ может не быть вовсе — первичная установка их не создаёт. Пустой
  // список ведёт Control Center к экрану «создайте первую программу».
  const fallback: FluxioInstance[] = [];
  try {
    const registryPath = process.env.GRUBER_INSTANCES_FILE;
    const source = registryPath
      ? JSON.parse(readFileSync(registryPath, "utf8"))
      : JSON.parse(process.env.GRUBER_INSTANCES_JSON ?? "null");
    const parsed: unknown = registryPath && source && typeof source === "object"
      ? (source as { instances?: unknown }).instances
      : source;
    if (!Array.isArray(parsed)) return fallback;
    const result = parsed.flatMap((value): FluxioInstance[] => {
      if (!value || typeof value !== "object") return [];
      const entry = value as Record<string, unknown>;
      if (
        typeof entry.id !== "string" ||
        typeof entry.name !== "string" ||
        typeof entry.apiUrl !== "string"
      ) return [];
      return [{
        id: entry.id,
        name: entry.name,
        apiUrl: entry.apiUrl,
        enabled: entry.enabled !== false,
      }];
    });
    return result.length > 0 ? result : fallback;
  } catch {
    return fallback;
  }
}

function registerInstanceHandlers(loadConfigured: () => FluxioInstance[]): void {
  ipcMain.handle(OPEN_INSTANCE_CHANNEL, (_event, id: unknown) => {
    if (typeof id !== "string") return;
    const configured = loadConfigured();
    const instance = configured.find((entry) => entry.id === id && entry.enabled);
    if (instance) openProgramWindow(instance);
  });
  ipcMain.handle(SHOW_INSTANCES_CHANNEL, () => { openLauncherWindow(); });
  ipcMain.handle(INSTANCES_OVERVIEW_CHANNEL, () => collectOverview(loadConfigured()));
  ipcMain.handle(ADD_INSTANCE_CHANNEL, (_event, name: unknown) =>
    runSetup(["--add-instance", `--instance-name=${instanceName(name)}`]));
  ipcMain.handle(RENAME_INSTANCE_CHANNEL, (_event, id: unknown, name: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid program ID");
    return runSetup([`--rename-instance=${id}`, `--instance-name=${instanceName(name)}`]);
  });
  ipcMain.handle(DELETE_INSTANCE_CHANNEL, (_event, id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid program ID");
    return runSetup([`--delete-instance=${id}`]);
  });
}

function instanceName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 80) throw new Error("Name must contain 1 to 80 characters");
  return name;
}

async function runSetup(args: string[]): Promise<void> {
  const registryPath = process.env.GRUBER_INSTANCES_FILE;
  if (!registryPath) throw new Error("Program registry path was not found");
  const root = path.dirname(registryPath);
  const setup = path.join(root, "setup.mjs");
  const bundleRoot = path.dirname(root);
  const bundledNode = path.join(bundleRoot, "runtime", process.platform === "win32" ? "node.exe" : "node");
  const command = existsSync(bundledNode) ? bundledNode : process.env.npm_node_execpath ?? "node";
  const setupArgs = [setup, ...(existsSync(path.join(bundleRoot, "manifest.json")) ? [`--bundle=${bundleRoot}`] : []), ...args];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, setupArgs, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(output.trim() || `Setup exited with code ${code}`)));
  });
}

async function collectOverview(configured: FluxioInstance[]) {
  const instances = await Promise.all(configured.map(loadInstanceOverview));
  const online = instances.filter((entry) => entry.online);
  const fluxioCpuPercent = sum(online.map((entry) => entry.cpuPercent));
  const cpuCores = online.find((entry) => entry.cpuCores > 0)?.cpuCores ?? 1;
  return {
    instances,
    totals: {
      cpuCores,
      fluxioCpuPercent,
      fluxioMachinePercent: fluxioCpuPercent / cpuCores,
      memoryMb: sum(online.map((entry) => entry.memoryMb)),
      processes: sum(online.map((entry) => entry.processes)),
      systemCpuPercent: online.find((entry) => entry.systemCpuPercent >= 0)?.systemCpuPercent ?? 0,
    },
  };
}

async function loadInstanceOverview(instance: FluxioInstance) {
  const empty = {
    ...instance,
    online: false,
    healthStatus: null,
    playoutState: null,
    currentItemName: null,
    fps: 0,
    speed: 0,
    bitrateKbps: 0,
    cpuPercent: 0,
    cpuCores: 0,
    systemCpuPercent: -1,
    memoryMb: 0,
    processes: 0,
    error: instance.enabled ? null : "Program disabled",
  };
  if (!instance.enabled) return empty;
  try {
    const [health, status, metrics] = await Promise.all([
      fetchJson(instance.apiUrl, "/api/health"),
      fetchJson(instance.apiUrl, "/api/playout/status"),
      fetchJson(instance.apiUrl, "/api/system/metrics"),
    ]);
    const program = resource(status.programResources);
    const streams = Array.isArray(status.streams) ? status.streams
      .map(record)
      .filter((stream) => stream.mode !== "program")
      .map((stream) => resource(stream.resources)) : [];
    return {
      ...empty,
      online: true,
      healthStatus: textValue(health.status),
      playoutState: textValue(status.state),
      currentItemName: textValue(status.currentItemName),
      fps: numberValue(status.fps),
      speed: numberValue(status.speed),
      bitrateKbps: numberValue(status.bitrateKbps),
      cpuPercent: program.cpuPercent + sum(streams.map((entry) => entry.cpuPercent)),
      cpuCores: numberValue(metrics.cpuCores) || 1,
      systemCpuPercent: numberValue(metrics.cpuPercent),
      memoryMb: program.memoryMb + sum(streams.map((entry) => entry.memoryMb)),
      processes: program.processes + sum(streams.map((entry) => entry.processes)),
      error: textValue(status.error),
    };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchJson(baseUrl: string, pathname: string): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(pathname, baseUrl), { signal: AbortSignal.timeout(1_500) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return record(await response.json());
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function resource(value: unknown) {
  const entry = record(value);
  return {
    cpuPercent: numberValue(entry.cpuPercent),
    memoryMb: numberValue(entry.memoryMb),
    processes: numberValue(entry.processes),
  };
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
