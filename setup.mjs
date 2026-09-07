#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { formatBundleSummary } from "./scripts/bundle-manifest.mjs";
import {
  bundleMigrationsDirectory,
  bundleToolPaths,
  detectBundleRoot,
  readBundleManifest,
  verifyBundleComponents,
} from "./scripts/bundle-install.mjs";
import { gstreamerEnvironment } from "./scripts/bundle-gstreamer.mjs";
import { applyBundleMigrations, readBundleMigrations } from "./scripts/bundle-migrations.mjs";
import {
  applyBundleUpdate,
  planUpdate,
  updateRefusal,
} from "./scripts/bundle-update.mjs";
import {
  publicInstances,
  readInstanceRegistry,
  renameInstance,
  sharedEnvFileName,
  writeInstanceRegistry,
} from "./scripts/instance-registry.mjs";
import { buildNpmInvocation } from "./scripts/npm-invocation.mjs";
import {
  buildPostgresLaunchAgentPlist,
  buildPostgresSystemdUnit,
  buildPostgresWindowsTaskCommand,
  clusterDataDirectory,
  clusterEnvironment,
  ensureRoleAndDatabase,
  pgCtlStartArguments,
  pgCtlStopArguments,
  postgresExecutables,
  postgresLaunchAgentLabel,
  postgresServiceName,
  postgresWindowsTaskName,
  provisionCluster,
  readOrCreateSuperuserPassword,
} from "./scripts/bundle-postgres.mjs";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(projectRoot, ".env");
// Станционный конфиг: общие для всех программ значения (пути к инструментам,
// секрет, GRUBER_HOST, координаты PostgreSQL). Первичная установка пишет только
// его; ни одной программы не создаётся — их добавляют из Control Center.
const sharedEnvPath = path.join(projectRoot, sharedEnvFileName);
const noStart = process.argv.includes("--no-start");
const addInstanceFlag = process.argv.includes("--add-instance");
const renameInstanceId = flagValue("--rename-instance");
const instanceNameArgument = flagValue("--instance-name");
const instancePortArgument = flagValue("--instance-port");
const instanceDatabaseArgument = flagValue("--instance-database");
const instanceAdminArgument = flagValue("--instance-admin");
const instanceAdminPasswordArgument = flagValue("--instance-admin-password");
const disableInstanceId = flagValue("--disable-instance");
const enableInstanceId = flagValue("--enable-instance");
const removeInstanceId = flagValue("--remove-instance");
const deleteInstanceId = flagValue("--delete-instance");
const stopAllFlag = process.argv.includes("--stop-all");
const resetFlag = process.argv.includes("--reset");
/**
 * Офлайн-режим спрашивается первым вопросом мастера, поэтому значение меняется
 * в рантайме. Флаг `--offline` отвечает на вопрос заранее и пропускает его.
 */
const offlineFlagPassed = process.argv.includes("--offline");
let offline = offlineFlagPassed;
/**
 * Установка из офлайн-комплекта.
 *
 * Комплект — это уже собранное дерево плюс медиастек, Node и схема. Мастер в
 * этом режиме ничего не собирает и никуда не ходит: он проверяет целостность,
 * поднимает базу, применяет миграции и записывает `.env` с путями из комплекта.
 */
const bundleFlag = process.argv.find((argument) => argument.startsWith("--bundle"));
const bundlePathArgument = bundleFlag?.includes("=") ? bundleFlag.split("=").slice(1).join("=") : null;
/**
 * Обновление установленного комплекта: `--update=<каталог установки>`.
 *
 * Новый комплект распаковывается рядом и переносит в установленный каталог
 * только изменившиеся компоненты. База и `.env` остаются на месте — иначе
 * обновление стоило бы оператору всей станции.
 */
const updateFlag = process.argv.find((argument) => argument.startsWith("--update"));
const updatePathArgument = updateFlag?.includes("=")
  ? updateFlag.split("=").slice(1).join("=")
  : null;
let bundleRoot = null;
let bundleManifest = null;
let bundleTools = {};
/** Кластер из комплекта: заполняется, когда мастер его развернул. */
let bundlePostgres = null;
/** Сколько резервных копий `.env` держим на диске: последняя и предыдущая. */
const envBackupsToKeep = 2;
const skipGstreamerDvbCheck = process.argv.includes("--skip-gstreamer-check") ||
  ["1", "true", "yes"].includes(String(process.env.FLUXIO_SKIP_GSTREAMER_CHECK ?? "").toLowerCase());
const npmInvocation = buildNpmInvocation();

export { buildNpmInvocation };
const applicationVersion = JSON.parse(
  readFileSync(path.join(projectRoot, "package.json"), "utf8"),
).version;
const retiredSourceFiles = [
  "apps/media-server/src/effects/font-metrics.ts",
  "apps/media-server/src/effects/lottie.ts",
  "apps/media-server/src/ffmpeg/text-overlay.ts",
  "apps/web/src/lottie-properties.ts",
];

