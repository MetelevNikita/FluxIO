#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(projectRoot, ".env");
const noStart = process.argv.includes("--no-start");
const npmInvocation = buildNpmInvocation();

export function buildDatabaseUrl({
  database,
  password,
  port,
  username,
}) {
  const credentials = password
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
    : encodeURIComponent(username);
  return `postgresql://${credentials}@127.0.0.1:${port}/${encodeURIComponent(database)}`;
}

export function parseEnv(contents) {
  const result = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\([\\"$`])/g, "$1");
      }
    }
    result[key] = value;
  }
  return result;
}

export function serializeEnv(values) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${quoteEnvValue(String(value))}`)
    .join("\n")}\n`;
}

export function validatePort(value, label = "Port") {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} must be an integer from 1 to 65535`);
  }
  return port;
}

export function commandVersionArguments(command) {
  const executable = unquoteCommand(command)
    .split(/[\\/]/)
    .at(-1)
    .toLowerCase()
    .replace(/\.exe$/, "");
  return executable === "ffmpeg" || executable === "ffprobe"
    ? ["-version"]
    : ["--version"];
}

export function npmCiArguments() {
  // Production builds still require Electron, Vite, TypeScript and Prisma CLI.
  // They are build-time devDependencies even though the resulting service runs
  // with NODE_ENV=production.
  return ["ci", "--include=dev"];
}

function quoteEnvValue(value) {
  return `"${value.replace(/[\\"$`]/g, (character) => `\\${character}`)}"`;
}

class Prompt {
  #muted = false;
  #output;
  #readline;

  constructor() {
    this.#output = new Writable({
      write: (chunk, _encoding, callback) => {
        if (!this.#muted) process.stdout.write(chunk);
        callback();
      },
    });
    this.#readline = createInterface({
      input: process.stdin,
      output: this.#output,
      terminal: Boolean(process.stdin.isTTY),
    });
  }

  async text(label, defaultValue = "", validate = null) {
    while (true) {
      const suffix = defaultValue ? ` [${defaultValue}]` : "";
      const answer = (await this.#readline.question(`${label}${suffix}: `)).trim();
      const value = answer || defaultValue;
      try {
        return validate ? validate(value) : value;
      } catch (error) {
        console.error(`  ${errorMessage(error)}`);
      }
    }
  }

  async secret(label, defaultValue = "") {
    if (!process.stdin.isTTY) {
      const answer = await this.#readline.question(`${label}: `);
      return answer || defaultValue;
    }
    const suffix = defaultValue ? " [Enter — оставить текущий]" : " [можно пустой]";
    process.stdout.write(`${label}${suffix}: `);
    this.#muted = true;
    const answer = await this.#readline.question("");
    this.#muted = false;
    process.stdout.write("\n");
    return answer || defaultValue;
  }

  async confirm(label, defaultValue = true) {
    const answer = await this.text(`${label} ${defaultValue ? "[Y/n]" : "[y/N]"}`);
    if (!answer) return defaultValue;
    return ["y", "yes", "д", "да"].includes(answer.toLowerCase());
  }

  async choose(label, options, defaultIndex = 0) {
    console.log(`\n${label}`);
    options.forEach((option, index) => {
      console.log(`  ${index + 1}) ${option.label}`);
    });
    const selected = await this.text(
      "Выберите номер",
      String(defaultIndex + 1),
      (value) => {
        const index = Number(value) - 1;
        if (!Number.isInteger(index) || !options[index]) {
          throw new Error(`Введите число от 1 до ${options.length}`);
        }
        return index;
      },
    );
    return options[selected].value;
  }

  close() {
    this.#readline.close();
  }
}

