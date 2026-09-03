#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bundleDirectoryName,
  bundleManifestFileName,
  bundleManifestVersion,
  bundleProfiles,
  bundleTargetId,
  digestDirectory,
  formatBundleSummary,
  formatBytes,
  supportedBundleTargets,
} from "./bundle-manifest.mjs";
import {
  archiveFileName,
  bundleEntryScript,
  fileSize,
  packArchive,
  packSelfExtracting,
  packZip,
  selfExtractingFileName,
  selfExtractingHeader,
  writeChecksum,
} from "./bundle-archive.mjs";
import { resolveBundledExecutable } from "./bundle-install.mjs";
import { pruneReason } from "./bundle-prune.mjs";
import { collectRuntimeClosure } from "./bundle-runtime-closure.mjs";
import { listFilesRecursively } from "./bundle-manifest.mjs";

/* -------------------------------------------------------------------------- *
 * Сборщик офлайн-комплекта.
 *
 * Единственная машина, которой нужен интернет. Здесь выполняется всё, что
 * сегодня делается на целевой: сборка, разрешение зависимостей, упаковка
 * Electron. На целевую едет готовое дерево, и мастеру остаётся только
 * развернуть его, поднять базу и записать `.env`.
 *
 *   node scripts/build-offline-bundle.mjs --tools-from /opt/fluxio-tools
 *
 * Ключи:
 *   --out <dir>          куда положить комплект (по умолчанию ./release)
 *   --profiles a,b       профили установки (workstation, server)
 *   --tools-from <dir>   каталог с ffmpeg/tsduck/gstreamer/postgres
 *   --without-tools      собрать без медиастека: инструменты берутся из системы
 *   --with-desktop       включить упакованное Electron-приложение
 *   --pack               собрать единый файл установки и контрольную сумму
 *   --skip-build         дерево уже собрано, не пересобирать
 * ------------------------------------------------------------------------- */

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Инструменты медиастека: имя каталога в комплекте и исполняемый файл внутри. */
const bundledTools = [
  { executable: "ffmpeg", id: "ffmpeg", label: "FFmpeg и ffprobe" },
  { executable: "tsp", id: "tsduck", label: "TSDuck" },
  { executable: "gst-launch-1.0", id: "gstreamer", label: "GStreamer" },
  { executable: "postgres", id: "postgres", label: "PostgreSQL" },
];

/**
 * Дерево приложения: что переносится в комплект как есть.
 *
 * Список явный, а не «всё, кроме»: комплект уезжает на машину, где его нечем
 * починить, и случайно попавший в него dev-инструмент там не нужен, а случайно
 * не попавший рантайм-файл ломает эфир.
 */