function flagValue(name) {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

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

/**
 * Нативные библиотеки, которые Windows держит открытыми.
 *
 * `npm ci` сносит `node_modules` целиком, а `.node` работающего процесса
 * Windows удалить не даёт: установка обрывается на `EPERM: unlink`, и по этому
 * дампу непонятно, что виноват не установщик, а незакрытый FluxIO. На POSIX
 * такой беды нет — там открытый файл удаляется, — но искать занятые всё равно
 * дешевле, чем разбирать чужую ошибку.
 */
export function nativeModuleDirectories() {
  return [
    "node_modules/@napi-rs",
    "node_modules/@prisma",
    "node_modules/electron/dist",
  ];
}

/**
 * Занятые файлы среди нативных библиотек.
 *
 * Занятость проверяется переименованием на месте: открыть файл на чтение
 * Windows даёт и занятому, а переименовать — нет. Файл возвращается на место
 * сразу же, поэтому проверка ничего не ломает даже на полпути.
 */
export async function findLockedNativeFiles(root, {
  readdir: readDirectory = readdir,
  rename: renameFile = rename,
} = {}) {
  const locked = [];
  for (const directory of nativeModuleDirectories()) {
    const base = path.join(root, directory);
    let entries;
    try {
      entries = await readDirectory(base, { recursive: true, withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(node|dll|exe)$/i.test(entry.name)) continue;
      const filePath = path.join(entry.parentPath ?? entry.path ?? base, entry.name);
      const probe = `${filePath}.fluxio-probe`;
      try {
        await renameFile(filePath, probe);
        await renameFile(probe, filePath);
      } catch {
        locked.push(filePath);
      }
    }
  }
  return locked;
}

/** Что сказать оператору про занятые файлы: причина и что с ней делать. */
export function describeLockedNativeFiles(files) {
  if (files.length === 0) return null;
  const listed = files.slice(0, 3).map((file) => `  ${file}`).join("\n");
  const rest = files.length > 3 ? `\n  … и ещё ${files.length - 3}` : "";
  return [
    "FluxIO ещё работает: переустановка зависимостей снесёт node_modules, а эти файлы",
    "заняты запущенным процессом и не удаляются:",
    `${listed}${rest}`,
    "",
    "Закройте окно FluxIO и остановите фоновую службу, затем повторите установку.",
    "Если по этой машине идёт эфир — сначала выведите его из линии: остановка службы обрывает выдачу.",
    process.platform === "win32"
      ? "Windows: Stop-ScheduledTask -TaskName 'FluxIO', затем закройте оставшиеся node.exe в диспетчере задач."
      : "Служба: sudo systemctl stop fluxio (Linux) или launchctl bootout (macOS).",
    "Если процессов нет, файл мог захватить антивирус — повторите через минуту.",
  ].join("\n");
}

export function desktopPackagingScript({
  buildInstaller,
  mode,
  offlineMode,
}) {
  if (mode !== "production") return null;
  if (offlineMode) return "package:desktop:offline-dir";
  return buildInstaller ? "package:desktop" : null;
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

  // Обновление передаёт работу мастеру установленного каталога и на этом
  // заканчивается: остальные шаги делает уже он.
  if (await prepareBundle()) return;

  if (stopAllFlag || resetFlag) {
    await stopOrResetStation();
    return;
  }

  if (addInstanceFlag || renameInstanceId || disableInstanceId || enableInstanceId || removeInstanceId || deleteInstanceId) {
    await manageInstances();
    return;
  }

  const existingEnv = await loadExistingEnv();
  const prompt = new Prompt();

  try {
    offline = await askOfflineMode(prompt);
    if (offline) {
      console.log("\n  Сетевые установки и npm ci отключены.");
      console.log("  Зависимости, Electron runtime и медиаинструменты берутся из дерева проекта.");
    }

    const mode = await askProjectMode(prompt);
    // Здесь спрашиваем только координаты сервера PostgreSQL и общую роль —
    // саму базу заводит уже создание программы.
    const database = await askDatabase(prompt, mode, existingEnv);
    const service = await askMediaService(prompt, existingEnv);
    const actions = await askWizardActions(prompt, mode);

    if (offline && !bundleRoot) {
      assertOfflineBuildDependencies({ requireElectron: true });
    }

    const tools = await resolveMediaTools(prompt, service);
    await ensurePostgresServer(prompt, database);

    const values = buildSharedEnvironmentValues({ database, existingEnv, mode, service, tools });
    await saveSharedEnv(values);
    await ensureInstanceRegistryFile();

    const commandEnv = { ...process.env, ...values };

    await runBuildPipeline(commandEnv, mode, actions);
    if (!noStart) await restartAdditionalInstances(`http://127.0.0.1:${values.GRUBER_PORT}`);
    await finishInstallation(commandEnv, mode, actions, values);
  } finally {
    prompt.close();
  }
}

/**
 * `--stop-all` — остановить станцию целиком; `--reset` — снести её до
 * состояния «до установки» и дать поставить заново.
 *
 * Системный PostgreSQL не трогается ни в одном режиме: на машине он обслуживает
 * не только FluxIO, и остановить его — значит уронить чужие базы. Кластер из
 * комплекта — наш, его останавливаем.
 *
 * `--reset` удаляет ровно те базы, что named в `.env` программ: искать их по
 * маске имени нельзя — рядом стоят базы, к FluxIO отношения не имеющие.
 */
async function stopOrResetStation() {
  const registry = await readInstanceRegistry(projectRoot, "http://127.0.0.1:4310");
  if (registry.instances.length === 0) console.log("\nПрограмм в реестре нет.");

  // Копия списка: удаление правит сам реестр по ходу.
  for (const instance of [...registry.instances]) {
    // Уже молчащую программу не останавливаем повторно: `launchctl bootout` по
    // выгруженному агенту отвечает ошибкой, и оператор видел бы красное там,
    // где всё в порядке. Для `--reset` идём в любом случае — там надо снести
    // службу, базу и файлы, а не только погасить процесс.
    if (!resetFlag && !(await tcpPortReady("127.0.0.1", Number(new URL(instance.apiUrl).port)))) {
      console.log(`\nПрограмма ${instance.name}: уже остановлена`);
      continue;
    }
    console.log(`\n${resetFlag ? "Удаляю" : "Останавливаю"} программу: ${instance.name}`);
    try {
      if (resetFlag) await deleteInstance(registry, instance.id);
      else await stopInstanceService(instance);
    } catch (error) {
      // Одна упавшая программа не должна оставить остальные работающими:
      // «остановить всё» обязано дойти до конца и назвать, что не вышло.
      console.error(`  не удалось: ${errorMessage(error)}`);
    }
  }

  await stopBundledPostgres();
  await waitForStationRelease(registry.instances);

  if (!resetFlag) {
    console.log("\nСтанция остановлена. Данные, конфигурация и службы на месте.");
    return;
  }

  for (const name of [sharedEnvFileName, "instances.json"]) {
    await rm(path.join(projectRoot, name), { force: true });
  }
  console.log(
    `\nСтанция сброшена: программы, их базы и службы удалены, ${sharedEnvFileName} и ` +
      "instances.json убраны.\nСтавьте заново: npm run setup",
  );
}

/**
 * Ждёт, пока станция действительно отпустит машину.
 *
 * Команда остановки возвращает управление раньше, чем процесс успел выйти:
 * `Stop-ScheduledTask` на Windows и `launchctl bootout` на macOS не дожидаются
 * его. Продолжить сразу — значит наткнуться на `EPERM: unlink` у занятого
 * `.node` при следующей установке, а на удалении каталога — на «файл
 * используется другим процессом». Поэтому ждём по двум признакам: порт API
 * замолчал и нативные файлы отпущены.
 */
async function waitForStationRelease(instances, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  const ports = instances.map((instance) => Number(new URL(instance.apiUrl).port));
  while (Date.now() < deadline) {
    const busy = [];
    for (const port of ports) {
      if (await tcpPortReady("127.0.0.1", port)) busy.push(port);
    }
    if (busy.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Занятый `.node` переживает освободившийся порт: службу сняли, а процесс ещё
  // выгружается. Именно он и ломает переустановку на Windows.
  const locked = await findLockedNativeFiles(projectRoot);
  if (locked.length === 0) return;
  console.warn(`\n${describeLockedNativeFiles(locked)}`);
}

async function stopInstanceService(instance) {
  const service = instanceService(instance);
  const stop = platformServiceStopCommand(service);
  await runCommand(stop.command, stop.args);
}

/** Останавливает кластер из комплекта, если он развёрнут в этой установке. */
async function stopBundledPostgres() {
  const root = bundleRoot ?? path.dirname(projectRoot);
  const dataDirectory = clusterDataDirectory(root);
  if (!existsSync(dataDirectory)) return;
  const pgCtl = bundleTools.pgCtl
    ?? postgresExecutables(path.join(root, bundleManifest?.tools?.postgres ?? "tools/postgres")).pgCtl;
  if (!pgCtl || !existsSync(pgCtl)) return;
  console.log("\nОстанавливаю кластер PostgreSQL из комплекта…");
  await runCommand(pgCtl, pgCtlStopArguments({ dataDirectory }), { env: clusterEnvironment() })
    .catch((error) => console.error(`  не удалось: ${errorMessage(error)}`));
}

async function manageInstances() {
  const existingEnv = await loadExistingEnv();
  if (!existingEnv.GRUBER_DB_USER && !existingEnv.DATABASE_URL) {
    throw new Error("Сначала выполните установку станции: npm run setup");
  }
  const registry = await readInstanceRegistry(
    projectRoot,
    existingEnv.GRUBER_MEDIA_API_URL ?? "http://127.0.0.1:4310",
  );
  if (addInstanceFlag) {
    const prompt = new Prompt();
    try {
      await addInstance(prompt, registry, existingEnv);
    } finally {
      prompt.close();
    }
    return;
  }
  if (renameInstanceId) {
    await writeInstanceRegistry(
      projectRoot,
      renameInstance(registry, renameInstanceId, instanceNameArgument),
    );
    console.log(`Программа переименована: ${instanceNameArgument}`);
    return;
  }
  if (deleteInstanceId) {
    await deleteInstance(registry, deleteInstanceId);
    return;
  }
  await setInstanceEnabled(
    registry,
    disableInstanceId ?? removeInstanceId ?? enableInstanceId,
    Boolean(enableInstanceId),
  );
}

async function deleteInstance(registry, id) {
  const instance = registry.instances.find((entry) => entry.id === id);
  if (!instance) throw new Error(`Программа не найдена: ${id}`);
  if (await instanceIsOnAir(instance.apiUrl)) {
    throw new Error(`Программа ${instance.name} находится в эфире. Сначала выполните Stop playout.`);
  }

  const environmentPath = path.join(projectRoot, instance.environmentFile);
  const environment = parseEnv(await readFile(environmentPath, "utf8"));
  const service = instanceService(instance);
  if (service.kind === "systemd") {
    await runCommand("sudo", ["systemctl", "disable", "--now", service.label]);
    await runCommand("sudo", ["rm", "-f", `/etc/systemd/system/${service.label}`]);
    await runCommand("sudo", ["systemctl", "daemon-reload"]);
  } else if (service.kind === "launchd") {
    spawnSync("launchctl", ["bootout", service.domain, service.plistPath], { stdio: "ignore" });
    await rm(service.plistPath, { force: true });
  } else {
    await runCommand("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Stop-ScheduledTask -TaskName '${escapePowerShell(service.label)}' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName '${escapePowerShell(service.label)}' -Confirm:$false`,
    ]);
  }

  await dropInstanceDatabase(environment.DATABASE_URL);
  await rm(environmentPath, { force: true });
  if (bundleRoot) await rm(path.join(bundleRoot, "data", "instances", id), { force: true, recursive: true });
  registry.instances = registry.instances.filter((entry) => entry.id !== id);
  await writeInstanceRegistry(projectRoot, registry);
  console.log(`Программа ${instance.name} удалена вместе со службой, базой и файлами.`);
}

async function dropInstanceDatabase(databaseUrl) {
  const database = parseExistingDatabase(databaseUrl);
  if (!database.database) throw new Error("Не удалось определить базу удаляемой программы");
  const { default: pg } = await import("pg");
  // Подключаемся к `postgres`, а НЕ к удаляемой базе: `pg` игнорирует поле
  // `database` рядом с `connectionString`, поэтому смещаем путь в самой строке.
  // Иначе `pg_terminate_backend` обрывает собственную сессию мастера
  // («terminating connection due to administrator command») и `DROP` не доходит.
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  const nonInteractiveAdmin = instanceNameArgument != null || deleteInstanceId != null
    ? resolveNonInteractiveDbAdmin()
    : null;
  if (nonInteractiveAdmin?.username) {
    url.username = encodeURIComponent(nonInteractiveAdmin.username);
    url.password = nonInteractiveAdmin.password ? encodeURIComponent(nonInteractiveAdmin.password) : "";
  }
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [database.database],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quotePgIdentifier(database.database)}`);
  } finally {
    await admin.end();
  }
}

function quotePgIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Общая роль PostgreSQL и координаты сервера: у первой программы — из
 * станционного конфига, у последующих — из `.env` первой программы (та же роль,
 * своя база).
 */
async function resolveInstanceRole(registry, sharedEnv, firstInstance) {
  if (firstInstance) {
    return {
      username: sharedEnv.GRUBER_DB_USER ?? "",
      password: sharedEnv.GRUBER_DB_PASSWORD ?? "",
      port: Number(sharedEnv.GRUBER_PG_PORT) || 5432,
      database: sharedEnv.GRUBER_DB_NAME || "gruber",
    };
  }
  const firstEnv = parseEnv(
    await readFile(path.join(projectRoot, registry.instances[0].environmentFile), "utf8"),
  );
  const parsed = parseExistingDatabase(firstEnv.DATABASE_URL);
  return {
    username: parsed.username ?? "",
    password: parsed.password ?? "",
    port: parsed.port ?? 5432,
    database: parsed.database ?? "gruber",
  };
}

async function addInstance(prompt, registry, sharedEnv) {
  // Первая программа заводит общую роль и берёт дефолтный порт/имя базы из
  // станционного конфига; последующие наследуют роль от первой и получают
  // следующий свободный порт и суффикс `_pN` у имени базы.
  const firstInstance = registry.instances.length === 0;
  const number = firstInstance ? 1 : nextInstanceNumber(registry.instances);
  const id = `program-${number}`;
  const nonInteractive = instanceNameArgument != null;
  const name = instanceNameArgument == null
    ? await prompt.text("Название новой программы", firstInstance ? "Program 1" : `Program ${number}`, validateInstanceName)
    : validateInstanceName(instanceNameArgument);
  // Порт по умолчанию обязан быть свободен и в реестре, и в системе. Кнопка
  // «Добавить программу» порт не спрашивает, и отказ на занятом порту не
  // оставлял бы оператору никакого выхода. Освобождать порт самим нельзя: его
  // держит работающая программа, и снять её — значит оборвать эфир ради
  // установки. Поэтому берём следующий свободный.
  const defaultPort = await firstFreeInstancePort(
    registry.instances,
    firstInstance ? Number(sharedEnv.GRUBER_PORT) || 4310 : nextInstancePort(registry.instances),
  );
  const port = instancePortArgument == null && !nonInteractive
    ? await prompt.text("API port", String(defaultPort), (value) => validatePort(value, "API port"))
    : validatePort(instancePortArgument ?? defaultPort, "API port");
  // Явно названный порт не подменяем: это выбор оператора, и тихая подмена
  // увела бы программу не на тот порт, который он прописал головной станции.
  if (registry.instances.some((entry) => Number(new URL(entry.apiUrl).port) === port)) {
    throw new Error(`API port ${port} уже используется другой программой`);
  }
  if (await tcpPortReady("127.0.0.1", port)) {
    throw new Error(
      `API port ${port} уже занят другим процессом. ` +
        `Освободите его или укажите другой: --instance-port=${defaultPort}`,
    );
  }

  const base = await resolveInstanceRole(registry, sharedEnv, firstInstance);
  if (!base.username) {
    throw new Error("Не удалось определить роль PostgreSQL — перезапустите npm run setup");
  }
  const defaultDatabase = firstInstance
    ? base.database
    : instanceDatabaseName(base.database, number);
  const database = instanceDatabaseArgument == null && !nonInteractive
    ? await prompt.text("Имя базы PostgreSQL", defaultDatabase, validatePgName)
    : validatePgName(instanceDatabaseArgument ?? defaultDatabase);
  for (const instance of registry.instances) {
    const environment = parseEnv(await readFile(path.join(projectRoot, instance.environmentFile), "utf8"));
    if (parseExistingDatabase(environment.DATABASE_URL).database === database) {
      throw new Error(`База ${database} уже принадлежит программе ${instance.name}`);
    }
  }
  const databaseConfig = {
    admin: null,
    database,
    host: sharedEnv.GRUBER_PG_HOST || "127.0.0.1",
    password: base.password ?? "",
    port: base.port ?? 5432,
    ready: false,
    username: base.username,
  };

  if (bundleRoot && bundleTools.initdb && bundleTools.pgCtl) {
    await prepareBundledPostgres(databaseConfig);
  } else {
    const psqlPath = await ensureTool(prompt, "psql", "PostgreSQL client", "postgresql", "psql", false);
    // Роль общая для всех программ. Первая программа её создаёт (если станция не
    // сообщила, что роль и база уже есть); последующие роль не трогают — под
    // самой ролью `ALTER ROLE` запрещён. Привилегированные шаги (`CREATE ROLE`,
    // `CREATE DATABASE`) идут под администратором: в интерактиве спрашиваем,
    // без него — env/флаг → суперпользователь ОС.
    const admin = instanceNameArgument == null
      ? await askDatabaseAdmin(prompt, false)
      : resolveNonInteractiveDbAdmin();
    const manageRole = firstInstance && sharedEnv.GRUBER_DB_READY !== "1";
    const pgIsReadyPath = discoverToolPath(siblingExecutable(psqlPath, "pg_isready"), "pg_isready");
    await ensurePostgresReady(prompt, databaseConfig.host, databaseConfig.port, pgIsReadyPath);
    await createPostgresDatabase({ ...databaseConfig, admin, manageRole, psqlPath });
  }

  const apiHost = sharedEnv.GRUBER_HOST ?? "127.0.0.1";
  const apiClientHost = ["0.0.0.0", "::"].includes(apiHost) ? "127.0.0.1" : apiHost;
  const runtimeRoot = bundleRoot
    ? path.join(bundleRoot, "data", "instances", id)
    : path.join(tmpdir(), `gruber-playout-${id}`);
  // Программе едут только общие значения станции: ключи выбора роли/сервера
  // PostgreSQL в её `.env` не нужны — DATABASE_URL самодостаточен.
  const inherited = { ...sharedEnv };
  for (const key of [
    "GRUBER_PG_HOST", "GRUBER_PG_PORT", "GRUBER_DB_USER",
    "GRUBER_DB_PASSWORD", "GRUBER_DB_NAME", "GRUBER_DB_READY",
  ]) delete inherited[key];
  const values = {
    ...inherited,
    DATABASE_URL: buildDatabaseUrl(databaseConfig),
    GRUBER_PORT: String(port),
    GRUBER_MEDIA_API_URL: `http://${formatUrlHost(apiClientHost)}:${port}`,
    GRUBER_PREVIEW_DIR: path.join(runtimeRoot, "preview"),
    GRUBER_MEDIA_CACHE_DIR: path.join(runtimeRoot, "media-cache"),
    GRUBER_EFFECT_CACHE_DIR: path.join(runtimeRoot, "effect-cache"),
    GRUBER_LOG_DIR: path.join(runtimeRoot, "logs"),
  };
  const environmentFile = `.env.${id}`;
  const environmentPath = path.join(projectRoot, environmentFile);
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(environmentPath, serializeEnv(values), { encoding: "utf8", mode: 0o600 });

  const commandEnv = { ...process.env, ...values };
  if (bundleRoot) await applyBundleSchema(values.DATABASE_URL);
  else await runNpmCommand(["run", "db:migrate"], { env: commandEnv });

  const serviceKind = platformServiceKind();
  const serviceUser = serviceKind.id === "systemd"
    ? await prompt.text(
      "Linux-пользователь для media-service",
      process.env.SUDO_USER ?? process.env.USER ?? "gruber",
      validateSystemUser,
    )
    : null;
  const installed = await installPlatformService({
    envPath: environmentPath,
    instanceId: id,
    kind: serviceKind.id,
    // Кластер из комплекта уже поднят своим юнитом на установке станции.
    managePostgres: false,
    serviceUser,
    start: true,
  });
  await waitForUrl(`${values.GRUBER_MEDIA_API_URL}/api/health`, 30_000);
  registry.instances.push({ id, name, apiUrl: values.GRUBER_MEDIA_API_URL, environmentFile, enabled: true });
  await writeInstanceRegistry(projectRoot, registry);
  console.log(`\nПрограмма создана: ${name}`);
  console.log(`API: ${values.GRUBER_MEDIA_API_URL}`);
  console.log(`Database: ${database}`);
  console.log(`Service: ${installed.label}`);
}

async function setInstanceEnabled(registry, id, enabled) {
  const instance = registry.instances.find((entry) => entry.id === id);
  if (!instance) throw new Error(`Программа не найдена: ${id}`);
  if (!enabled && await instanceIsOnAir(instance.apiUrl)) {
    throw new Error(`Программа ${id} находится в эфире. Сначала выполните Stop playout.`);
  }
  const service = instanceService(instance);
  if (service.kind === "systemd") {
    await runCommand("sudo", ["systemctl", enabled ? "enable" : "disable", "--now", service.label]);
  } else if (service.kind === "launchd") {
    if (enabled) {
      await runCommand("launchctl", ["bootstrap", service.domain, service.plistPath]);
      await runCommand("launchctl", ["enable", `${service.domain}/${service.label}`]);
      await runCommand("launchctl", ["kickstart", "-k", `${service.domain}/${service.label}`]);
    } else {
      await runCommand("launchctl", ["bootout", service.domain, service.plistPath]);
    }
  } else {
    const action = enabled
      ? `Enable-ScheduledTask -TaskName '${escapePowerShell(service.label)}'; Start-ScheduledTask -TaskName '${escapePowerShell(service.label)}'`
      : `Stop-ScheduledTask -TaskName '${escapePowerShell(service.label)}' -ErrorAction SilentlyContinue; Disable-ScheduledTask -TaskName '${escapePowerShell(service.label)}'`;
    await runCommand("powershell.exe", ["-NoProfile", "-Command", action]);
  }
  instance.enabled = enabled;
  await writeInstanceRegistry(projectRoot, registry);
  console.log(`Программа ${instance.name}: ${enabled ? "включена" : "отключена, данные сохранены"}.`);
}

async function instanceIsOnAir(apiUrl) {
  try {
    const response = await fetch(new URL("/api/playout/status", apiUrl), {
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return false;
    const status = await response.json();
    return ["starting", "running", "stopping"].includes(status?.state);
  } catch {
    return false;
  }
}

function instanceService(instance) {
  const isDefault = instance.environmentFile === ".env";
  const suffix = isDefault ? "" : `-${instance.id}`;
  if (process.platform === "linux") {
    return { kind: "systemd", label: `gruber-media${suffix}.service` };
  }
  if (process.platform === "darwin") {
    const label = `live.gruber.media${isDefault ? "" : `.${instance.id}`}`;
    const plistPath = path.join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
    return { kind: "launchd", label, domain: `gui/${process.getuid()}`, plistPath };
  }
  return {
    kind: "windows-task",
    label: `Gruber Playout Media Service${isDefault ? "" : ` ${instance.id}`}`,
  };
}

export function nextInstanceNumber(instances) {
  const used = new Set(instances.map((entry) => Number(entry.id.match(/^program-(\d+)$/)?.[1] ?? 0)));
  for (let number = 1; number <= 999; number += 1) if (!used.has(number)) return number;
  throw new Error("Достигнут предел программ");
}

export function nextInstancePort(instances, firstPort = 4310) {
  const used = new Set(instances.map((entry) => Number(new URL(entry.apiUrl).port)));
  for (let port = firstPort; port <= 65_535; port += 1) if (!used.has(port)) return port;
  throw new Error("Нет свободного API-порта");
}

/**
 * Первый порт, свободный и в реестре, и в системе.
 *
 * Реестра мало: на машине может стоять вторая установка FluxIO (комплект рядом
 * с деревом разработки) или чужая служба — её порта в нашем реестре нет, а порт
 * занят. Проверка живая, поэтому идёт отдельной асинхронной функцией.
 */
export async function firstFreeInstancePort(instances, firstPort = 4310, isBusy = tcpPortReady) {
  const used = new Set(instances.map((entry) => Number(new URL(entry.apiUrl).port)));
  for (let port = firstPort; port <= 65_535; port += 1) {
    if (used.has(port)) continue;
    if (await isBusy("127.0.0.1", port)) continue;
    return port;
  }
  throw new Error("Нет свободного API-порта");
}

export function instanceDatabaseName(baseName, number) {
  return `${baseName.slice(0, 52)}_p${number}`;
}

function validateInstanceName(value) {
  const name = value.trim();
  if (!name || name.length > 80) throw new Error("Название должно содержать от 1 до 80 символов");
  return name;
}

//
// Вопросы мастера: каждый блок отвечает за один экран установки
//

/**
 * Первый вопрос мастера. Офлайн-режим меняет весь дальнейший сценарий — сетевые
 * установки и `npm ci` отключаются, а зависимости обязаны уже лежать в дереве, —
 * поэтому спросить нужно до всего остального.
 */
async function askOfflineMode(prompt) {
  if (bundleRoot) {
    console.log("\n1. Тип установки: офлайн-комплект");
    return true;
  }
  if (offlineFlagPassed) {
    console.log("\n1. Тип установки: офлайн (передан --offline)");
    return true;
  }
  return prompt.choose(
    "1. Тип установки",
    [
      { label: "Обычная — есть доступ в интернет", value: false },
      { label: "Офлайн — без интернета, всё из подготовленного дерева", value: true },
    ],
    0,
  );
}

async function askProjectMode(prompt) {
  return prompt.choose(
    "2. Режим проекта",
    [
      { label: "Тест / разработка", value: "test" },
      { label: "Production", value: "production" },
    ],
    0,
  );
}

async function askDatabase(prompt, mode, existingEnv) {
  const existing = parseExistingDatabase(existingEnv.DATABASE_URL);
  const host = "127.0.0.1";

  console.log("\n2. PostgreSQL (без Docker)");
  // Кластер из комплекта разворачивает сам мастер: спрашивать про чужого
  // администратора и существующую базу здесь нечего.
  const bundled = Boolean(bundleTools.initdb && bundleTools.pgCtl);
  if (bundled) {
    console.log(`  Кластер из комплекта: ${clusterDataDirectory(bundleRoot)}`);
  }
  const ready = bundled
    ? false
    : await prompt.confirm("Пользователь и база уже существуют?", mode === "production");

  console.log("  PostgreSQL: 127.0.0.1 (локально, SSL отключён)");
  // Кластер из комплекта — приватный для FluxIO, к нему больше никто не ходит,
  // поэтому по умолчанию он берёт нестандартный порт: 5432 на машине обычно уже
  // занят системным PostgreSQL, и установка молча уводила бы подключение на него.
  const port = await prompt.text(
    bundled ? "Порт кластера PostgreSQL из комплекта" : "PostgreSQL port",
    String(existing.port ?? (bundled ? 5544 : 5432)),
    (value) => validatePort(value, "PostgreSQL port"),
  );
  const database = await prompt.text(
    "Имя базы",
    existing.database ?? "gruber",
    validatePgName,
  );
  const username = await prompt.text(
    "Имя пользователя PostgreSQL",
    existing.username ?? "gruber",
    validatePgName,
  );
  const password = await askDatabasePassword(prompt, ready, existing.password ?? "");
  const admin = bundled ? null : await askDatabaseAdmin(prompt, ready);

  return { admin, database, host, password, port, ready, username };
}

async function askDatabasePassword(prompt, databaseReady, existingPassword) {
  const password = await prompt.secret("Пароль пользователя PostgreSQL", existingPassword);
  if (password) return password;
  if (databaseReady) return password;

  console.log("  Пароль сгенерирован автоматически и будет сохранён только в .env.");
  return randomBytes(24).toString("base64url");
}

/**
 * Администратор БД для неинтерактивного создания программы (кнопка «добавить»
 * в desktop). Порядок такой же, как у первичной установки: явный флаг →
 * переменные окружения → суперпользователь ОС (`postgres` на Linux). Пустой
 * пароль — это нормально: локальный кластер обычно на trust/peer.
 */
function resolveNonInteractiveDbAdmin() {
  const username = instanceAdminArgument
    ?? process.env.GRUBER_DB_ADMIN_USER
    ?? process.env.PGUSER
    ?? (process.platform === "darwin"
      ? process.env.USER ?? path.basename(homedir())
      : "postgres");
  const password = instanceAdminPasswordArgument
    ?? process.env.GRUBER_DB_ADMIN_PASSWORD
    ?? process.env.PGPASSWORD
    ?? "";
  return { username, password };
}

async function askDatabaseAdmin(prompt, databaseReady) {
  if (databaseReady) return null;

  const defaultAdmin = process.platform === "darwin"
    ? process.env.USER ?? path.basename(homedir())
    : "postgres";
  const username = await prompt.text("Администратор PostgreSQL", defaultAdmin, validatePgName);
  const password = await prompt.secret("Пароль администратора PostgreSQL");

  return { username, password };
}

async function askMediaService(prompt, existingEnv) {
  console.log("\n3. Media-service, FFmpeg, TSDuck и GStreamer");

  // Профиль сервера открывает интерфейс по сети: службу тогда слушает не петля,
  // а сетевой адрес, и статику отдаёт она же.
  const serveInterface = await prompt.confirm(
    "Открыть интерфейс оператора по сети (профиль «сервер без монитора»)?",
    Boolean(existingEnv.GRUBER_WEB_DIR),
  );
  const apiHost = await prompt.text(
    "GRUBER_HOST",
    serveInterface ? "0.0.0.0" : existingEnv.GRUBER_HOST ?? "127.0.0.1",
  );
  const apiPort = await prompt.text(
    "GRUBER_PORT",
    existingEnv.GRUBER_PORT ?? "4310",
    (value) => validatePort(value, "GRUBER_PORT"),
  );

  const detected = detectMediaToolPaths(existingEnv);
  printToolDetection("FFmpeg", detected.ffmpeg);
  printToolDetection("ffprobe", detected.ffprobe);
  printToolDetection("TSDuck tsp", detected.tsduck);
  printToolDetection("GStreamer gst-launch", detected.gstreamer);

  const ffmpegPath = await prompt.text(
    "FFmpeg (Enter — найти автоматически)",
    detected.ffmpeg ?? existingEnv.FFMPEG_PATH ?? "ffmpeg",
  );
  const ffprobePath = await prompt.text(
    "ffprobe (Enter — найти автоматически)",
    detected.ffprobe ?? existingEnv.FFPROBE_PATH ?? "ffprobe",
  );
  const tsduckPath = await prompt.text(
    "TSDuck tsp (UDP/SRT transport и SCTE-35; Enter — найти автоматически)",
    detected.tsduck ?? existingEnv.TSDUCK_PATH ?? "tsp",
  );
  const gstreamerPath = await prompt.text(
    "GStreamer gst-launch (DVB subtitles; Enter — найти автоматически)",
    detected.gstreamer ?? existingEnv.GSTREAMER_LAUNCH_PATH ?? "gst-launch-1.0",
  );

  return {
    apiHost,
    apiPort,
    ffmpegPath,
    ffprobePath,
    gstreamerPath,
    serveInterface,
    tsduckPath,
  };
}

function detectMediaToolPaths(existingEnv) {
  const ffmpeg = discoverToolPath(existingEnv.FFMPEG_PATH ?? "ffmpeg", "ffmpeg");
  const ffprobe = discoverToolPath(
    existingEnv.FFPROBE_PATH ?? siblingExecutable(ffmpeg, "ffprobe"),
    "ffprobe",
  );
  const tsduck = discoverToolPath(existingEnv.TSDUCK_PATH ?? "tsp", "tsp");
  const gstreamer = discoverToolPath(
    existingEnv.GSTREAMER_LAUNCH_PATH ?? "gst-launch-1.0",
    "gst-launch-1.0",
  );

  return { ffmpeg, ffprobe, gstreamer, tsduck };
}

async function askWizardActions(prompt, mode) {
  console.log("\n4. Действия мастера");

  const installDependencies = await askInstallDependencies(prompt);
  // В комплекте едет собранное дерево без исходников и без TypeScript:
  // проверять нечем, да и проверено это на сборочной машине.
  const runChecks = bundleRoot
    ? false
    : await prompt.confirm("Запустить typecheck и tests?", true);
  const buildInstaller = await askBuildInstaller(prompt, mode);
  const createShortcut = await askDesktopShortcut(prompt, mode);
  // Фоновая служба ставится у каждой программы отдельно — при её создании из
  // Control Center; на установке станции спрашивать про неё нечего.
  const startNow = await askStartNow(prompt);

  return {
    buildInstaller,
    createShortcut,
    installDependencies,
    runChecks,
    startNow,
  };
}

async function askInstallDependencies(prompt) {
  if (bundleRoot) {
    console.log("  Комплект: зависимости уже в дереве, сборка не требуется.");
    return false;
  }
  if (offline) {
    console.log("  Offline: npm ci и автоматические загрузки отключены.");
    return false;
  }

  return prompt.confirm(
    "Установить все build dependencies через npm ci --include=dev?",
    true,
  );
}

async function askBuildInstaller(prompt, mode) {
  if (mode !== "production") return false;

  if (offline) {
    console.log("  Offline: будет автоматически собран запускаемый Electron-каталог без NSIS.");
    return false;
  }

  return prompt.confirm("Собрать Electron installer для текущей ОС?", true);
}

async function askDesktopShortcut(prompt, mode) {
  if (mode !== "production") return false;

  return prompt.confirm("Создать ярлык FluxIO на рабочем столе?", true);
}

async function askStartNow(prompt) {
  if (noStart) return false;

  return prompt.confirm("Запустить приложение после установки?", true);
}

//
// Подготовка окружения: инструменты, база, .env
//

async function resolveMediaTools(prompt, service) {
  // Комплект отвечает за медиастек сам: пути известны, искать по системе и тем
  // более что-то доустанавливать нечего.
  if (bundleTools.ffmpeg && bundleTools.ffprobe && bundleTools.tsduck && bundleTools.gstreamer) {
    console.log("  ✓ Медиастек из комплекта:");
    for (const [label, toolPath] of [
      ["FFmpeg", bundleTools.ffmpeg],
      ["ffprobe", bundleTools.ffprobe],
      ["TSDuck", bundleTools.tsduck],
      ["GStreamer", bundleTools.gstreamer],
    ]) {
      console.log(`    ${label}: ${toolPath}`);
    }
    verifyGstreamerDvbPlugin(bundleTools.gstreamer);
    return {
      ffmpeg: bundleTools.ffmpeg,
      ffprobe: bundleTools.ffprobe,
      gstreamer: bundleTools.gstreamer,
      tsduck: bundleTools.tsduck,
    };
  }

  const ffmpeg = await ensureTool(prompt, service.ffmpegPath, "FFmpeg", "ffmpeg", "ffmpeg", offline);
  const ffprobe = await ensureTool(prompt, service.ffprobePath, "ffprobe", "ffmpeg", "ffprobe", offline);
  const tsduck = await ensureTool(prompt, service.tsduckPath, "TSDuck", "tsduck", "tsp", offline);
  const gstreamer = await ensureTool(
    prompt,
    service.gstreamerPath,
    "GStreamer",
    "gstreamer",
    "gst-launch-1.0",
    offline,
  );

  verifyGstreamerDvbPlugin(gstreamer);

  return { ffmpeg, ffprobe, gstreamer, tsduck };
}

function verifyGstreamerDvbPlugin(gstreamerLaunchPath) {
  if (skipGstreamerDvbCheck) {
    console.log("  ! Проверка GStreamer dvbsubenc пропущена (--skip-gstreamer-check).");
    return;
  }

  console.log("  … проверяю GStreamer dvbsubenc (первый запуск строит кэш плагинов, до нескольких минут)");
  // Проверка идёт в том же окружении, в котором GStreamer потом работает в
  // эфире: заодно она строит реестр плагинов там, где служба сможет его
  // прочитать. Иначе минуты построения достались бы первому ролику с
  // субтитрами, а не установке.
  const probe = probeGstreamerDvbPlugin(gstreamerLaunchPath, {
    environment: bundleGstreamerEnvironment(),
  });

  if (probe.available) {
    console.log(`  ✓ GStreamer dvbsubenc: ${probe.inspectPath}`);
    return;
  }

  if (probe.inconclusive) {
    console.warn(
      `  ! Не удалось проверить GStreamer dvbsubenc (${probe.reason}). ` +
        "Установка продолжается. Проверьте вручную: " +
        `"${probe.inspectPath}" --exists dvbsubenc`,
    );
    return;
  }

  throw new Error(
    "GStreamer установлен, но обязательный DVB plugin dvbsubenc не найден. " +
      "На Windows установите официальный MSVC x86_64 Runtime с полным набором " +
      `plug-ins и повторите мастер. Проверка: "${probe.inspectPath}" ` +
      `--exists dvbsubenc (${probe.reason}). ` +
      "Чтобы пропустить проверку: node setup.mjs --skip-gstreamer-check",
  );
}

/**
 * Проверяет, что сервер PostgreSQL отвечает (и разворачивает кластер из
 * комплекта). Базу и роль здесь НЕ создаёт — это делает добавление программы:
 * у станции своих программ нет.
 */
async function ensurePostgresServer(prompt, database) {
  if (bundleRoot && bundleTools.initdb && bundleTools.pgCtl) {
    await prepareBundledPostgres(database);
    // Юнит кластера ставится сразу на установке станции — до него кластер
    // держался бы ручным `pg_ctl` и не пережил бы перезагрузку до первой
    // программы.
    await installBundledPostgresService(prompt);
    return;
  }
  if (database.ready) return;

  const psqlPath = bundleTools.psql ?? await ensureTool(
    prompt,
    "psql",
    "PostgreSQL client",
    "postgresql",
    "psql",
    offline,
  );
  const pgIsReadyPath = bundleTools.pgIsReady ?? discoverToolPath(
    siblingExecutable(psqlPath, "pg_isready"),
    "pg_isready",
  );

  await ensurePostgresReady(prompt, database.host, database.port, pgIsReadyPath);
}

/** Ставит фоновый юнит кластера PostgreSQL из комплекта (systemd/launchd/задача). */
async function installBundledPostgresService(prompt) {
  if (!bundlePostgres) return;
  const kind = platformServiceKind().id;
  if (kind === "systemd") {
    const serviceUser = await prompt.text(
      "Linux-пользователь для кластера PostgreSQL",
      process.env.SUDO_USER ?? process.env.USER ?? "gruber",
      validateSystemUser,
    );
    await installBundledPostgresUnit({ serviceUser, start: !noStart });
  } else if (kind === "launchd") {
    await installBundledPostgresAgent({ start: !noStart });
  } else {
    await installBundledPostgresTask({ start: !noStart });
  }
}

async function ensureInstanceRegistryFile() {
  const filePath = path.join(projectRoot, "instances.json");
  if (existsSync(filePath)) return;
  await writeInstanceRegistry(projectRoot, { version: 1, instances: [] });
  console.log("Реестр программ создан пустым — добавьте первую программу в окне FluxIO.");
}

function buildSharedEnvironmentValues({ database, existingEnv, mode, service, tools }) {
  return {
    NODE_ENV: mode === "production" ? "production" : "development",
    GRUBER_SECRET_KEY:
      existingEnv.GRUBER_SECRET_KEY || randomBytes(32).toString("base64"),
    GRUBER_HOST: service.apiHost,
    // Порт API первой программы; последующие берут следующий свободный.
    GRUBER_PORT: String(service.apiPort),
    // Координаты сервера PostgreSQL и общая роль для всех программ.
    GRUBER_PG_HOST: database.host,
    GRUBER_PG_PORT: String(database.port),
    GRUBER_DB_USER: database.username,
    GRUBER_DB_PASSWORD: database.password,
    GRUBER_DB_NAME: database.database,
    GRUBER_DB_READY: database.ready ? "1" : "",
    FFMPEG_PATH: tools.ffmpeg,
    FFPROBE_PATH: tools.ffprobe,
    TSDUCK_PATH: tools.tsduck,
    GSTREAMER_LAUNCH_PATH: tools.gstreamer,
    GSTREAMER_INSPECT_PATH: siblingExecutable(tools.gstreamer, "gst-inspect-1.0"),
    // Пустые значения для обычной установки: служба тогда работает с системным
    // GStreamer ровно как раньше.
    GSTREAMER_ROOT: bundleGstreamerRoot() ?? "",
    GSTREAMER_REGISTRY: bundleGstreamerRegistry() ?? "",
    // Каталог интерфейса нужен только серверному профилю: на рабочем месте его
    // отдаёт Electron из своих ресурсов.
    GRUBER_WEB_DIR: service.serveInterface
      ? path.join(projectRoot, "apps", "web", "dist")
      : "",
  };
}

//
// Офлайн-комплект
//

/**
 * Готовит установку из комплекта: находит его, проверяет описание и
 * целостность, запоминает пути к инструментам.
 *
 * Всё это делается **до** первого вопроса мастера: испорченный или чужой
 * комплект должен остановить установку раньше, чем оператор ответит на пять
 * экранов и мастер начнёт писать на диск.
 */
async function prepareBundle() {
  const detected = detectBundleRoot(projectRoot, bundlePathArgument);
  if (!bundleFlag && !updateFlag && !detected) return false;
  if (!detected) {
    throw new Error(
      "Каталог комплекта не найден. Укажите его явно: --bundle=<путь к каталогу с manifest.json>",
    );
  }

  bundleRoot = detected;
  bundleManifest = await readBundleManifest(bundleRoot);

  console.log(`\nОфлайн-комплект: ${bundleRoot}`);
  console.log(formatBundleSummary(bundleManifest));

  if (bundleManifest.version !== applicationVersion) {
    // Мастер едет внутри комплекта, поэтому версии обязаны совпадать. Расхождение
    // значит, что setup.mjs запущен из чужого дерева — и соберёт он тоже чужое.
    throw new Error(
      `Комплект собран для ${bundleManifest.version}, а мастер запущен из дерева ` +
        `${applicationVersion}. Запускайте setup.mjs из самого комплекта.`,
    );
  }

  // Целостность проверяется и перед обновлением: битый комплект не должен
  // попасть в работающую установку ни одним файлом.
  console.log("\n  Проверка целостности…");
  await verifyBundleComponents(bundleRoot, bundleManifest, ({ component, ok }) => {
    console.log(`    ${ok ? "✓" : "✗"} ${component.id}`);
  });

  if (updateFlag) {
    // Обновление переносит компоненты и передаёт работу мастеру установленного
    // каталога: `projectRoot` считается от расположения файла, и `.env`, служба
    // и ярлык обязаны указывать на установку, а не на распакованный рядом
    // комплект.
    await updateInstallation(bundleRoot, bundleManifest);
    return true;
  }

  bundleTools = bundleToolPaths(bundleRoot, bundleManifest);

  // Каталог реестра плагинов создаётся заранее: его строит проверка
  // `dvbsubenc` на следующем шаге, и писать ей должно быть куда.
  const registry = bundleGstreamerRegistry();
  if (registry) await mkdir(path.dirname(registry), { recursive: true });
  return false;
}

/**
 * Разворачивает и поднимает кластер из комплекта.
 *
 * Данные ложатся в каталог установки, порт и адрес — из ответов мастера, слушает
 * кластер только петлю: по сети ходит интерфейс, а к базе обращается один
 * media-service на той же машине.
 */
async function prepareBundledPostgres(database) {
  const toolRoot = path.join(bundleRoot, bundleManifest.tools.postgres);
  const executables = postgresExecutables(toolRoot);
  for (const required of ["initdb", "pgCtl"]) {
    if (!executables[required]) {
      throw new Error(`В комплекте нет ${required}: каталог ${toolRoot} собран неполностью`);
    }
  }

  const superuser = "fluxio_admin";
  const superuserPassword = await readOrCreateSuperuserPassword(
    bundleRoot,
    () => randomBytes(24).toString("base64url"),
  );
  const cluster = await provisionCluster({
    executables,
    installRoot: bundleRoot,
    log: (message) => console.log(message),
    port: database.port,
    run: (command, args, options) => runCommand(command, args, options),
    superuser,
    superuserPassword,
  });

  // «Уже работает» — это НАШ кластер по каталогу данных, а не любой сервер,
  // ответивший на порт. Мастер запускают повторно, и второй `pg_ctl start` по
  // своему же работающему кластеру — ошибка; но система с чужим PostgreSQL на
  // том же порту уводила бы подключение туда, где роли `fluxio_admin` нет.
  if (bundledClusterRunning(executables.pgCtl, cluster.dataDirectory)) {
    console.log("  Кластер уже работает.");
  } else {
    if (bundledPortAnswered(executables.pgIsReady, database.port)) {
      throw new Error(
        `Порт ${database.port} занят другим сервером PostgreSQL (не кластером комплекта).\n` +
          "  Остановите его либо переустановите, указав для кластера FluxIO свободный порт.",
      );
    }
    console.log("  Запускаю кластер…");
    await runCommand(
      executables.pgCtl,
      pgCtlStartArguments({ dataDirectory: cluster.dataDirectory, logFile: cluster.startupLog }),
      { env: clusterEnvironment() },
    );
  }

  const { default: pg } = await import("pg");
  const admin = new pg.Client({
    database: "postgres",
    host: "127.0.0.1",
    password: superuserPassword,
    port: database.port,
    user: superuser,
  });
  await admin.connect();
  try {
    const created = await ensureRoleAndDatabase(admin, {
      database: database.database,
      password: database.password,
      username: database.username,
    });
    console.log(
      `  ✓ Роль ${database.username}: ${created.role ? "создана" : "уже была"}; ` +
        `база ${database.database}: ${created.database ? "создана" : "уже была"}`,
    );
  } finally {
    await admin.end();
  }

  bundlePostgres = { cluster, executables, port: database.port };
}

/** Каталог GStreamer из комплекта или `null`, если его там нет. */
function bundleGstreamerRoot() {
  const relative = bundleManifest?.tools?.gstreamer;
  return bundleRoot && relative ? path.join(bundleRoot, relative) : null;
}

/**
 * Куда GStreamer складывает реестр плагинов.
 *
 * По умолчанию это `$HOME`, куда служба под systemd писать не может, — и реестр
 * пересобирался бы при каждом старте, отнимая минуты у первого ролика с
 * субтитрами. В комплекте он живёт рядом с данными кластера.
 */
function bundleGstreamerRegistry() {
  return bundleRoot ? path.join(bundleRoot, "data", "gstreamer", "registry.bin") : null;
}

function bundleGstreamerEnvironment() {
  const root = bundleGstreamerRoot();
  const registry = bundleGstreamerRegistry();
  if (!root && !registry) return process.env;
  return gstreamerEnvironment({
    environment: process.env,
    registryPath: registry ?? undefined,
    root: root ?? undefined,
  });
}

/** Наш кластер комплекта запущен — по каталогу данных, а не по порту. */
function bundledClusterRunning(pgCtl, dataDirectory) {
  const result = spawnSync(pgCtl, ["status", "-D", dataDirectory], {
    env: clusterEnvironment(),
    stdio: "ignore",
    timeout: 10_000,
  });
  // 0 — сервер запущен; 3 — остановлен; 4 — нет/битый каталог данных.
  return result.status === 0;
}

/** На порт кто-то отвечает — не обязательно наш кластер. */
function bundledPortAnswered(pgIsReady, port) {
  if (!pgIsReady) return false;
  const result = spawnSync(pgIsReady, ["-h", "127.0.0.1", "-p", String(port), "-q"], {
    env: clusterEnvironment(),
    stdio: "ignore",
    timeout: 10_000,
  });
  return result.status === 0;
}

/**
 * Переносит новый комплект в уже установленный каталог.
 *
 * Возвращает каталог установки: с этого момента мастер работает с ним, а не с
 * распакованным рядом комплектом.
 */
async function updateInstallation(sourceRoot, incoming) {
  if (!updatePathArgument) {
    throw new Error("Укажите каталог установки: --update=<путь к установленному комплекту>");
  }
  const installationRoot = path.resolve(updatePathArgument);
  console.log(`\nОбновление установки: ${installationRoot}`);

  const installed = await readBundleManifest(installationRoot);
  const refusal = updateRefusal(installed, incoming);
  if (refusal) throw new Error(refusal);

  const plan = planUpdate(installed, incoming);
  console.log(`  ${installed.version} → ${incoming.version}`);
  console.log(`  переносится: ${plan.changed.join(", ") || "нечего"}`);
  console.log(`  остаётся как есть: ${plan.unchanged.join(", ") || "нечего"}`);

  const result = await applyBundleUpdate({
    incoming,
    installationRoot,
    log: (message) => console.log(message),
    plan,
    sourceRoot,
  });
  console.log(
    `  перенесено компонентов: ${result.moved}, оставлено на месте: ${result.kept}`,
  );
  console.log("  Базы, instances.json и .env-файлы не тронуты.");

  const node = path.join(installationRoot, incoming.node.path);
  const wizard = path.join(installationRoot, "app", "setup.mjs");
  console.log("\n  Дальше работает мастер обновлённой установки.\n");
  const handedOver = spawnSync(
    node,
    [wizard, `--bundle=${installationRoot}`, ...process.argv.slice(2).filter(
      (argument) => !argument.startsWith("--update") && !argument.startsWith("--bundle"),
    )],
    { cwd: installationRoot, stdio: "inherit" },
  );
  if (handedOver.error) throw handedOver.error;
  process.exitCode = handedOver.status ?? 0;
}

/**
 * Применяет схему из комплекта.
 *
 * Вместо `prisma migrate deploy`: CLI со schema engine весит 66 МБ и на целевой
 * машине больше ни для чего не нужен. Запись в `_prisma_migrations` идёт в том
 * же формате, поэтому база остаётся понятной обычной Prisma.
 */
async function applyBundleSchema(databaseUrl) {
  const migrations = await readBundleMigrations(bundleMigrationsDirectory(bundleRoot));
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await applyBundleMigrations(client, migrations, (name) => {
      console.log(`  ✓ ${name}`);
    });
    console.log(
      result.applied.length === 0
        ? `  Схема актуальна: ${result.total} миграция(й) уже применены.`
        : `  Применено миграций: ${result.applied.length} из ${result.total}.`,
    );
  } finally {
    await client.end();
  }
}

//
// Сборка, фоновый сервис и запуск
//

async function runBuildPipeline(commandEnv, mode, actions) {
  if (bundleRoot) {
    // Дерево собрано на сборочной машине, Prisma CLI в комплект не едет:
    // остаётся применить схему уже созданным программам (у станции своих баз
    // нет — первую заводит добавление программы).
    if (commandEnv.DATABASE_URL) await applyBundleSchema(commandEnv.DATABASE_URL);
    await migrateAdditionalInstances((environment) => applyBundleSchema(environment.DATABASE_URL));
    return;
  }

  const retired = await pruneRetiredSourceFiles();
  if (retired.length > 0) {
    console.log(`  Удалены устаревшие исходники предыдущей версии: ${retired.length}`);
  }
  if (actions.installDependencies) {
    await ensureNodeModulesAreFree();
    await runNpmCommand(npmCiArguments(), { env: commandEnv });
  }

  await ensureElectronRuntime({ env: commandEnv, offlineMode: offline });
  // Генерация клиента Prisma базы не требует; миграции применяем только уже
  // созданным программам — у станции своей базы нет.
  await runNpmCommand(["run", "db:generate"], { env: commandEnv });
  if (commandEnv.DATABASE_URL) await runNpmCommand(["run", "db:migrate"], { env: commandEnv });
  await migrateAdditionalInstances((environment) => runNpmCommand(
    ["run", "db:migrate"],
    { env: { ...process.env, ...environment } },
  ));

  if (actions.runChecks) {
    await runNpmCommand(["run", "typecheck"], { env: commandEnv });
    await runNpmCommand(["test"], { env: commandEnv });
  }

  if (mode !== "production") return;

  const packagingScript = desktopPackagingScript({
    buildInstaller: actions.buildInstaller,
    mode,
    offlineMode: offline,
  });
  await runNpmCommand(
    packagingScript ? ["run", packagingScript] : ["run", "build"],
    { env: commandEnv },
  );
}

async function migrateAdditionalInstances(migrate) {
  const registry = await readInstanceRegistry(projectRoot, "http://127.0.0.1:4310");
  for (const instance of registry.instances) {
    const environment = parseEnv(await readFile(path.join(projectRoot, instance.environmentFile), "utf8"));
    if (!environment.DATABASE_URL) {
      throw new Error(`В ${instance.environmentFile} нет DATABASE_URL`);
    }
    console.log(`\nМиграции базы: ${instance.name}`);
    await migrate(environment);
  }
}

async function restartAdditionalInstances(fallbackApiUrl) {
  const registry = await readInstanceRegistry(projectRoot, fallbackApiUrl);
  for (const instance of registry.instances) {
    if (!instance.enabled) continue;
    const service = instanceService(instance);
    console.log(`\nПерезапуск программы: ${instance.name}`);
    if (service.kind === "systemd") {
      await runCommand("sudo", ["systemctl", "restart", service.label]);
    } else if (service.kind === "launchd") {
      await runCommand("launchctl", ["kickstart", "-k", `${service.domain}/${service.label}`]);
    } else {
      await runCommand("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Stop-ScheduledTask -TaskName '${escapePowerShell(service.label)}' -ErrorAction SilentlyContinue; Start-ScheduledTask -TaskName '${escapePowerShell(service.label)}'`,
      ]);
    }
    await waitForUrl(`${instance.apiUrl}/api/health`, 30_000);
  }
}

/** Убирает файлы, которые архив обновления не мог удалить из старой папки. */
export async function pruneRetiredSourceFiles(root = projectRoot) {
  const removed = [];
  for (const relativePath of retiredSourceFiles) {
    const filePath = path.join(root, relativePath);
    if (!existsSync(filePath)) continue;
    await rm(filePath);
    removed.push(relativePath);
  }
  return removed;
}

async function finishInstallation(commandEnv, mode, actions, values) {
  const desktopShortcut = actions.createShortcut ? await createDesktopShortcut() : null;
  // Папка титров нужна независимо от ярлыка: в неё складываются готовые
  // плашки, и без неё каталог в редакторе открывается пустым.
  const titleLibrary = await createTitleLibraryFolder().catch(() => null);

  printSummary({
    desktopShortcut,
    titleLibrary,
    mode,
    startNow: actions.startNow,
    values,
  });

  if (!actions.startNow) return;

  // Фоновая служба ставится у каждой программы отдельно (её ставит добавление
  // программы). Здесь только открываем Control Center: программ ещё нет.
  await launchApplication(mode, commandEnv, `http://127.0.0.1:${values.GRUBER_PORT}`);
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
  console.log(`\nFluxIO v${applicationVersion} — мастер установки`);
  console.log("=================================");
  console.log("Docker не используется. Пароли не выводятся в итоговый отчёт.");
  console.log();
}

function assertNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) {
    throw new Error(`Требуется Node.js 24+, установлена версия ${process.versions.node}`);
  }
}