async function main() {
  printHeader();
  assertNodeVersion();
  if (process.platform === "win32") {
    refreshWindowsProcessPath();
  }
  const existingEnv = await loadExistingEnv();
  const existingDatabase = parseExistingDatabase(existingEnv.DATABASE_URL);
  const prompt = new Prompt();

  try {
    const mode = await prompt.choose(
      "1. Режим проекта",
      [
        { label: "Тест / разработка", value: "test" },
        { label: "Production", value: "production" },
      ],
      0,
    );

    console.log("\n2. PostgreSQL (без Docker)");
    const databaseReady = await prompt.confirm(
      "Пользователь и база уже существуют?",
      mode === "production",
    );
    const pgHost = "127.0.0.1";
    console.log("  PostgreSQL: 127.0.0.1 (локально, SSL отключён)");
    const pgPort = await prompt.text(
      "PostgreSQL port",
      String(existingDatabase.port ?? 5432),
      (value) => validatePort(value, "PostgreSQL port"),
    );
    const pgDatabase = await prompt.text(
      "Имя базы",
      existingDatabase.database ?? "gruber",
      validatePgName,
    );
    const pgUsername = await prompt.text(
      "Имя пользователя PostgreSQL",
      existingDatabase.username ?? "gruber",
      validatePgName,
    );
    let pgPassword = await prompt.secret(
      "Пароль пользователя PostgreSQL",
      existingDatabase.password ?? "",
    );
    if (!databaseReady && !pgPassword) {
      pgPassword = randomBytes(24).toString("base64url");
      console.log("  Пароль сгенерирован автоматически и будет сохранён только в .env.");
    }
    let admin = null;
    if (!databaseReady) {
      const defaultAdmin = process.platform === "darwin"
        ? process.env.USER ?? path.basename(homedir())
        : "postgres";
      const adminUsername = await prompt.text("Администратор PostgreSQL", defaultAdmin, validatePgName);
      const adminPassword = await prompt.secret("Пароль администратора PostgreSQL");
      admin = { username: adminUsername, password: adminPassword };
    }

    console.log("\n3. Media-service, FFmpeg и TSDuck");
    const apiHost = await prompt.text("GRUBER_HOST", existingEnv.GRUBER_HOST ?? "127.0.0.1");
    const apiPort = await prompt.text(
      "GRUBER_PORT",
      existingEnv.GRUBER_PORT ?? "4310",
      (value) => validatePort(value, "GRUBER_PORT"),
    );
    const detectedFfmpegPath = discoverToolPath(
      existingEnv.FFMPEG_PATH ?? "ffmpeg",
      "ffmpeg",
    );
    const detectedFfprobePath = discoverToolPath(
      existingEnv.FFPROBE_PATH ?? siblingExecutable(detectedFfmpegPath, "ffprobe"),
      "ffprobe",
    );
    const detectedTsdDuckPath = discoverToolPath(
      existingEnv.TSDUCK_PATH ?? "tsp",
      "tsp",
    );
    printToolDetection("FFmpeg", detectedFfmpegPath);
    printToolDetection("ffprobe", detectedFfprobePath);
    printToolDetection("TSDuck tsp", detectedTsdDuckPath);
    const ffmpegPath = await prompt.text(
      "FFmpeg (Enter — найти автоматически)",
      detectedFfmpegPath ?? existingEnv.FFMPEG_PATH ?? "ffmpeg",
    );
    const ffprobePath = await prompt.text(
      "ffprobe (Enter — найти автоматически)",
      detectedFfprobePath ?? existingEnv.FFPROBE_PATH ?? "ffprobe",
    );
    const tsduckPath = await prompt.text(
      "TSDuck tsp (SCTE-35 injector; Enter — найти автоматически)",
      detectedTsdDuckPath ?? existingEnv.TSDUCK_PATH ?? "tsp",
    );

    console.log("\n4. Действия мастера");
    const installDependencies = await prompt.confirm(
      "Установить все build dependencies через npm ci --include=dev?",
      true,
    );
    const runChecks = await prompt.confirm("Запустить typecheck и tests?", true);
    const buildInstaller = mode === "production"
      ? await prompt.confirm("Собрать Electron installer для текущей ОС?", true)
      : false;
    const serviceKind = platformServiceKind();
    const installBackgroundService =
      mode === "production" &&
      await prompt.confirm(
        `Установить и запустить media-service через ${serviceKind.label}?`,
        true,
      );
    const serviceUser = installBackgroundService && serviceKind.id === "systemd"
      ? await prompt.text(
          "Linux-пользователь для media-service",
          process.env.SUDO_USER ?? process.env.USER ?? "gruber",
          validateSystemUser,
        )
      : null;
    const startNow = noStart
      ? false
      : await prompt.confirm(
          installBackgroundService
            ? "Запустить Electron-интерфейс после старта media-service?"
            : "Запустить приложение после установки?",
          true,
        );

    const resolvedFfmpegPath = await ensureTool(
      prompt,
      ffmpegPath,
      "FFmpeg",
      "ffmpeg",
      "ffmpeg",
    );
    const resolvedFfprobePath = await ensureTool(
      prompt,
      ffprobePath,
      "ffprobe",
      "ffmpeg",
      "ffprobe",
    );
    const resolvedTsdDuckPath = await ensureTool(
      prompt,
      tsduckPath,
      "TSDuck",
      "tsduck",
      "tsp",
    );
    if (!databaseReady) {
      const psqlPath = await ensureTool(
        prompt,
        "psql",
        "PostgreSQL client",
        "postgresql",
        "psql",
      );
      const pgIsReadyPath = discoverToolPath(
        siblingExecutable(psqlPath, "pg_isready"),
        "pg_isready",
      );
      await ensurePostgresReady(prompt, pgHost, pgPort, pgIsReadyPath);
      await createPostgresDatabase({
        admin,
        database: pgDatabase,
        host: pgHost,
        password: pgPassword,
        port: pgPort,
        psqlPath,
        username: pgUsername,
      });
    }

    const databaseUrl = buildDatabaseUrl({
      database: pgDatabase,
      password: pgPassword,
      port: pgPort,
      username: pgUsername,
    });
    const apiClientHost = ["0.0.0.0", "::"].includes(apiHost) ? "127.0.0.1" : apiHost;
    const values = {
      NODE_ENV: mode === "production" ? "production" : "development",
      DATABASE_URL: databaseUrl,
      GRUBER_SECRET_KEY:
        existingEnv.GRUBER_SECRET_KEY || randomBytes(32).toString("base64"),
      GRUBER_HOST: apiHost,
      GRUBER_PORT: String(apiPort),
      GRUBER_MEDIA_API_URL: `http://${formatUrlHost(apiClientHost)}:${apiPort}`,
      FFMPEG_PATH: resolvedFfmpegPath,
      FFPROBE_PATH: resolvedFfprobePath,
      TSDUCK_PATH: resolvedTsdDuckPath,
    };
    await saveEnv(values);
    const commandEnv = { ...process.env, ...values };

    if (installDependencies) {
      await runNpmCommand(npmCiArguments(), { env: commandEnv });
    }
    await runNpmCommand(["run", "db:generate"], { env: commandEnv });
    await runNpmCommand(["run", "db:migrate"], { env: commandEnv });
    if (runChecks) {
      await runNpmCommand(["run", "typecheck"], { env: commandEnv });
      await runNpmCommand(["test"], { env: commandEnv });
    }

    if (mode === "production") {
      if (buildInstaller) {
        await runNpmCommand(["run", "package:desktop"], { env: commandEnv });
      } else {
        await runNpmCommand(["run", "build"], { env: commandEnv });
      }
    }

    let installedService = null;
    if (installBackgroundService) {
      installedService = await installPlatformService({
        envPath,
        kind: serviceKind.id,
        serviceUser,
        start: !noStart,
      });
      if (!noStart) {
        await waitForUrl(`${values.GRUBER_MEDIA_API_URL}/api/health`, 30_000);
      }
    }

    printSummary({ databaseUrl, installedService, mode, startNow, values });
    if (startNow) {
      if (installBackgroundService) {
        await launchDesktop(commandEnv);
      } else {
        await launchApplication(mode, commandEnv, values.GRUBER_MEDIA_API_URL);
      }
    }
  } finally {
    prompt.close();
  }
}