const applicationTree = [
  "package.json",
  "launch.mjs",
  "setup.mjs",
  ".env.example",
  "scripts/bundle-gstreamer.mjs",
  "scripts/bundle-install.mjs",
  "scripts/bundle-manifest.mjs",
  "scripts/bundle-migrations.mjs",
  "scripts/bundle-postgres.mjs",
  "scripts/bundle-prune.mjs",
  "scripts/bundle-runtime-closure.mjs",
  "scripts/bundle-update.mjs",
  "apps/media-server/package.json",
  "apps/media-server/dist",
  "apps/media-server/prisma/schema.prisma",
  "apps/media-server/prisma/migrations",
  "apps/web/package.json",
  "apps/web/dist",
];

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const target = bundleTargetId();
  if (!supportedBundleTargets.includes(target) && !options.allowUnsupportedTarget) {
    throw new Error(
      `Платформа ${target} не входит в выпуск (${supportedBundleTargets.join(", ")}). ` +
        "Комплект собирается на машине той же платформы: нативные части между ними " +
        "не переносятся. Для проверки: --allow-unsupported-target.",
    );
  }

  const version = JSON.parse(
    await readFile(path.join(projectRoot, "package.json"), "utf8"),
  ).version;
  const bundleRoot = path.join(options.out, bundleDirectoryName(version, target));

  console.log(`FluxIO offline bundle ${version} · ${target}`);
  console.log(`  каталог: ${bundleRoot}`);

  if (!options.skipBuild) {
    console.log("\n1. Сборка дерева (npm run build)…");
    runNpm(["run", "build"]);
  } else {
    console.log("\n1. Сборка пропущена (--skip-build)");
  }

  await rm(bundleRoot, { force: true, recursive: true });
  await mkdir(bundleRoot, { recursive: true });

  console.log("\n2. Приложение…");
  await copyApplicationTree(bundleRoot);
  const runtimePackages = await copyRuntimeDependencies(bundleRoot);
  console.log(`  рантайм-зависимости: ${runtimePackages} пакет(ов)`);
  const pruned = await pruneRuntimeDependencies(bundleRoot);
  console.log(`  вырезано лишнего: ${pruned.files} файл(ов), ${formatBytes(pruned.bytes)}`);

  console.log("\n3. Node runtime…");
  const nodePath = await copyNodeRuntime(bundleRoot, target);
  console.log(`  ${nodePath} (${process.version})`);
  await writeEntryScript(bundleRoot, target);

  console.log("\n4. Миграции и титры…");
  await cp(
    path.join(projectRoot, "apps/media-server/prisma/migrations"),
    path.join(bundleRoot, "db/migrations"),
    { recursive: true },
  );
  await cp(path.join(projectRoot, "assets/titles"), path.join(bundleRoot, "assets/titles"), {
    recursive: true,
  });

  const components = [];
  console.log("\n5. Медиастек…");
  const tools = await copyTools(bundleRoot, options);
  for (const tool of tools) {
    console.log(`  ${tool.id}: ${tool.copied ? tool.from : "из системы (--without-tools)"}`);
  }

  if (options.withDesktop) {
    console.log("\n6. Electron-приложение…");
    await copyDesktopRelease(bundleRoot);
  }

  console.log("\n7. Контрольные суммы…");
  for (const id of ["app", "runtime", "db", "assets"]) {
    const directory = path.join(bundleRoot, bundleComponentPath(id));
    if (!existsSync(directory)) continue;
    components.push(await describeComponent(id, bundleRoot));
  }
  if (options.withDesktop) components.push(await describeComponent("desktop", bundleRoot));
  for (const tool of tools) {
    if (!tool.copied) continue;
    components.push(await describeComponent(`tools/${tool.id}`, bundleRoot, tool.version));
  }

  const manifest = {
    manifestVersion: bundleManifestVersion,
    application: "FluxIO",
    version,
    createdAt: new Date().toISOString(),
    target: { arch: process.arch, id: target, platform: process.platform },
    profiles: options.profiles,
    node: { path: nodePath, version: process.version },
    tools: Object.fromEntries(
      tools.map((tool) => [tool.id, tool.copied ? `tools/${tool.id}` : null]),
    ),
    components,
  };
  await writeFile(
    path.join(bundleRoot, bundleManifestFileName),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  if (options.pack) {
    console.log("\n8. Единый файл установки…");
    await packBundle({ bundleRoot, options, target, version });
  }

  console.log(`\n${formatBundleSummary(manifest)}`);
  console.log(`\nГотово: ${bundleRoot}`);
  if (!options.withDesktop) {
    console.log("  ! Electron-приложение не включено (--with-desktop).");
  }
  if (tools.some((tool) => !tool.copied)) {
    console.log("  ! Медиастек не включён: на целевой машине он должен быть установлен.");
  }
}

/**
 * Единый файл установки.
 *
 * На POSIX это самораспаковывающийся запуск: заголовок `sh` плюс архив, один
 * файл на всю установку. На Windows — zip: его открывает сам проводник, и это
 * тоже один файл, который оператор копирует на машину.
 *
 * Рядом всегда лежит `.sha256` в формате `sha256sum`: комплект едет флешкой, и
 * оборванное копирование должно выясняться до установки, а не в эфире.
 */