export function electronRuntimePath(
  rootPath = projectRoot,
  platform = process.platform,
) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const relativeParts = platform === "darwin"
    ? ["node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"]
    : [
        "node_modules",
        "electron",
        "dist",
        platform === "win32" ? "electron.exe" : "electron",
      ];
  return pathApi.join(rootPath, ...relativeParts);
}

function assertOfflineBuildDependencies({ requireElectron }) {
  const required = [
    ["TypeScript", path.join(projectRoot, "node_modules", "typescript", "package.json")],
    ["Vite", path.join(projectRoot, "node_modules", "vite", "package.json")],
    ["Prisma CLI", path.join(projectRoot, "node_modules", "prisma", "package.json")],
    ["Prisma Client", path.join(projectRoot, "node_modules", "@prisma", "client", "package.json")],
  ];
  if (requireElectron) {
    required.push(
      ["Electron", path.join(projectRoot, "node_modules", "electron", "package.json")],
      [
        "electron-builder",
        path.join(projectRoot, "node_modules", "electron-builder", "package.json"),
      ],
      ["Electron runtime", electronRuntimePath()],
    );
  }
  const missing = required.filter(([, filePath]) => !existsSync(filePath));
  if (missing.length > 0) {
    throw new Error(
      "Offline build bundle неполный. Не найдены: " +
        missing.map(([label, filePath]) => `${label} (${filePath})`).join(", ") +
        ". Подготовьте dependencies на машине с интернетом той же ОС и архитектуры.",
    );
  }
  console.log("  ✓ Offline build dependencies и Electron runtime найдены локально.");
}