async function ensurePostgresReady(prompt, host, port, pgIsReadyPath) {
  if (await postgresReady(host, port, pgIsReadyPath)) return;
  if (!isLocalHost(host)) {
    throw new Error(`PostgreSQL недоступен по адресу ${host}:${port}`);
  }
  if (!(await prompt.confirm("Локальный PostgreSQL не отвечает. Запустить его как системный сервис?", true))) {
    throw new Error("PostgreSQL должен быть запущен до создания базы");
  }
  if (process.platform === "linux") {
    await runCommand("sudo", ["systemctl", "enable", "--now", "postgresql"]);
  } else if (process.platform === "darwin" && commandAvailable("brew")) {
    const formulas = ["postgresql@17", "postgresql@16", "postgresql@15", "postgresql"];
    const formula = formulas.find((candidate) =>
      spawnSync("brew", ["list", "--formula", candidate], { stdio: "ignore" }).status === 0,
    );
    if (!formula) {
      throw new Error("Не найдена установленная formula PostgreSQL в Homebrew");
    }
    await runCommand("brew", ["services", "start", formula]);
  } else if (process.platform === "win32") {
    await runCommand("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-Service -Name 'postgresql*' | Where-Object Status -ne 'Running' | Start-Service",
    ]);
  } else {
    throw new Error("Не удалось автоматически запустить PostgreSQL на этой ОС");
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await postgresReady(host, port, pgIsReadyPath)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`PostgreSQL не стал доступен по адресу ${host}:${port}`);
}

async function postgresReady(host, port, pgIsReadyPath) {
  if (pgIsReadyPath) {
    const result = spawnSync(
      pgIsReadyPath,
      ["-h", host, "-p", String(port)],
      { stdio: "ignore" },
    );
    if (!result.error && result.status === 0) return true;
  }
  return tcpPortReady(host, port);
}

function printHeader() {
  console.log("\nFluxIO — мастер установки");
  console.log("=================================");
  console.log("Docker не используется. Пароли не выводятся в итоговый отчёт.\n");
}

function assertNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) {
    throw new Error(`Требуется Node.js 24+, установлена версия ${process.versions.node}`);
  }
}

async function loadExistingEnv() {
  if (!existsSync(envPath)) return {};
  return parseEnv(await readFile(envPath, "utf8"));
}