async function packBundle({ bundleRoot, options, target, version }) {
  const directoryName = path.basename(bundleRoot);
  const sourceParent = path.dirname(bundleRoot);
  const run = async (command, args) => {
    const result = spawnSync(command, args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${command} завершился с кодом ${result.status ?? "unknown"}`);
    }
  };

  if (process.platform === "win32") {
    const zipPath = await packZip({ directoryName, outDirectory: options.out, run, sourceParent });
    const { digest } = await writeChecksum(zipPath);
    console.log(`  ${path.basename(zipPath)} — ${formatBytes(await fileSize(zipPath))}`);
    console.log(`  sha256: ${digest}`);
    return;
  }

  const archivePath = await packArchive({
    directoryName,
    outDirectory: options.out,
    run,
    sourceParent,
  });
  const outputPath = path.join(options.out, selfExtractingFileName(directoryName, process.platform));
  await packSelfExtracting({
    archivePath,
    header: selfExtractingHeader({ directoryName, target, version }),
    outputPath,
  });
  await rm(archivePath, { force: true });
  const { digest } = await writeChecksum(outputPath);
  console.log(`  ${path.basename(outputPath)} — ${formatBytes(await fileSize(outputPath))}`);
  console.log(`  sha256: ${digest}`);
}

function bundleComponentPath(id) {
  return id === "db" ? "db" : id;
}

async function describeComponent(id, bundleRoot, version) {
  const relativePath = bundleComponentPath(id);
  const { bytes, digest, files } = await digestDirectory(path.join(bundleRoot, relativePath));
  console.log(`  ${id}: ${files} файл(ов)`);
  return version
    ? { bytes, digest, files, id, path: relativePath, version }
    : { bytes, digest, files, id, path: relativePath };
}

async function copyApplicationTree(bundleRoot) {
  for (const relativePath of applicationTree) {
    const source = path.join(projectRoot, relativePath);
    if (!existsSync(source)) {
      throw new Error(
        `Не найдено: ${relativePath}. Соберите дерево (npm run build) перед сборкой комплекта.`,
      );
    }
    await cp(source, path.join(bundleRoot, "app", relativePath), { recursive: true });
  }
}

/**
 * Рантайм-замыкание вместо `npm ci --omit=dev` на целевой машине.
 *
 * Ставить зависимости там нечем — сети нет, — а тащить всё дерево незачем:
 * TypeScript, Vite, electron-builder и Prisma CLI нужны только сборщику.
 */
async function copyRuntimeDependencies(bundleRoot) {
  // Точка входа одна: остальное — включая рабочие `@gruber/contracts` и
  // `@gruber/scene-renderer` — приходит её зависимостями и ложится в
  // `node_modules`, откуда их и резолвит собранный media-service.
  const closure = await collectRuntimeClosure({
    entryPackages: ["@gruber/media-server"],
    projectRoot,
  });
  for (const entry of closure) {
    // Workspace-пакеты уже скопированы деревом приложения; в node_modules они
    // кладутся копией, потому что символические ссылки npm перенос не переживают.
    const target = path.join(bundleRoot, "app", "node_modules", entry.name);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(entry.directory, target, { dereference: true, recursive: true });
  }
  return closure.length;
}

/**
 * Убирает из `node_modules` то, что на эфирной машине не понадобится никогда.
 *
 * Считается и печатается сэкономленное: обрезка живёт в отдельном модуле с
 * причиной у каждого правила, и её результат должен быть виден в сборке, а не
 * теряться молча.
 */
async function pruneRuntimeDependencies(bundleRoot) {
  const modules = path.join(bundleRoot, "app", "node_modules");
  const files = await listFilesRecursively(modules);
  let bytes = 0;
  let removed = 0;
  for (const entry of files) {
    // Ссылки не режем: правила описывают файлы пакетов, а не их устройство.
    if (entry.link != null || !pruneReason(entry.path)) continue;
    const filePath = path.join(modules, entry.path);
    bytes += (await stat(filePath)).size;
    await rm(filePath, { force: true });
    removed += 1;
  }
  return { bytes, files: removed };
}

async function copyNodeRuntime(bundleRoot, target) {
  const executable = target.startsWith("win") ? "node.exe" : "node";
  const relativePath = `runtime/${executable}`;
  await mkdir(path.join(bundleRoot, "runtime"), { recursive: true });
  await cp(process.execPath, path.join(bundleRoot, relativePath), { dereference: true });
  return relativePath;
}

/** Файл, по которому оператор запускает установку уже распакованного комплекта. */
async function writeEntryScript(bundleRoot, target) {
  const windows = target.startsWith("win");
  const name = windows ? "install.cmd" : "install.sh";
  await writeFile(
    path.join(bundleRoot, name),
    bundleEntryScript(windows ? "win32" : process.platform),
    { encoding: "utf8", mode: windows ? 0o644 : 0o755 },
  );
  console.log(`  точка входа: ${name}`);
}

async function copyTools(bundleRoot, options) {
  if (options.withoutTools) {
    return bundledTools.map((tool) => ({ ...tool, copied: false }));
  }
  if (!options.toolsFrom) {
    throw new Error(
      "Не указан каталог медиастека. Передайте --tools-from <dir> с подкаталогами " +
        `${bundledTools.map((tool) => tool.id).join(", ")} или соберите комплект ` +
        "без него: --without-tools.",
    );
  }
  const copied = [];
  for (const tool of bundledTools) {
    const source = path.join(options.toolsFrom, tool.id);
    if (!existsSync(source)) {
      throw new Error(
        `В ${options.toolsFrom} нет каталога ${tool.id} (${tool.label}). ` +
          "Комплект без инструмента собирать нельзя: на целевой машине его негде взять.",
      );
    }
    const destination = path.join(bundleRoot, "tools", tool.id);
    await cp(source, destination, { recursive: true });
    // Пустой каталог инструмента страшнее отсутствующего: комплект уедет
    // «полным», а медиастека в нём нет, и починить его там нечем.
    if (!resolveBundledExecutable(destination, tool.executable)) {
      throw new Error(
        `В ${source} нет исполняемого файла ${tool.executable} (${tool.label}). ` +
          "Ожидается bin/<файл> или <файл> в корне каталога инструмента.",
      );
    }
    copied.push({
      ...tool,
      copied: true,
      from: source,
      version: await readToolVersion(source),
    });
  }
  return copied;
}

/** Версия инструмента из файла VERSION рядом с ним: писать её руками надёжнее, чем угадывать. */
async function readToolVersion(directory) {
  try {
    return (await readFile(path.join(directory, "VERSION"), "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function copyDesktopRelease(bundleRoot) {
  const releaseRoot = path.join(projectRoot, "apps/desktop/release");
  if (!existsSync(unpackedDirectory(releaseRoot))) {
    console.log("  Упакованного приложения нет — собираю…");
    ensureElectronRuntime();
    runNpm(["run", "package:desktop:dir"]);
  }
  if (!existsSync(releaseRoot)) {
    throw new Error(
      "apps/desktop/release не найден: упаковка Electron не отработала.",
    );
  }
  const entries = await readdir(releaseRoot, { withFileTypes: true });
  const unpacked = entries.find(
    (entry) => entry.isDirectory() && entry.name.endsWith("unpacked"),
  ) ?? entries.find((entry) => entry.isDirectory() && entry.name === "mac-arm64");
  if (!unpacked) {
    throw new Error(
      "В apps/desktop/release нет распакованного приложения. " +
        "Выполните npm run package:desktop:dir.",
    );
  }
  // Симлинки сохраняются: во фреймворках macOS `Versions/Current` ссылается на
  // `Versions/A`, и разворачивание ссылок превращает приложение на 319 МБ в
  // 851 МБ полных копий.
  await cp(path.join(releaseRoot, unpacked.name), path.join(bundleRoot, "desktop"), {
    recursive: true,
    verbatimSymlinks: true,
  });
}

/** Каталог распакованного приложения внутри release, если он уже есть. */
function unpackedDirectory(releaseRoot) {
  if (!existsSync(releaseRoot)) return releaseRoot;
  const names = readdirSync(releaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const match = names.find((name) => name.endsWith("unpacked")) ??
    names.find((name) => /^(mac|linux|win)/.test(name));
  return match ? path.join(releaseRoot, match) : path.join(releaseRoot, "нет");
}

/**
 * Распаковывает рантайм Electron, если пакет установлен, а его бинарная часть —
 * нет.
 *
 * Так остаётся после `npm ci` без сети или с `--ignore-scripts`:
 * `node_modules/electron` на месте, а `dist/` пуст, и electron-builder падает
 * на «The specified electronDist does not exist» — сообщением, из которого не
 * следует, что делать. Установщик пакета сам берёт архив из кеша, если он там
 * уже есть, и скачивает, если нет.
 */
function ensureElectronRuntime() {
  const electronRoot = path.join(projectRoot, "node_modules", "electron");
  if (existsSync(path.join(electronRoot, "dist"))) return;
  const installer = path.join(electronRoot, "install.js");
  if (!existsSync(installer)) {
    throw new Error(
      "Пакет electron не установлен. Выполните npm ci --include=dev на машине с интернетом.",
    );
  }
  console.log("  Рантайм Electron не распакован — распаковываю…");
  const result = spawnSync(process.execPath, [installer], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      "Не удалось распаковать рантайм Electron. На машине с интернетом помогает " +
        "повторный npm ci --include=dev.",
    );
  }
}

function parseArguments(argv) {
  const options = {
    allowUnsupportedTarget: argv.includes("--allow-unsupported-target"),
    out: path.join(projectRoot, "release"),
    pack: argv.includes("--pack"),
    profiles: [...bundleProfiles],
    skipBuild: argv.includes("--skip-build"),
    toolsFrom: null,
    withDesktop: argv.includes("--with-desktop"),
    withoutTools: argv.includes("--without-tools"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--out" && value) options.out = path.resolve(value);
    if (argument === "--tools-from" && value) options.toolsFrom = path.resolve(value);
    if (argument === "--profiles" && value) {
      options.profiles = value.split(",").map((profile) => profile.trim()).filter(Boolean);
      for (const profile of options.profiles) {
        if (!bundleProfiles.includes(profile)) {
          throw new Error(`Неизвестный профиль установки: ${profile}`);
        }
      }
    }
  }
  return options;
}

function runNpm(args) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} завершился с кодом ${result.status ?? "unknown"}`);
  }
}

await main().catch((error) => {
  console.error(`\nОшибка сборки комплекта: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