async function ensureElectronRuntime({ env, offlineMode }) {
  const executablePath = electronRuntimePath();
  if (existsSync(executablePath)) {
    console.log(`  ✓ Electron runtime: ${executablePath}`);
    return;
  }
  const installScript = path.join(
    projectRoot,
    "node_modules",
    "electron",
    "install.js",
  );
  if (!existsSync(installScript)) {
    throw new Error(
      "Electron package не найден. Выполните npm ci --include=dev на машине с интернетом.",
    );
  }
  if (offlineMode) {
    throw new Error(
      `Electron runtime не найден: ${executablePath}. ` +
        "Offline mode не выполняет download; подготовьте node_modules/electron/dist заранее.",
    );
  }
  console.log("\nElectron runtime отсутствует; загружаю platform binary…");
  await runCommand(process.execPath, [installScript], { env });
  if (!existsSync(executablePath)) {
    throw new Error(
      `Electron installer завершился без ошибки, но runtime не найден: ${executablePath}`,
    );
  }
  console.log(`  ✓ Electron runtime: ${executablePath}`);
}

async function loadExistingEnv() {
  // Станционный конфиг — источник общих значений. Цельный `.env` от установок до
  // раздельных программ читается запасным, чтобы обновление не потеряло пути к
  // инструментам и секрет.
  const legacy = existsSync(envPath) ? parseEnv(await readFile(envPath, "utf8")) : {};
  const shared = existsSync(sharedEnvPath) ? parseEnv(await readFile(sharedEnvPath, "utf8")) : {};
  return { ...legacy, ...shared };
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

/**
 * Держит на диске только последнюю и предыдущую копии `.env`. Мастер запускают
 * десятки раз, и без ротации корень зарастает бэкапами, каждый из которых
 * содержит секреты.
 */
export function selectEnvBackupsToRemove(fileNames, keep = envBackupsToKeep) {
  const prefix = `${path.basename(envPath)}.backup-`;
  return fileNames
    .filter((name) => name.startsWith(prefix))
    // В имени лежит ISO-метка фиксированной ширины, поэтому лексикографический
    // порядок совпадает с хронологическим и разбирать дату не нужно.
    .sort()
    .reverse()
    .slice(keep);
}

async function saveSharedEnv(values) {
  if (existsSync(sharedEnvPath)) {
    await copyFile(sharedEnvPath, `${sharedEnvPath}.backup`);
    console.log(`\nСуществующий ${sharedEnvFileName} сохранён: ${sharedEnvFileName}.backup`);
  }
  await writeFile(sharedEnvPath, serializeEnv(values), { encoding: "utf8", mode: 0o600 });
  console.log(`Станционный конфиг записан: ${sharedEnvFileName} (mode 0600).`);
}

async function ensureTool(
  prompt,
  command,
  label,
  packageName,
  executableName,
  offlineMode = false,
) {
  const detected = discoverToolPath(command, executableName);
  if (detected) {
    console.log(`  ✓ ${label}: ${detected}`);
    return detected;
  }
  console.warn(`\n${label} не найден: ${command}`);
  if (offlineMode) {
    throw new Error(
      `${label} не найден. Offline mode запрещает автоматическую установку; ` +
        "установите инструмент заранее или укажите полный путь.",
    );
  }
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
  const result = spawnSync(command, commandVersionArguments(command), {
    stdio: "ignore",
    timeout: 8_000,
  });
  return !result.error && result.status === 0;
}

function discoverToolPath(
  requestedCommand,
  executableName,
  platform = process.platform,
  environment = process.env,
) {
  const requested = unquoteCommand(requestedCommand || executableName);
  if (["gst-launch-1.0", "gst-inspect-1.0"].includes(normalizeExecutableName(executableName))) {
    const resolved = resolveCommandPath(requested, platform);
    const pathApi = platform === "win32" ? path.win32 : path;
    if (resolved !== requested || (pathApi.isAbsolute(resolved) && existsSync(resolved))) {
      return resolved;
    }
  }
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


function siblingExecutable(command, executableName, platform = process.platform) {
  if (!command) return executableName;
  const pathApi = platform === "win32" ? path.win32 : path;
  if (!pathApi.isAbsolute(command)) return executableName;
  const filename = platform === "win32"
    ? windowsExecutableName(executableName)
    : executableName;
  return pathApi.join(pathApi.dirname(command), filename);
}

export function probeGstreamerDvbPlugin(
  launchPath,
  {
    environment = process.env,
    platform = process.platform,
    spawnSyncImpl = spawnSync,
    timeoutMs = 300_000,
    attempts = 2,
  } = {},
) {
  const inspectPath = siblingExecutable(launchPath, "gst-inspect-1.0", platform);
  let result;
  // Первый запуск gst-inspect строит реестр плагинов (несколько минут на свежей
  // установке), поэтому таймаут щедрый, а таймаут/ошибку запуска пробуем повторить.
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    result = spawnSyncImpl(inspectPath, ["--exists", "dvbsubenc"], {
      encoding: "utf8",
      env: environment,
      timeout: timeoutMs,
      windowsHide: true,
    });
    if (!result.error) break;
    if (attempt < attempts) {
      console.log(
        `  … проверка GStreamer dvbsubenc не завершилась (${result.error.message}), повтор ${attempt + 1}/${attempts}`,
      );
    }
  }
  const reason = result.error?.message ||
    [result.stderr, result.stdout].find((value) => String(value ?? "").trim())?.trim() ||
    `exit code ${result.status ?? "unknown"}`;
  return {
    available: !result.error && result.status === 0,
    // gst-inspect не смог отработать — это не доказательство отсутствия плагина.
    inconclusive: Boolean(result.error),
    inspectPath,
    reason,
  };
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
  if (["gst-launch-1.0", "gst-inspect-1.0"].includes(normalizeExecutableName(command))) {
    const environmentRoots = [
      environment.GSTREAMER_1_0_ROOT_MSVC_X86_64,
      environment.GSTREAMER_1_0_ROOT_MSVC_X86,
      environment.GSTREAMER_1_0_ROOT_MINGW_X86_64,
      environment.GSTREAMER_ROOT_X86_64,
      environment.GSTREAMER_ROOT_X86,
    ].filter(Boolean);
    roots.push(
      ...environmentRoots.map((root) => win.join(root, "bin")),
      localAppData && win.join(localAppData, "Programs", "gstreamer", "1.0", "msvc_x86_64", "bin"),
      localAppData && win.join(localAppData, "Programs", "gstreamer", "1.0", "mingw_x86_64", "bin"),
      win.join(systemDrive, "gstreamer", "1.0", "msvc_x86_64", "bin"),
      win.join(systemDrive, "gstreamer", "1.0", "mingw_x86_64", "bin"),
      win.join(programFiles, "gstreamer", "1.0", "msvc_x86_64", "bin"),
      win.join(programFiles, "gstreamer", "1.0", "mingw_x86_64", "bin"),
      programFilesX86 && win.join(programFilesX86, "gstreamer", "1.0", "msvc_x86", "bin"),
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
  if (["gst-launch-1.0", "gst-inspect-1.0"].includes(normalized)) {
    roots.push(
      localAppData && win.join(localAppData, "Programs", "gstreamer"),
      win.join(systemDrive, "gstreamer"),
      win.join(programFiles, "gstreamer"),
      programFilesX86 && win.join(programFilesX86, "gstreamer"),
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

    const entries = readDirectoryNewestFirst(current.directory);
    const match = entries.find(
      (entry) => entry.isFile() && entry.name.toLowerCase() === executable.toLowerCase(),
    );
    if (match) return win.join(current.directory, match.name);

    if (current.depth >= maxDepth) continue;

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      queue.push({
        directory: win.join(current.directory, entry.name),
        depth: current.depth + 1,
      });
    }
  }

  return null;
}

function readDirectoryNewestFirst(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      right.name.localeCompare(left.name, undefined, { numeric: true }),
    );
  } catch {
    return [];
  }
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
    return installWithHomebrew(packageName);
  }

  if (process.platform === "linux" && commandAvailable("apt-get")) {
    return installWithApt(packageName);
  }

  if (process.platform === "win32" && commandAvailable("winget")) {
    return installWithWinget(packageName);
  }

  throw new Error(`Автоустановка ${packageName} не поддерживается на этой ОС`);
}