function parseExistingDatabase(value) {
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      database: decodeURIComponent(url.pathname.replace(/^\//, "")),
      password: decodeURIComponent(url.password),
      port: url.port ? Number(url.port) : 5432,
      username: decodeURIComponent(url.username),
    };
  } catch {
    return {};
  }
}

async function saveEnv(values) {
  if (existsSync(envPath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${envPath}.backup-${timestamp}`;
    await copyFile(envPath, backupPath);
    console.log(`\nСуществующий .env сохранён: ${path.basename(backupPath)}`);
  }
  await writeFile(envPath, serializeEnv(values), { encoding: "utf8", mode: 0o600 });
  console.log("Конфигурация записана в .env (mode 0600).");
}

async function ensureTool(
  prompt,
  command,
  label,
  packageName,
  executableName,
) {
  const detected = discoverToolPath(command, executableName);
  if (detected) {
    console.log(`  ✓ ${label}: ${detected}`);
    return detected;
  }
  console.warn(`\n${label} не найден: ${command}`);
  if (!(await prompt.confirm(`Установить ${label} автоматически?`, true))) {
    throw new Error(`${label} required`);
  }
  await installPackage(packageName);
  if (process.platform === "win32") {
    refreshWindowsProcessPath();
  }
  const installed = discoverToolPath(command, executableName) ??
    discoverToolPath(executableName, executableName);
  if (!installed) {
    throw new Error(`${label} не найден после установки. Укажите полный путь и повторите мастер.`);
  }
  console.log(`  ✓ ${label}: ${installed}`);
  return installed;
}

function commandAvailable(command) {
  const result = spawnSync(command, commandVersionArguments(command), { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function discoverToolPath(
  requestedCommand,
  executableName,
  platform = process.platform,
  environment = process.env,
) {
  const requested = unquoteCommand(requestedCommand || executableName);
  if (commandAvailable(requested)) {
    return resolveCommandPath(requested, platform);
  }
  if (requested !== executableName && commandAvailable(executableName)) {
    return resolveCommandPath(executableName, platform);
  }
  if (platform !== "win32") return null;

  for (const candidate of windowsToolCandidates(executableName, environment)) {
    if (commandAvailable(candidate)) return candidate;
  }

  const executable = windowsExecutableName(executableName);
  for (const root of windowsToolSearchRoots(executableName, environment)) {
    const candidate = findExecutableBelow(root, executable);
    if (candidate && commandAvailable(candidate)) return candidate;
  }
  return null;
}

function resolveCommandPath(command, platform = process.platform) {
  const pathApi = platform === "win32" ? path.win32 : path;
  if (pathApi.isAbsolute(command)) return command;
  const finder = platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(finder, [command], { encoding: "utf8" });
  const resolved = result.status === 0
    ? result.stdout.split(/\r?\n/).find(Boolean)?.trim()
    : null;
  return resolved || command;
}

export function buildNpmInvocation({
  platform = process.platform,
  nodePath = process.execPath,
  fileExists = existsSync,
} = {}) {
  if (platform !== "win32") {
    return { command: "npm", prefixArgs: [], shell: false };
  }

  const nodeDirectory = path.win32.dirname(nodePath);
  const npmCliPath = path.win32.join(
    nodeDirectory,
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  if (fileExists(npmCliPath)) {
    return {
      command: nodePath,
      prefixArgs: [npmCliPath],
      shell: false,
    };
  }

  const npmCmdPath = path.win32.join(nodeDirectory, "npm.cmd");
  return {
    command: fileExists(npmCmdPath) ? npmCmdPath : "npm.cmd",
    prefixArgs: [],
    shell: true,
  };
}

function siblingExecutable(command, executableName) {
  if (!command) return executableName;
  const pathApi = process.platform === "win32" ? path.win32 : path;
  if (!pathApi.isAbsolute(command)) return executableName;
  const filename = process.platform === "win32"
    ? windowsExecutableName(executableName)
    : executableName;
  return pathApi.join(pathApi.dirname(command), filename);
}

function printToolDetection(label, detectedPath) {
  console.log(`  ${label}: ${detectedPath ?? "не найден автоматически"}`);
}

export function mergeWindowsPathValues(...values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    for (const segment of String(value ?? "").split(";")) {
      const clean = segment.trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      result.push(clean);
    }
  }
  return result.join(";");
}

function refreshWindowsProcessPath() {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "[Environment]::GetEnvironmentVariable('Path','Machine'); [Environment]::GetEnvironmentVariable('Path','User')",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.error || result.status !== 0) return;
  const registryPath = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .join(";");
  const merged = mergeWindowsPathValues(
    process.env.Path,
    process.env.PATH,
    registryPath,
  );
  process.env.Path = merged;
  process.env.PATH = merged;
}

export function windowsToolCandidates(command, environment = process.env) {
  const win = path.win32;
  const executable = windowsExecutableName(command);
  const systemDrive = environment.SystemDrive ?? "C:";
  const userProfile = environment.USERPROFILE;
  const localAppData = environment.LOCALAPPDATA ??
    (userProfile ? win.join(userProfile, "AppData", "Local") : null);
  const programData = environment.ProgramData ?? win.join(systemDrive, "ProgramData");
  const programFiles = environment.ProgramFiles ?? win.join(systemDrive, "Program Files");
  const programFilesX86 = environment["ProgramFiles(x86)"];
  const roots = [
    localAppData && win.join(localAppData, "Microsoft", "WinGet", "Links"),
    localAppData && win.join(localAppData, "Microsoft", "WindowsApps"),
    win.join(programData, "chocolatey", "bin"),
    userProfile && win.join(userProfile, "scoop", "shims"),
  ];

  if (["ffmpeg", "ffprobe"].includes(normalizeExecutableName(command))) {
    roots.push(
      win.join(systemDrive, "ffmpeg", "bin"),
      win.join(systemDrive, "Tools", "ffmpeg", "bin"),
      win.join(programFiles, "FFmpeg", "bin"),
      win.join(programFiles, "ffmpeg", "bin"),
      userProfile && win.join(userProfile, "scoop", "apps", "ffmpeg", "current", "bin"),
    );
  }
  if (normalizeExecutableName(command) === "tsp") {
    roots.push(
      win.join(programFiles, "TSDuck", "bin"),
      win.join(programFiles, "TSDuck"),
      programFilesX86 && win.join(programFilesX86, "TSDuck", "bin"),
      userProfile && win.join(userProfile, "scoop", "apps", "tsduck", "current", "bin"),
    );
  }
  if (["psql", "pg_isready"].includes(normalizeExecutableName(command))) {
    for (let major = 20; major >= 10; major -= 1) {
      roots.push(win.join(programFiles, "PostgreSQL", String(major), "bin"));
      if (programFilesX86) {
        roots.push(win.join(programFilesX86, "PostgreSQL", String(major), "bin"));
      }
    }
    roots.push(
      userProfile && win.join(userProfile, "scoop", "apps", "postgresql", "current", "bin"),
    );
  }

  return uniqueStrings(roots.filter(Boolean).map((root) => win.join(root, executable)));
}

function windowsToolSearchRoots(command, environment = process.env) {
  const win = path.win32;
  const systemDrive = environment.SystemDrive ?? "C:";
  const userProfile = environment.USERPROFILE;
  const localAppData = environment.LOCALAPPDATA ??
    (userProfile ? win.join(userProfile, "AppData", "Local") : null);
  const programData = environment.ProgramData ?? win.join(systemDrive, "ProgramData");
  const programFiles = environment.ProgramFiles ?? win.join(systemDrive, "Program Files");
  const programFilesX86 = environment["ProgramFiles(x86)"];
  const normalized = normalizeExecutableName(command);
  const roots = [
    localAppData && win.join(localAppData, "Microsoft", "WinGet", "Packages"),
    win.join(programData, "chocolatey", "lib"),
  ];
  if (["ffmpeg", "ffprobe"].includes(normalized)) {
    roots.push(win.join(programFiles, "FFmpeg"), win.join(programFiles, "ffmpeg"));
  }
  if (normalized === "tsp") {
    roots.push(
      win.join(programFiles, "TSDuck"),
      programFilesX86 && win.join(programFilesX86, "TSDuck"),
    );
  }
  if (["psql", "pg_isready"].includes(normalized)) {
    roots.push(
      win.join(programFiles, "PostgreSQL"),
      programFilesX86 && win.join(programFilesX86, "PostgreSQL"),
    );
  }
  return uniqueStrings(roots.filter(Boolean));
}

function findExecutableBelow(root, executable, maxDepth = 5) {
  if (!existsSync(root)) return null;
  const win = path.win32;
  const queue = [{ directory: root, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < 2_000) {
    const current = queue.shift();
    if (!current) break;
    visited += 1;
    let entries;
    try {
      entries = readdirSync(current.directory, { withFileTypes: true })
        .sort((left, right) =>
          right.name.localeCompare(left.name, undefined, { numeric: true }),
        );
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === executable.toLowerCase()) {
        return win.join(current.directory, entry.name);
      }
    }
    if (current.depth >= maxDepth) continue;
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        queue.push({
          directory: win.join(current.directory, entry.name),
          depth: current.depth + 1,
        });
      }
    }
  }
  return null;
}

function windowsExecutableName(command) {
  const normalized = normalizeExecutableName(command);
  return `${normalized}.exe`;
}

function normalizeExecutableName(command) {
  return path.win32
    .basename(unquoteCommand(command))
    .toLowerCase()
    .replace(/\.(?:cmd|exe)$/i, "");
}

function unquoteCommand(command) {
  return String(command).trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => value.toLowerCase()))]
    .map((lowercase) => values.find((value) => value.toLowerCase() === lowercase));
}

function tcpPortReady(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port: Number(port) });
    const finish = (ready) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(700);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function installPackage(packageName) {
  if (process.platform === "darwin") {
    if (!commandAvailable("brew")) {
      throw new Error("Homebrew не найден. Установите Homebrew или пакет вручную.");
    }
    const formula = packageName === "postgresql" ? "postgresql@17" : packageName;
    await runCommand("brew", ["install", formula]);
    if (packageName === "postgresql") {
      await runCommand("brew", ["services", "start", formula]);
    }
    return;
  }
  if (process.platform === "linux" && commandAvailable("apt-get")) {
    await runCommand("sudo", ["apt-get", "update"]);
    const packages = packageName === "postgresql"
      ? ["postgresql", "postgresql-client"]
      : [packageName];
    await runCommand("sudo", ["apt-get", "install", "-y", ...packages]);
    if (packageName === "postgresql") {
      await runCommand("sudo", ["systemctl", "enable", "--now", "postgresql"]);
    }
    return;
  }
  if (process.platform === "win32" && commandAvailable("winget")) {
    if (packageName === "tsduck") {
      await runCommand("winget", [
        "install",
        "tsduck",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ]);
      return;
    }
    const packageId = packageName === "postgresql"
      ? "PostgreSQL.PostgreSQL.17"
      : "Gyan.FFmpeg";
    await runCommand("winget", [
      "install",
      "--id",
      packageId,
      "--exact",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ]);
    return;
  }
  throw new Error(`Автоустановка ${packageName} не поддерживается на этой ОС`);
}

async function createPostgresDatabase({
  admin,
  database,
  host,
  password,
  port,
  psqlPath,
  username,
}) {
  console.log("\nСоздаю/обновляю роль и базу PostgreSQL…");
  const useLocalPeer =
    process.platform === "linux" &&
    isLocalHost(host) &&
    admin.username === "postgres" &&
    !admin.password;
  const command = useLocalPeer ? "sudo" : psqlPath;
  const baseArgs = useLocalPeer
    ? ["-u", "postgres", psqlPath]
    : ["-h", host, "-p", String(port), "-U", admin.username];
  const variableArgs = [
    "--set=ON_ERROR_STOP=1",
    `--set=app_user=${username}`,
    `--set=app_password=${password}`,
    `--set=app_database=${database}`,
    "-d",
    "postgres",
  ];
  const createRoleFormat = password
    ? "format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')"
    : "format('CREATE ROLE %I LOGIN', :'app_user')";
  const alterRoleFormat = password
    ? "format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'app_user', :'app_password')"
    : "format('ALTER ROLE %I WITH LOGIN PASSWORD NULL', :'app_user')";
  const sql = [
    `SELECT ${createRoleFormat} WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \\gexec`,
    `SELECT ${alterRoleFormat} \\gexec`,
    "SELECT format('CREATE DATABASE %I OWNER %I', :'app_database', :'app_user') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_database') \\gexec",
    "SELECT format('ALTER DATABASE %I OWNER TO %I', :'app_database', :'app_user') \\gexec",
  ].join("\n");
  await runCommand(command, [...baseArgs, ...variableArgs], {
    env: { ...process.env, ...(admin.password ? { PGPASSWORD: admin.password } : {}) },
    input: sql,
  });
}

async function installPlatformService({ envPath: environmentPath, kind, serviceUser, start }) {
  if (kind === "systemd") {
    return installSystemdService({ environmentPath, serviceUser, start });
  }
  if (kind === "launchd") {
    return installLaunchAgent({ start });
  }
  if (kind === "windows-task") {
    return installWindowsTask({ start });
  }
  throw new Error(`Фоновый service не поддерживается на platform=${process.platform}`);
}

async function installSystemdService({ environmentPath, serviceUser, start }) {
  if (!commandAvailable("systemctl")) {
    throw new Error("systemctl не найден: автоматическая production-установка доступна только с systemd");
  }
  const passwdCheck = spawnSync("getent", ["passwd", serviceUser], { stdio: "ignore" });
  if (passwdCheck.status !== 0) {
    throw new Error(`Linux-пользователь ${serviceUser} не существует`);
  }
  const unitPath = path.join(tmpdir(), `gruber-media-${process.pid}.service`);
  const unit = buildSystemdUnit({
    environmentPath,
    nodePath: process.execPath,
    rootPath: projectRoot,
    serviceUser,
  });
  await writeFile(unitPath, unit, { encoding: "utf8", mode: 0o644 });
  try {
    const currentUser = process.env.SUDO_USER ?? process.env.USER;
    if (currentUser !== serviceUser) {
      await runCommand("sudo", ["chown", serviceUser, environmentPath]);
    }
    await runCommand("sudo", [
      "install",
      "-m",
      "0644",
      unitPath,
      "/etc/systemd/system/gruber-media.service",
    ]);
    await runCommand("sudo", ["systemctl", "daemon-reload"]);
    await runCommand("sudo", ["systemctl", "enable", "gruber-media.service"]);
    if (start) {
      await runCommand("sudo", ["systemctl", "restart", "gruber-media.service"]);
      await runCommand("sudo", ["systemctl", "--no-pager", "--full", "status", "gruber-media.service"]);
    }
  } finally {
    await rm(unitPath, { force: true });
  }
  return {
    label: "gruber-media.service",
    logs: "journalctl -u gruber-media.service -f",
  };
}

export function buildSystemdUnit({ environmentPath, nodePath, rootPath, serviceUser }) {
  return `[Unit]
Description=FluxIO Media Service
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=${serviceUser}
WorkingDirectory=${quoteSystemd(rootPath)}
Environment=NODE_ENV=production
Environment=GRUBER_PREVIEW_DIR=/run/gruber-playout/preview
EnvironmentFile=${quoteSystemd(environmentPath)}
RuntimeDirectory=gruber-playout
RuntimeDirectoryMode=0750
ExecStart=${quoteSystemd(nodePath)} ${quoteSystemd(path.posix.join(rootPath, "apps/media-server/dist/index.js"))}
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
KillSignal=SIGTERM
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/run/gruber-playout

[Install]
WantedBy=multi-user.target
`;
}

function quoteSystemd(value) {
  return `"${value.replace(/([\\"])/g, "\\$1")}"`;
}

