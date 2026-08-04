#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(projectRoot, ".env");

export function launcherPaths(rootPath = projectRoot) {
  return {
    desktopDirectory: path.join(rootPath, "apps", "desktop"),
    electronCli: path.join(rootPath, "node_modules", "electron", "cli.js"),
    mediaEntry: path.join(rootPath, "apps", "media-server", "dist", "index.js"),
    webEntry: path.join(rootPath, "apps", "web", "dist", "index.html"),
  };
}

export function normalizeMediaApiUrl(value = "http://127.0.0.1:4310") {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsupported media API protocol: ${url.protocol}`);
  }
  return url.toString().replace(/\/$/, "");
}

export async function mediaServerIsActive(
  baseUrl,
  fetchImplementation = fetch,
) {
  try {
    const response = await fetchImplementation(new URL("/api/health", baseUrl), {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  loadProjectEnvironment();
  const paths = launcherPaths();
  assertLauncherFiles(paths);
  const mediaApiUrl = normalizeMediaApiUrl(process.env.GRUBER_MEDIA_API_URL);
  const environment = {
    ...process.env,
    GRUBER_MEDIA_API_URL: mediaApiUrl,
  };
  let ownedMediaProcess = null;
  let electronProcess = null;

  try {
    if (!(await mediaServerIsActive(mediaApiUrl))) {
      console.log(`[FluxIO] Media server ${mediaApiUrl} is not active; starting it.`);
      ownedMediaProcess = spawnManaged(
        process.execPath,
        [paths.mediaEntry],
        environment,
      );
      await waitForMediaServer(mediaApiUrl, ownedMediaProcess, 30_000);
    }

    electronProcess = spawnManaged(
      process.execPath,
      [paths.electronCli, paths.desktopDirectory, "--gruber-production"],
      environment,
    );
    const outcome = await waitForElectronOrSignal(electronProcess);
    if (outcome.kind === "signal") {
      console.log(
        ownedMediaProcess
          ? `\n[FluxIO] ${outcome.signal}: stopping Electron and owned media server.`
          : `\n[FluxIO] ${outcome.signal}: stopping Electron; background media server remains active.`,
      );
      await terminateProcessTree(electronProcess);
    } else if (outcome.code !== 0 && outcome.signal == null) {
      throw new Error(`Electron exited with code=${outcome.code ?? "unknown"}`);
    }
  } finally {
    if (electronProcess) await terminateProcessTree(electronProcess);
    if (ownedMediaProcess) await terminateProcessTree(ownedMediaProcess);
  }
}

function loadProjectEnvironment() {
  try {
    loadEnvFile(envPath);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
    throw new Error(`FluxIO configuration is missing: ${envPath}. Run node setup.mjs.`);
  }
}

function assertLauncherFiles(paths) {
  const required = [
    ["Electron CLI", paths.electronCli],
    ["media-server build", paths.mediaEntry],
    ["web build", paths.webEntry],
  ];
  for (const [label, filePath] of required) {
    if (!existsSync(filePath)) {
      throw new Error(`${label} is missing: ${filePath}. Run node setup.mjs in Production mode.`);
    }
  }
}

function spawnManaged(command, args, environment) {
  return spawn(command, args, {
    cwd: projectRoot,
    detached: process.platform !== "win32",
    env: environment,
    shell: false,
    stdio: "inherit",
  });
}

async function waitForMediaServer(baseUrl, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(
        `Media server exited before startup (${child.signalCode ?? child.exitCode})`,
      );
    }
    if (await mediaServerIsActive(baseUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Media server did not become active in ${timeoutMs / 1_000} seconds`);
}

function waitForElectronOrSignal(child) {
  return new Promise((resolve, reject) => {
    const onSigint = () => finish({ kind: "signal", signal: "SIGINT" });
    const onSigterm = () => finish({ kind: "signal", signal: "SIGTERM" });
    const onError = (error) => finish(null, error);
    const onClose = (code, signal) => finish({ kind: "exit", code, signal });

    function finish(result, error = null) {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      child.off("error", onError);
      child.off("close", onClose);
      if (error) reject(error);
      else resolve(result);
    }

    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

export async function terminateProcessTree(
  child,
  platform = process.platform,
  killTree = spawnSync,
) {
  if (!child || child.pid == null || child.exitCode != null || child.signalCode != null) {
    return;
  }
  if (platform === "win32") {
    killTree(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore" },
    );
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  await waitForExit(child, 3_000);
  if (platform !== "win32" && child.exitCode == null && child.signalCode == null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode != null || child.signalCode != null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("close", onClose);
      resolve();
    }, timeoutMs);
    timer.unref();
    const onClose = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("close", onClose);
  });
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[FluxIO] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