async function installWithHomebrew(packageName) {
  if (!commandAvailable("brew")) {
    throw new Error("Homebrew не найден. Установите Homebrew или пакет вручную.");
  }

  const formula = packageName === "postgresql" ? "postgresql@17" : packageName;
  await runCommand("brew", ["install", formula]);

  if (packageName !== "postgresql") return;

  await runCommand("brew", ["services", "start", formula]);
}

async function installWithApt(packageName) {
  await runCommand("sudo", ["apt-get", "update"]);
  await runCommand("sudo", ["apt-get", "install", "-y", ...aptPackages(packageName)]);

  if (packageName !== "postgresql") return;

  await runCommand("sudo", ["systemctl", "enable", "--now", "postgresql"]);
}

function aptPackages(packageName) {
  if (packageName === "postgresql") {
    return ["postgresql", "postgresql-client"];
  }
  if (packageName === "gstreamer") {
    return ["gstreamer1.0-tools", "gstreamer1.0-plugins-base", "gstreamer1.0-plugins-bad"];
  }
  return [packageName];
}

async function installWithWinget(packageName) {
  const agreements = ["--accept-package-agreements", "--accept-source-agreements"];

  if (packageName === "tsduck") {
    return runCommand("winget", ["install", "tsduck", ...agreements]);
  }

  return runCommand("winget", [
    "install",
    "--id",
    wingetPackageId(packageName),
    "--exact",
    ...agreements,
  ]);
}