async function installLaunchAgent({ start }) {
  const label = "live.gruber.media";
  const agentsDirectory = path.join(homedir(), "Library", "LaunchAgents");
  const logsDirectory = path.join(homedir(), "Library", "Logs", "GruberPlayout");
  const plistPath = path.join(agentsDirectory, `${label}.plist`);
  await mkdir(agentsDirectory, { recursive: true });
  await mkdir(logsDirectory, { recursive: true });
  const plist = buildLaunchAgentPlist({
    label,
    nodePath: process.execPath,
    rootPath: projectRoot,
    stderrPath: path.join(logsDirectory, "media-service-error.log"),
    stdoutPath: path.join(logsDirectory, "media-service.log"),
  });
  await writeFile(plistPath, plist, { encoding: "utf8", mode: 0o644 });
  const domain = `gui/${process.getuid()}`;
  spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
  if (start) {
    await runCommand("launchctl", ["bootstrap", domain, plistPath]);
    await runCommand("launchctl", ["enable", `${domain}/${label}`]);
    await runCommand("launchctl", ["kickstart", "-k", `${domain}/${label}`]);
    await runCommand("launchctl", ["print", `${domain}/${label}`]);
  }
  return {
    label,
    logs: `tail -f "${path.join(logsDirectory, "media-service.log")}"`,
  };
}

export function buildLaunchAgentPlist({
  label,
  nodePath,
  rootPath,
  stderrPath,
  stdoutPath,
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(path.posix.join(rootPath, "apps/media-server/dist/index.js"))}</string>
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(rootPath)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(stdoutPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(stderrPath)}</string>
</dict>
</plist>
`;
}

async function installWindowsTask({ start }) {
  const taskName = "Gruber Playout Media Service";
  const scriptPath = path.join(projectRoot, "apps/media-server/dist/index.js");
  const command = buildWindowsTaskCommand({
    nodePath: process.execPath,
    rootPath: projectRoot,
    scriptPath,
    start,
    taskName,
  });
  await runCommand("powershell.exe", ["-NoProfile", "-Command", command]);
  if (start) {
    await runCommand("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-ScheduledTask -TaskName '${taskName}' | Format-List TaskName,State`,
    ]);
  }
  return {
    label: taskName,
    logs: "Get-ScheduledTask -TaskName 'Gruber Playout Media Service'",
  };
}

export function buildWindowsTaskCommand({ nodePath, rootPath, scriptPath, start, taskName }) {
  const actionArguments = `\"${scriptPath}\"`;
  return [
    `$action = New-ScheduledTaskAction -Execute '${escapePowerShell(nodePath)}' -Argument '${escapePowerShell(actionArguments)}' -WorkingDirectory '${escapePowerShell(rootPath)}'`,
    "$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name",
    "$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser",
    "$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited",
    `Register-ScheduledTask -TaskName '${escapePowerShell(taskName)}' -Action $action -Trigger $trigger -Principal $principal -Description 'Gruber Playout Media Service' -Force | Out-Null`,
    ...(start ? [`Start-ScheduledTask -TaskName '${escapePowerShell(taskName)}'`] : []),
  ].join("; ");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapePowerShell(value) {
  return value.replaceAll("'", "''");
}

function platformServiceKind() {
  if (process.platform === "linux") return { id: "systemd", label: "systemd" };
  if (process.platform === "darwin") return { id: "launchd", label: "macOS LaunchAgent" };
  if (process.platform === "win32") {
    return { id: "windows-task", label: "Windows Task Scheduler" };
  }
  return { id: "foreground", label: "foreground process" };
}

async function runCommand(command, args, options = {}) {
  console.log(`\n→ ${renderCommand(command, args)}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: [options.input == null ? "inherit" : "pipe", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} завершился с code=${code ?? "null"}, signal=${signal ?? "none"}`));
    });
    if (options.input != null) child.stdin.end(options.input);
  });
}