function wingetPackageId(packageName) {
  if (packageName === "gstreamer") return "gstreamerproject.gstreamer";
  if (packageName === "postgresql") return "PostgreSQL.PostgreSQL.17";
  return "Gyan.FFmpeg";
}

async function createPostgresDatabase({
  admin,
  database,
  host,
  manageRole = true,
  password,
  port,
  psqlPath,
  username,
}) {
  console.log(
    manageRole
      ? "\nСоздаю/обновляю роль и базу PostgreSQL…"
      : "\nСоздаю базу PostgreSQL…",
  );
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
  // Дополнительной программе роль не создаётся и не меняется — она делит роль с
  // основной установкой, а `ALTER ROLE` под самой ролью приложения запрещён.
  const roleStatements = manageRole
    ? [
        `SELECT ${createRoleFormat} WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \\gexec`,
        `SELECT ${alterRoleFormat} \\gexec`,
      ]
    : [];
  const sql = [
    ...roleStatements,
    "SELECT format('CREATE DATABASE %I OWNER %I', :'app_database', :'app_user') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_database') \\gexec",
    "SELECT format('ALTER DATABASE %I OWNER TO %I', :'app_database', :'app_user') \\gexec",
  ].join("\n");
  await runCommand(command, [...baseArgs, ...variableArgs], {
    env: { ...process.env, ...(admin.password ? { PGPASSWORD: admin.password } : {}) },
    input: sql,
  });
}