async function runNpmCommand(args, options = {}) {
  await runCommand(
    npmInvocation.command,
    [...npmInvocation.prefixArgs, ...args],
    { ...options, shell: npmInvocation.shell },
  );
}

function renderCommand(command, args) {
  const redacted = args.map((argument) =>
    argument.startsWith("--set=app_password=")
      ? "--set=app_password=***"
      : /password/i.test(argument) && argument.includes("postgresql://")
        ? "***"
        : argument,
  );
  return [command, ...redacted].join(" ");
}

async function launchApplication(mode, env, mediaApiUrl) {
  console.log("\nЗапускаю FluxIO. Для остановки нажмите Ctrl+C.\n");
  const processes = [];
  const mediaScript = mode === "production" ? "start:server" : "dev:server";
  processes.push(spawnManagedNpm(["run", mediaScript], env));
  await waitForUrl(`${mediaApiUrl}/api/health`, 30_000);
  if (mode === "test") {
    processes.push(spawnManagedNpm(["run", "dev:web"], env));
    await waitForUrl("http://127.0.0.1:5173", 30_000);
    processes.push(spawnManagedNpm(["run", "dev:desktop"], env));
  } else {
    processes.push(spawnManagedNpm(["run", "start:desktop"], env));
  }

  await new Promise((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    processes[0].once("exit", stop);
  });
  await stopProcesses(processes);
}