async function installPlatformService({
  envPath: environmentPath,
  instanceId = null,
  kind,
  managePostgres = true,
  serviceUser,
  start,
}) {
  if (kind === "systemd") {
    return installSystemdService({ environmentPath, instanceId, managePostgres, serviceUser, start });
  }
  if (kind === "launchd") {
    return installLaunchAgent({ environmentPath, instanceId, managePostgres, start });
  }
  if (kind === "windows-task") {
    return installWindowsTask({ environmentPath, instanceId, managePostgres, start });
  }
  throw new Error(`Фоновый service не поддерживается на platform=${process.platform}`);
}

async function installSystemdService({ environmentPath, instanceId, managePostgres, serviceUser, start }) {
  if (!commandAvailable("systemctl")) {
    throw new Error("systemctl не найден: автоматическая production-установка доступна только с systemd");
  }
  const passwdCheck = spawnSync("getent", ["passwd", serviceUser], { stdio: "ignore" });
  if (passwdCheck.status !== 0) {
    throw new Error(`Linux-пользователь ${serviceUser} не существует`);
  }
  // Кластер из комплекта поднимается своим unit-ом и до media-service:
  // после перезагрузки эфир обязан вернуться сам, а без базы автоподъём не
  // восстановит ни расписание, ни точку прерывания.
  if (bundlePostgres && managePostgres) {
    await installBundledPostgresUnit({ serviceUser, start });
  }

  const suffix = instanceId ? `-${instanceId}` : "";
  const serviceName = `gruber-media${suffix}.service`;
  const runtimeName = `gruber-playout${suffix}`;
  const unitPath = path.join(tmpdir(), `${serviceName}.${process.pid}`);
  const unit = buildSystemdUnit({
    environmentPath,
    nodePath: process.execPath,
    requiresUnit: bundlePostgres ? postgresServiceName : null,
    rootPath: projectRoot,
    runtimeName,
    serviceUser,
    // `ProtectSystem=strict` делает каталог установки read-only, а реестр
    // плагинов GStreamer службе писать надо — иначе он пересобирается на
    // каждом старте и отнимает минуты у первого ролика с субтитрами.
    writablePaths: bundleRoot ? [path.join(bundleRoot, "data")] : [],
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
      `/etc/systemd/system/${serviceName}`,
    ]);
    await runCommand("sudo", ["systemctl", "daemon-reload"]);
    await runCommand("sudo", ["systemctl", "enable", serviceName]);
    if (start) {
      await runCommand("sudo", ["systemctl", "restart", serviceName]);
      await runCommand("sudo", ["systemctl", "--no-pager", "--full", "status", serviceName]);
    }
  } finally {
    await rm(unitPath, { force: true });
  }
  return {
    kind: "systemd",
    label: serviceName,
    logs: `journalctl -u ${serviceName} -f`,
  };
}

/**
 * `requiresUnit` — кластер из комплекта. Он поднимается своим unit-ом, и без
 * жёсткой связи media-service стартует раньше базы и падает на первом запросе:
 * `After=` тут мало, нужен именно `Requires=`.
 */
async function installBundledPostgresUnit({ serviceUser, start }) {
  const unit = buildPostgresSystemdUnit({
    dataDirectory: bundlePostgres.cluster.dataDirectory,
    pgCtl: bundlePostgres.executables.pgCtl,
    serviceUser,
    startupLog: bundlePostgres.cluster.startupLog,
  });
  const unitPath = path.join(tmpdir(), `fluxio-postgres-${process.pid}.service`);
  await writeFile(unitPath, unit, { encoding: "utf8", mode: 0o644 });
  try {
    await runCommand("sudo", [
      "install",
      "-m",
      "0644",
      unitPath,
      `/etc/systemd/system/${postgresServiceName}`,
    ]);
    await runCommand("sudo", ["systemctl", "daemon-reload"]);
    await runCommand("sudo", ["systemctl", "enable", postgresServiceName]);
    if (start) await runCommand("sudo", ["systemctl", "restart", postgresServiceName]);
  } finally {
    await rm(unitPath, { force: true });
  }
}

export function buildSystemdUnit({
  environmentPath,
  nodePath,
  requiresUnit = null,
  rootPath,
  runtimeName = "gruber-playout",
  serviceUser,
  writablePaths = [],
}) {
  return `[Unit]
Description=FluxIO Media Service
After=network-online.target ${requiresUnit ?? "postgresql.service"}
Wants=network-online.target
${requiresUnit ? `Requires=${requiresUnit}\n` : ""}
[Service]
Type=simple
User=${serviceUser}
WorkingDirectory=${quoteSystemd(rootPath)}
Environment=NODE_ENV=production
Environment=GRUBER_PREVIEW_DIR=/run/${runtimeName}/preview
EnvironmentFile=${quoteSystemd(environmentPath)}
RuntimeDirectory=${runtimeName}
RuntimeDirectoryMode=0750
ExecStart=${quoteSystemd(nodePath)} ${quoteSystemd(path.posix.join(rootPath, "apps/media-server/dist/index.js"))} ${quoteSystemd(`--fluxio-env=${environmentPath}`)}
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
KillSignal=SIGTERM
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${[`/run/${runtimeName}`, ...writablePaths].map(quoteSystemd).join(" ")}

[Install]
WantedBy=multi-user.target
`;
}

function quoteSystemd(value) {
  return `"${value.replace(/([\\"])/g, "\\$1")}"`;
}