async function launchDesktop(env) {
  console.log("\nMedia-service уже работает в фоне. Запускаю Electron…\n");
  await new Promise((resolve, reject) => {
    const child = spawn(
      npmInvocation.command,
      [...npmInvocation.prefixArgs, "run", "start:desktop"],
      {
        cwd: projectRoot,
        env,
        shell: npmInvocation.shell,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 || signal) resolve();
      else reject(new Error(`Electron завершился с code=${code}`));
    });
  });
  console.log("Electron закрыт; media-service продолжает работать в фоне.");
}

function spawnManagedNpm(args, env) {
  return spawnManaged(
    npmInvocation.command,
    [...npmInvocation.prefixArgs, ...args],
    env,
    { shell: npmInvocation.shell },
  );
}

function spawnManaged(command, args, env, options = {}) {
  return spawn(command, args, {
    cwd: projectRoot,
    detached: process.platform !== "win32",
    env,
    shell: options.shell ?? false,
    stdio: "inherit",
  });
}

async function stopProcesses(processes) {
  for (const child of processes) {
    if (child.exitCode != null || child.signalCode != null) continue;
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      // Process already stopped.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Сервис не стал доступен за ${timeoutMs / 1000} секунд: ${url}`);
}

function printSummary({ databaseUrl, installedService, mode, startNow, values }) {
  console.log("\nУстановка завершена");
  console.log("===================");
  console.log(`Режим: ${mode === "production" ? "production" : "test / development"}`);
  console.log(`PostgreSQL: ${redactDatabaseUrl(databaseUrl)}`);
  console.log(`Media API: ${values.GRUBER_MEDIA_API_URL}`);
  console.log(`FFmpeg: ${values.FFMPEG_PATH}`);
  console.log(`TSDuck: ${values.TSDUCK_PATH}`);
  console.log(`Конфигурация: ${envPath}`);
  if (installedService) {
    console.log(`Background service: ${installedService.label}`);
    console.log(`Логи/статус: ${installedService.logs}`);
  }
  if (!startNow) console.log("Запуск пропущен. Повторите npm run setup или используйте команды из документации.");
}

function redactDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "configured";
  }
}

function formatUrlHost(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isLocalHost(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(host);
}

function validatePgName(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(value)) {
    throw new Error("Допустимы латинские буквы, цифры, _ и -, первый символ — буква или _");
  }
  return value;
}

function validateSystemUser(value) {
  if (!/^[a-z_][a-z0-9_-]*[$]?$/.test(value)) {
    throw new Error("Некорректное имя Linux-пользователя");
  }
  if (value === "root") {
    throw new Error("Не запускайте media-service от root");
  }
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\nОшибка установки: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