async function installLaunchAgent({ environmentPath, instanceId, managePostgres, start }) {
  if (bundlePostgres && managePostgres) await installBundledPostgresAgent({ start });
  const suffix = instanceId ? `.${instanceId}` : "";
  const label = `live.gruber.media${suffix}`;
  const agentsDirectory = path.join(homedir(), "Library", "LaunchAgents");
  const logsDirectory = path.join(homedir(), "Library", "Logs", "GruberPlayout");
  const plistPath = path.join(agentsDirectory, `${label}.plist`);
  await mkdir(agentsDirectory, { recursive: true });
  await mkdir(logsDirectory, { recursive: true });
  const plist = buildLaunchAgentPlist({
    environmentPath,
    label,
    nodePath: process.execPath,
    rootPath: projectRoot,
    stderrPath: path.join(logsDirectory, `media-service${suffix}-error.log`),
    stdoutPath: path.join(logsDirectory, `media-service${suffix}.log`),
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
    domain,
    kind: "launchd",
    label,
    logs: `tail -f "${path.join(logsDirectory, `media-service${suffix}.log`)}"`,
    plistPath,
  };
}

/**
 * Автозапуск кластера на macOS.
 *
 * Агент запускает сам `postgres` под присмотром launchd. Порядок с агентом
 * службы launchd не гарантирует, но `KeepAlive` службы вытягивает: к следующей
 * попытке база уже поднята.
 */
async function installBundledPostgresAgent({ start }) {
  const agentsDirectory = path.join(homedir(), "Library", "LaunchAgents");
  const logsDirectory = path.join(homedir(), "Library", "Logs", "GruberPlayout");
  await mkdir(agentsDirectory, { recursive: true });
  await mkdir(logsDirectory, { recursive: true });
  const plistPath = path.join(agentsDirectory, `${postgresLaunchAgentLabel}.plist`);
  await writeFile(
    plistPath,
    buildPostgresLaunchAgentPlist({
      dataDirectory: bundlePostgres.cluster.dataDirectory,
      label: postgresLaunchAgentLabel,
      postgres: bundlePostgres.executables.postgres,
      stderrPath: path.join(logsDirectory, "postgres-error.log"),
      stdoutPath: path.join(logsDirectory, "postgres.log"),
    }),
    { encoding: "utf8", mode: 0o644 },
  );
  const domain = `gui/${process.getuid()}`;
  spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
  if (start) {
    await runCommand("launchctl", ["bootstrap", domain, plistPath]);
    await runCommand("launchctl", ["enable", `${domain}/${postgresLaunchAgentLabel}`]);
  }
}

/** Автозапуск кластера на Windows: задача при старте системы. */
async function installBundledPostgresTask({ start }) {
  await runCommand("powershell.exe", [
    "-NoProfile",
    "-Command",
    buildPostgresWindowsTaskCommand({
      dataDirectory: bundlePostgres.cluster.dataDirectory,
      pgCtl: bundlePostgres.executables.pgCtl,
      start,
      startupLog: bundlePostgres.cluster.startupLog,
      taskName: postgresWindowsTaskName,
    }),
  ]);
}

export function buildLaunchAgentPlist({
  environmentPath = null,
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
    ${environmentPath ? `<string>${escapeXml(`--fluxio-env=${environmentPath}`)}</string>` : ""}
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

async function installWindowsTask({ environmentPath, instanceId, managePostgres, start }) {
  if (bundlePostgres && managePostgres) await installBundledPostgresTask({ start });
  const taskName = `Gruber Playout Media Service${instanceId ? ` ${instanceId}` : ""}`;
  const scriptPath = path.join(projectRoot, "apps/media-server/dist/index.js");
  const command = buildWindowsTaskCommand({
    environmentPath,
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
    kind: "windows-task",
    label: taskName,
    logs: `Get-ScheduledTask -TaskName '${taskName}'`,
  };
}

export function buildWindowsTaskCommand({ environmentPath = null, nodePath, rootPath, scriptPath, start, taskName }) {
  const actionArguments = `\"${scriptPath}\"${environmentPath ? ` \"--fluxio-env=${environmentPath}\"` : ""}`;
  return [
    `Stop-ScheduledTask -TaskName '${escapePowerShell(taskName)}' -ErrorAction SilentlyContinue`,
    "Start-Sleep -Milliseconds 500",
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

/** Имя папки титров. Одно на все платформы: её ищут глазами. */
export const titleLibraryFolderName = "FluxIO Titles";

/**
 * Папка титров на рабочем столе.
 *
 * Создаётся при установке, чтобы оператору было куда складывать готовые
 * плашки и откуда их брать. Существующую не трогаем: в ней уже могут лежать
 * его файлы, и «создать заново» означало бы их потерю.
 */
export async function createTitleLibraryFolder() {
  const folderPath = path.join(homedir(), "Desktop", titleLibraryFolderName);
  const created = !existsSync(folderPath);
  await mkdir(folderPath, { recursive: true });
  // Базовый набор кладём и в существующую папку: без него первый канал
  // начинает с пустого холста. Уже лежащий файл не трогаем — оператор мог
  // его поправить под себя, и перезапись стёрла бы правку.
  const copied = await copyBuiltInTitles(folderPath);
  const readmePath = path.join(folderPath, "README.txt");
  if (!existsSync(readmePath)) {
    await writeFile(
      readmePath,
      [
        "FluxIO Titles",
        "",
        "Сюда складываются готовые титры — файлы .fto.",
        "Сохранить: редактор титров, кнопка «Сохранить как».",
        "Загрузить: редактор титров, кнопка каталога.",
        "",
        "Файл .fto — это JSON с меткой формата внутри. Своё расширение",
        "нужно, чтобы титр не путался с файлом задания или профилем настроек.",
      ].join("\n"),
      "utf8",
    );
  }
  return { folderPath, created, copied };
}

/**
 * Копирует поставляемые титры в папку оператора.
 *
 * Существующие файлы не перезаписываются: оператор мог поправить шаблон под
 * свой канал, и обновление стёрло бы правку молча.
 */
async function copyBuiltInTitles(folderPath) {
  const sourceDirectory = path.join(projectRoot, "assets", "titles");
  if (!existsSync(sourceDirectory)) return 0;
  let copied = 0;
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".fto")) continue;
    const target = path.join(folderPath, entry.name);
    if (existsSync(target)) continue;
    await copyFile(path.join(sourceDirectory, entry.name), target);
    copied += 1;
  }
  return copied;
}

async function createDesktopShortcut() {
  const launcherPath = path.join(projectRoot, "launch.mjs");
  if (!existsSync(launcherPath)) {
    throw new Error(`Launcher не найден: ${launcherPath}`);
  }

  if (process.platform === "win32") {
    const command = buildWindowsShortcutCommand({
      iconPath: path.join(projectRoot, "apps", "desktop", "build", "icon.ico"),
      launcherPath,
      nodePath: process.execPath,
      rootPath: projectRoot,
    });
    await runCommand("powershell.exe", ["-NoProfile", "-Command", command]);
    return "FluxIO.lnk (Windows Desktop)";
  }

  if (process.platform === "darwin") {
    const applicationPath = path.join(homedir(), "Desktop", "FluxIO.app");
    const contentsPath = path.join(applicationPath, "Contents");
    const plistPath = path.join(contentsPath, "Info.plist");
    if (existsSync(applicationPath)) {
      const existingPlist = await readFile(plistPath, "utf8").catch(() => "");
      if (!existingPlist.includes("live.fluxio.desktop-launcher")) {
        throw new Error(
          `Не перезаписываю существующий ${applicationPath}: это не ярлык FluxIO`,
        );
      }
    }
    const executablePath = path.join(contentsPath, "MacOS", "FluxIOLauncher");
    await mkdir(path.dirname(executablePath), { recursive: true });
    await mkdir(path.join(contentsPath, "Resources"), { recursive: true });
    await writeFile(
      executablePath,
      buildMacDesktopLauncher({ launcherPath, nodePath: process.execPath }),
      { encoding: "utf8", mode: 0o755 },
    );
    await chmod(executablePath, 0o755);
    await writeFile(
      plistPath,
      buildMacDesktopLauncherPlist(applicationVersion),
      "utf8",
    );
    await copyFile(
      path.join(projectRoot, "apps", "desktop", "build", "icon.icns"),
      path.join(contentsPath, "Resources", "FluxIO.icns"),
    );
    return applicationPath;
  }

  if (process.platform === "linux") {
    const desktopDirectory = linuxDesktopDirectory();
    const shortcutPath = path.join(desktopDirectory, "FluxIO.desktop");
    await mkdir(desktopDirectory, { recursive: true });
    await writeFile(
      shortcutPath,
      buildLinuxDesktopEntry({
        iconPath: path.join(projectRoot, "apps", "desktop", "build", "icon.png"),
        launcherPath,
        nodePath: process.execPath,
        rootPath: projectRoot,
      }),
      { encoding: "utf8", mode: 0o755 },
    );
    await chmod(shortcutPath, 0o755);
    spawnSync("gio", ["set", shortcutPath, "metadata::trusted", "true"], {
      stdio: "ignore",
    });
    return shortcutPath;
  }

  throw new Error(`Ярлык рабочего стола не поддерживается на ${process.platform}`);
}

export function buildWindowsShortcutCommand({
  iconPath,
  launcherPath,
  nodePath,
  rootPath,
}) {
  const argumentsValue = `\"${launcherPath}\"`;
  return [
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    "$shell = New-Object -ComObject WScript.Shell",
    "$shortcut = $shell.CreateShortcut((Join-Path $desktop 'FluxIO.lnk'))",
    `$shortcut.TargetPath = '${escapePowerShell(nodePath)}'`,
    `$shortcut.Arguments = '${escapePowerShell(argumentsValue)}'`,
    `$shortcut.WorkingDirectory = '${escapePowerShell(rootPath)}'`,
    `$shortcut.IconLocation = '${escapePowerShell(`${iconPath},0`)}'`,
    "$shortcut.Description = 'FluxIO playout console'",
    "$shortcut.WindowStyle = 7",
    "$shortcut.Save()",
  ].join("; ");
}

export function buildMacDesktopLauncher({ launcherPath, nodePath }) {
  return `#!/bin/sh\nexec ${quoteShellArgument(nodePath)} ${quoteShellArgument(launcherPath)}\n`;
}

export function buildMacDesktopLauncherPlist(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key><string>FluxIO</string>
  <key>CFBundleExecutable</key><string>FluxIOLauncher</string>
  <key>CFBundleIconFile</key><string>FluxIO</string>
  <key>CFBundleIdentifier</key><string>live.fluxio.desktop-launcher</string>
  <key>CFBundleName</key><string>FluxIO</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${escapeXml(version)}</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`;
}

export function buildLinuxDesktopEntry({
  iconPath,
  launcherPath,
  nodePath,
  rootPath,
}) {
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=FluxIO
Comment=FluxIO professional video playout console
Exec=${quoteDesktopArgument(nodePath)} ${quoteDesktopArgument(launcherPath)}
Path=${rootPath}
Icon=${iconPath}
Terminal=false
Categories=AudioVideo;Video;
StartupNotify=true
StartupWMClass=FluxIO
`;
}

function linuxDesktopDirectory() {
  const result = spawnSync("xdg-user-dir", ["DESKTOP"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const detected = result.status === 0 ? result.stdout.trim() : "";
  return path.isAbsolute(detected) ? detected : path.join(homedir(), "Desktop");
}

function quoteShellArgument(value) {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function quoteDesktopArgument(value) {
  return `"${value.replace(/([\\\"$`])/g, "\\$1")}"`;
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
  env = await withDesktopInstances(env);
  const processes = [];
  if (mode === "production") {
    processes.push(spawnManaged(process.execPath, [path.join(projectRoot, "launch.mjs")], env));
  } else {
    processes.push(spawnManagedNpm(["run", "dev:server"], env));
    await waitForUrl(`${mediaApiUrl}/api/health`, 30_000);
    processes.push(spawnManagedNpm(["run", "dev:web"], env));
    await waitForUrl("http://127.0.0.1:5173", 30_000);
    processes.push(spawnManagedNpm(["run", "dev:desktop"], env));
  }

  await new Promise((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    processes[0].once("exit", stop);
  });
  await stopProcesses(processes);
}

async function withDesktopInstances(env) {
  const mediaApiUrl = env.GRUBER_MEDIA_API_URL ?? "http://127.0.0.1:4310";
  const registry = await readInstanceRegistry(projectRoot, mediaApiUrl);
  return {
    ...env,
    GRUBER_INSTANCES_JSON: JSON.stringify(publicInstances(registry)),
    GRUBER_INSTANCES_FILE: path.join(projectRoot, "instances.json"),
  };
}

/**
 * Проверяет, что `node_modules` свободен, до того как его снесут.
 *
 * Windows не даёт удалить `.node`, загруженный работающим процессом, и `npm ci`
 * обрывается на `EPERM: unlink` — уже снеся половину дерева. По дампу npm при
 * этом непонятно, что виноват не установщик, а незакрытый FluxIO.
 *
 * Останавливать процессы сам мастер не имеет права: на этой машине может идти
 * эфир, и установка зависимостей — не повод его обрывать. Решение остаётся за
 * оператором, поэтому мастер называет занятые файлы и команду остановки.
 */
async function ensureNodeModulesAreFree() {
  const locked = await findLockedNativeFiles(projectRoot);
  if (locked.length === 0) return;
  throw new Error(describeLockedNativeFiles(locked));
}

export function platformServiceStopCommand(service) {
  if (service.kind === "systemd") {
    return { command: "sudo", args: ["systemctl", "stop", service.label] };
  }
  if (service.kind === "launchd") {
    return {
      command: "launchctl",
      args: ["bootout", service.domain, service.plistPath],
    };
  }
  if (service.kind === "windows-task") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-Command",
        `Stop-ScheduledTask -TaskName '${escapePowerShell(service.label)}' -ErrorAction SilentlyContinue`,
      ],
    };
  }
  throw new Error(`Неизвестный background service: ${service.kind}`);
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
    killProcessTree(child);
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
}

function killProcessTree(child) {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    }

    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Процесс уже остановлен.
  }
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

function printSummary({
  desktopShortcut,
  mode,
  startNow,
  titleLibrary,
  values,
}) {
  console.log("\nУстановка станции завершена");
  console.log("==========================");
  console.log(`Режим: ${mode === "production" ? "production" : "test / development"}`);
  console.log(`PostgreSQL сервер: ${values.GRUBER_PG_HOST}:${values.GRUBER_PG_PORT} (роль ${values.GRUBER_DB_USER})`);
  console.log(`FFmpeg: ${values.FFMPEG_PATH}`);
  console.log(`TSDuck: ${values.TSDUCK_PATH}`);
  console.log(`GStreamer: ${values.GSTREAMER_LAUNCH_PATH}`);
  console.log(`Станционный конфиг: ${sharedEnvPath}`);
  console.log("Программы: создайте первую в окне FluxIO (Control Center → «Добавить программу»).");
  if (desktopShortcut) console.log(`Ярлык: ${desktopShortcut}`);
  if (titleLibrary) {
    console.log(
      `Папка титров: ${titleLibrary.folderPath}` +
        (titleLibrary.created ? "" : " (уже была)") +
        (titleLibrary.copied > 0 ? `, добавлено титров: ${titleLibrary.copied}` : ""),
    );
  }
  if (!startNow) console.log("Запуск пропущен. Повторите npm run setup или используйте команды из документации.");
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
