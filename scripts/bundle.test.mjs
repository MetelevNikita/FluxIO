import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  bundleTargetId,
  bundleTargetMismatch,
  digestDirectory,
  planBundleUpdate,
  validateBundleManifest,
} from "./bundle-manifest.mjs";
import {
  bundleToolPaths,
  detectBundleRoot,
  resolveBundledExecutable,
} from "./bundle-install.mjs";
import {
  migrationChecksum,
  pendingMigrations,
  readBundleMigrations,
} from "./bundle-migrations.mjs";
import {
  collectRuntimeClosure,
  resolvePackageDirectory,
} from "./bundle-runtime-closure.mjs";
import {
  archiveFileName,
  bundleEntryScript,
  packArchive,
  packSelfExtracting,
  selfExtractingFileName,
  selfExtractingHeader,
  writeChecksum,
} from "./bundle-archive.mjs";
import { pruneReason, pruneRules } from "./bundle-prune.mjs";
import {
  applyBundleUpdate,
  planUpdate,
  preservedApplicationFiles,
  updateRefusal,
} from "./bundle-update.mjs";
import { gstreamerEnvironment } from "./bundle-gstreamer.mjs";
import {
  buildPostgresSystemdUnit,
  clusterConfig,
  clusterDataDirectory,
  clusterEnvironment,
  escapeSqlLiteral,
  initdbArguments,
  pgCtlStartArguments,
  pgCtlStopArguments,
  buildPostgresLaunchAgentPlist,
  buildPostgresWindowsTaskCommand,
  clusterDirectoryState,
  postgresLaunchAgentLabel,
  postgresServiceName,
  postgresWindowsTaskName,
  readOrCreateSuperuserPassword,
  socketDirectoryFor,
  superuserPasswordFile,
  unixSocketPathLimit,
} from "./bundle-postgres.mjs";

function manifest(overrides = {}) {
  return {
    manifestVersion: 1,
    application: "FluxIO",
    version: "9.0.0",
    target: { arch: "x64", id: "linux-x64", platform: "linux" },
    profiles: ["workstation", "server"],
    node: { path: "runtime/node", version: "v24.0.0" },
    tools: { ffmpeg: "tools/ffmpeg", gstreamer: null, postgres: null, tsduck: null },
    components: [
      { bytes: 10, digest: "sha256:app", files: 2, id: "app", path: "app" },
      { bytes: 20, digest: "sha256:tools", files: 3, id: "tools/ffmpeg", path: "tools/ffmpeg" },
    ],
    ...overrides,
  };
}

async function scratch(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}

test("a bundle from another platform is refused before anything is written", () => {
  assert.equal(bundleTargetMismatch(manifest(), "linux-x64"), null);
  const message = bundleTargetMismatch(manifest(), "win-x64");
  assert.match(message ?? "", /linux-x64/);
  assert.match(message ?? "", /win-x64/);
  assert.equal(bundleTargetId("win32", "x64"), "win-x64");
  assert.equal(bundleTargetId("darwin", "arm64"), "macos-arm64");
  assert.equal(bundleTargetId("linux", "x64"), "linux-x64");
});

test("a broken manifest names the field: the machine has no internet to look it up", () => {
  assert.equal(validateBundleManifest(manifest()).version, "9.0.0");

  assert.throws(
    () => validateBundleManifest(manifest({ manifestVersion: 2 })),
    /не поддерживается/,
  );
  assert.throws(() => validateBundleManifest(manifest({ components: [] })), /components/);
  assert.throws(() => validateBundleManifest(manifest({ profiles: ["kiosk"] })), /kiosk/);
  assert.throws(
    () => validateBundleManifest(manifest({ components: [{ id: "app", path: "app" }] })),
    /components\[0\]\.digest/,
  );
});

test("an update moves only the components that changed", () => {
  const installed = manifest();
  const incoming = manifest({
    components: [
      { bytes: 11, digest: "sha256:app-9.0.1", files: 2, id: "app", path: "app" },
      { bytes: 20, digest: "sha256:tools", files: 3, id: "tools/ffmpeg", path: "tools/ffmpeg" },
      { bytes: 5, digest: "sha256:db", files: 1, id: "db", path: "db" },
    ],
  });

  // Медиастек весит сотни мегабайт и от версии к версии не меняется —
  // перекладывать его на каждое обновление незачем.
  assert.deepEqual(planBundleUpdate(installed, incoming), {
    changed: ["app", "db"],
    removed: [],
    unchanged: ["tools/ffmpeg"],
  });
  assert.deepEqual(planBundleUpdate(null, incoming).changed, ["app", "tools/ffmpeg", "db"]);
});

test("the component digest does not depend on the order files were written", async () => {
  const left = await scratch("fluxio-digest-a-");
  const right = await scratch("fluxio-digest-b-");
  try {
    await mkdir(path.join(left, "nested"), { recursive: true });
    await writeFile(path.join(left, "nested", "b.txt"), "второй");
    await writeFile(path.join(left, "a.txt"), "первый");

    await writeFile(path.join(right, "a.txt"), "первый");
    await mkdir(path.join(right, "nested"), { recursive: true });
    await writeFile(path.join(right, "nested", "b.txt"), "второй");

    const first = await digestDirectory(left);
    const second = await digestDirectory(right);
    assert.equal(first.digest, second.digest);
    assert.equal(first.files, 2);

    // Один изменённый байт обязан ломать сумму: комплект едет флешкой.
    await writeFile(path.join(right, "a.txt"), "первыи");
    assert.notEqual((await digestDirectory(right)).digest, first.digest);
  } finally {
    await rm(left, { force: true, recursive: true });
    await rm(right, { force: true, recursive: true });
  }
});

test("the bundle root is found from the application tree inside it", async () => {
  const root = await scratch("fluxio-bundle-");
  try {
    await mkdir(path.join(root, "app"), { recursive: true });
    await writeFile(path.join(root, "manifest.json"), "{}");

    assert.equal(detectBundleRoot(path.join(root, "app")), root);
    assert.equal(detectBundleRoot(root), root);
    // Обычное дерево проекта комплектом не притворяется.
    assert.equal(detectBundleRoot(path.join(root, "app", "apps")), null);
    // Уровнем выше комплект ищется, только если дерево лежит в `app/`: чужой
    // manifest.json рядом с репозиторием не должен ломать обычную установку.
    await mkdir(path.join(root, "repo"), { recursive: true });
    assert.equal(detectBundleRoot(path.join(root, "repo")), null);
    // Явный путь важнее найденного рядом.
    assert.equal(detectBundleRoot("/nowhere", root), root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("bundled executables are looked up in bin first, and .exe on Windows", async () => {
  const root = await scratch("fluxio-tools-");
  try {
    const ffmpeg = path.join(root, "tools", "ffmpeg");
    await mkdir(path.join(ffmpeg, "bin"), { recursive: true });
    await writeFile(path.join(ffmpeg, "bin", "ffmpeg"), "");
    await writeFile(path.join(ffmpeg, "ffprobe"), "");
    await writeFile(path.join(ffmpeg, "bin", "gst-launch-1.0.exe"), "");

    assert.equal(
      resolveBundledExecutable(ffmpeg, "ffmpeg", "linux"),
      path.join(ffmpeg, "bin", "ffmpeg"),
    );
    assert.equal(
      resolveBundledExecutable(ffmpeg, "ffprobe", "linux"),
      path.join(ffmpeg, "ffprobe"),
    );
    assert.equal(
      resolveBundledExecutable(ffmpeg, "gst-launch-1.0", "win32"),
      path.join(ffmpeg, "bin", "gst-launch-1.0.exe"),
    );
    assert.equal(resolveBundledExecutable(ffmpeg, "tsp", "linux"), null);

    const paths = bundleToolPaths(root, manifest(), "linux");
    assert.equal(paths.ffmpeg, path.join(ffmpeg, "bin", "ffmpeg"));
    assert.equal(paths.ffprobe, path.join(ffmpeg, "ffprobe"));
    // Комплект без медиастека — законный вариант: инструмент просто не объявлен.
    assert.equal(paths.tsduck, undefined);
    assert.equal(paths.psql, undefined);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("migrations keep their order and refuse a database that drifted", async () => {
  const root = await scratch("fluxio-migrations-");
  try {
    for (const [name, sql] of [
      ["20260804120000_second", "ALTER TABLE \"A\" ADD COLUMN \"b\" TEXT;"],
      ["20260803120000_initial", "CREATE TABLE \"A\" (\"id\" UUID);"],
    ]) {
      await mkdir(path.join(root, name), { recursive: true });
      await writeFile(path.join(root, name, "migration.sql"), sql);
    }

    const migrations = await readBundleMigrations(root);
    // Порядок задают имена каталогов: вторая миграция трогает таблицу первой.
    assert.deepEqual(migrations.map((entry) => entry.name), [
      "20260803120000_initial",
      "20260804120000_second",
    ]);
    assert.equal(migrations[0].checksum, migrationChecksum(migrations[0].sql));

    assert.deepEqual(
      pendingMigrations(migrations, [
        { checksum: migrations[0].checksum, migration_name: migrations[0].name },
      ]).map((entry) => entry.name),
      ["20260804120000_second"],
    );
    assert.equal(pendingMigrations(migrations, []).length, 2);

    // Изменившаяся сумма — расхождение базы с комплектом, накатывать нельзя.
    assert.throws(
      () => pendingMigrations(migrations, [
        { checksum: "0".repeat(64), migration_name: migrations[0].name },
      ]),
      /не совпадает с комплектом/,
    );

    await mkdir(path.join(root, "20260808120000_broken"), { recursive: true });
    await assert.rejects(readBundleMigrations(root), /без migration\.sql/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("the runtime closure takes dependencies and leaves the build toolchain behind", async () => {
  const root = await scratch("fluxio-closure-");
  try {
    const write = async (relativePath, manifestValue) => {
      const directory = path.join(root, relativePath);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "package.json"),
        JSON.stringify(manifestValue),
      );
    };

    await write("apps/service", {
      name: "@app/service",
      dependencies: { runtime: "1.0.0" },
      devDependencies: { typescript: "5.0.0" },
      optionalDependencies: { "native-linux": "1.0.0", "native-win32": "1.0.0" },
    });
    await write("node_modules/@app/service", { name: "@app/service" });
    await write("node_modules/runtime", { name: "runtime", dependencies: { nested: "1.0.0" } });
    await write("node_modules/nested", { name: "nested" });
    await write("node_modules/native-linux", { name: "native-linux" });
    await write("node_modules/typescript", { name: "typescript" });

    // Рабочий пакет резолвится ссылкой; чтобы фикстура осталась простой,
    // ссылку заменяет копия манифеста с настоящими зависимостями.
    await write("node_modules/@app/service", {
      name: "@app/service",
      dependencies: { runtime: "1.0.0" },
      devDependencies: { typescript: "5.0.0" },
      optionalDependencies: { "native-linux": "1.0.0", "native-win32": "1.0.0" },
    });

    const closure = await collectRuntimeClosure({
      entryPackages: ["@app/service"],
      projectRoot: root,
    });
    const names = closure.map((entry) => entry.name);

    assert.deepEqual(names, ["native-linux", "nested", "runtime"]);
    // TypeScript, Vite и electron-builder на целевой машине не нужны.
    assert.ok(!names.includes("typescript"));
    // Необязательная зависимость чужой платформы просто отсутствует на диске.
    assert.ok(!names.includes("native-win32"));

    // Вложенный node_modules важнее корневого — как и у самого Node.
    await write("node_modules/runtime/node_modules/nested", { name: "nested", version: "2" });
    assert.equal(
      await resolvePackageDirectory("nested", path.join(root, "node_modules/runtime"), root),
      path.join(root, "node_modules/runtime/node_modules/nested"),
    );
    // За пределы дерева проекта поиск не выходит: комплект не должен зацепить
    // пакет из глобальной установки сборочной машины.
    assert.equal(await resolvePackageDirectory("nowhere", root, root), null);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a required dependency that is missing stops the build, not the target machine", async () => {
  const root = await scratch("fluxio-closure-missing-");
  try {
    await mkdir(path.join(root, "node_modules", "@app", "service"), { recursive: true });
    await writeFile(
      path.join(root, "node_modules", "@app", "service", "package.json"),
      JSON.stringify({ name: "@app/service", dependencies: { absent: "1.0.0" } }),
    );

    await assert.rejects(
      collectRuntimeClosure({ entryPackages: ["@app/service"], projectRoot: root }),
      /Зависимость absent/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("the bundled cluster listens on loopback and logs where the operator can find it", () => {
  const config = clusterConfig({
    logDirectory: "/opt/fluxio/data/postgres-log",
    port: 5433,
    socketDirectory: "/opt/fluxio/data/postgres",
  });

  assert.match(config, /^port = 5433$/m);
  // По сети ходит интерфейс, а к базе обращается media-service той же машины.
  assert.match(config, /^listen_addresses = '127\.0\.0\.1'$/m);
  assert.match(config, /^logging_collector = on$/m);
  assert.match(config, /log_directory = '\/opt\/fluxio\/data\/postgres-log'/);
  assert.match(config, /unix_socket_directories = '\/opt\/fluxio\/data\/postgres'/);
  // На Windows unix-сокетов нет, и строка не должна появляться.
  assert.doesNotMatch(
    clusterConfig({ logDirectory: "C:/log", port: 5433, socketDirectory: null }),
    /unix_socket_directories/,
  );
});

test("the cluster is created with a locale that exists on every machine", () => {
  const args = initdbArguments({
    dataDirectory: "/opt/fluxio/data/postgres",
    passwordFile: "/tmp/pwd",
    superuser: "fluxio_admin",
  });

  // Минимальный серверный образ может не иметь ни одной локали, кроме C, а
  // кластер по локали хоста вёл бы себя на соседней машине иначе.
  assert.ok(args.includes("--locale=C"));
  assert.ok(args.includes("--encoding=UTF8"));
  assert.ok(args.includes("--auth-host=scram-sha-256"));
  // Пароль уходит файлом: в командной строке его видно всей машине.
  assert.deepEqual(args.slice(args.indexOf("--pwfile"), args.indexOf("--pwfile") + 2), [
    "--pwfile",
    "/tmp/pwd",
  ]);
});

test("cluster commands never inherit PG* from the operator's shell", () => {
  const environment = clusterEnvironment({
    LANG: "ru_RU.UTF-8",
    PATH: "/usr/bin",
    PGDATA: "/var/lib/postgresql/16/main",
    PGHOST: "db.example.net",
    PGPORT: "5432",
  });

  // Иначе pg_ctl и psql ушли бы на чужой сервер, который уже стоит на машине.
  assert.deepEqual(environment, { LANG: "C", LC_ALL: "C", PATH: "/usr/bin" });
});

test("start waits for readiness and stop is fast, both bounded", () => {
  const start = pgCtlStartArguments({ dataDirectory: "/data", logFile: "/log/startup.log" });
  assert.deepEqual(start, ["-D", "/data", "-l", "/log/startup.log", "-w", "-t", "60", "start"]);
  const stop = pgCtlStopArguments({ dataDirectory: "/data" });
  assert.deepEqual(stop, ["-D", "/data", "-m", "fast", "-w", "-t", "60", "stop"]);
});

test("the cluster unit starts before the service that cannot live without it", () => {
  const unit = buildPostgresSystemdUnit({
    dataDirectory: "/opt/fluxio/data/postgres",
    pgCtl: "/opt/fluxio/tools/postgres/bin/pg_ctl",
    serviceUser: "fluxio",
    startupLog: "/opt/fluxio/data/postgres-log/startup.log",
  });

  assert.equal(postgresServiceName, "fluxio-postgres.service");
  assert.match(unit, /Type=forking/);
  assert.match(unit, /User=fluxio/);
  assert.match(unit, /Environment=LC_ALL=C/);
  assert.match(unit, /ExecStart=\/opt\/fluxio\/tools\/postgres\/bin\/pg_ctl .* start$/m);
  assert.match(unit, /ExecStop=.* stop$/m);
  assert.match(unit, /WantedBy=multi-user\.target/);
});

test("a password with a quote in it stays a password, not a second statement", () => {
  assert.equal(escapeSqlLiteral("simple"), "'simple'");
  assert.equal(escapeSqlLiteral("pa'ss"), "'pa''ss'");
  assert.equal(escapeSqlLiteral("'; DROP DATABASE fluxio; --"), "'''; DROP DATABASE fluxio; --'");
  assert.throws(() => escapeSqlLiteral("two\nlines"), /управляющие символы/);
});

test("the superuser password survives a second run of the wizard", async () => {
  const installRoot = await scratch("fluxio-cluster-");
  try {
    let generated = 0;
    const first = await readOrCreateSuperuserPassword(installRoot, () => `secret-${++generated}`);
    const second = await readOrCreateSuperuserPassword(installRoot, () => `secret-${++generated}`);

    // Иначе повторная установка упиралась бы в пароль, которого никто не знает.
    assert.equal(first, "secret-1");
    assert.equal(second, "secret-1");
    assert.equal(generated, 1);
    assert.equal(
      superuserPasswordFile(installRoot),
      path.join(clusterDataDirectory(installRoot), ".fluxio-superuser"),
    );
  } finally {
    await rm(installRoot, { force: true, recursive: true });
  }
});

test("a deep install path does not leave the cluster unable to start", () => {
  // Длина пути к Unix-сокету ограничена ядром, и обойти это нечем: postmaster
  // просто не стартует — «could not create any Unix-domain sockets».
  const shallow = "/opt/fluxio/data/postgres";
  assert.equal(socketDirectoryFor(shallow, 5433, "linux"), shallow);

  const deep = `/home/operator/${"вложенная-папка/".repeat(8)}FluxIO/data/postgres`;
  assert.ok(Buffer.byteLength(`${deep}/.s.PGSQL.5433`) > unixSocketPathLimit);
  // Не отказ установки: приложение ходит в базу по TCP, сокет нужен лишь psql.
  assert.equal(socketDirectoryFor(deep, 5433, "linux"), null);

  // На Windows Unix-сокетов нет вовсе.
  assert.equal(socketDirectoryFor("C:/FluxIO/data/postgres", 5433, "win32"), null);
});

test("an interrupted first install is recognised, not reported as a full cluster", async () => {
  const root = await scratch("fluxio-cluster-state-");
  try {
    const dataDirectory = path.join(root, "data", "postgres");
    assert.equal(await clusterDirectoryState(dataDirectory), "absent");

    await mkdir(dataDirectory, { recursive: true });
    assert.equal(await clusterDirectoryState(dataDirectory), "empty");

    // initdb отказывается работать в непустом каталоге, а прерванная установка
    // оставляет ровно его: без PG_VERSION это не кластер, а остатки.
    await writeFile(path.join(dataDirectory, "base"), "");
    assert.equal(await clusterDirectoryState(dataDirectory), "incomplete");

    await writeFile(path.join(dataDirectory, "PG_VERSION"), "18\n");
    assert.equal(await clusterDirectoryState(dataDirectory), "cluster");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("GStreamer from the bundle looks for plugins in the bundle, not in the system", () => {
  const exists = () => true;
  const environment = gstreamerEnvironment({
    environment: { GST_PLUGIN_PATH: "/usr/lib/gstreamer-1.0", PATH: "/usr/bin" },
    exists,
    platform: "linux",
    registryPath: "/opt/fluxio/data/gstreamer/registry.bin",
    root: "/opt/fluxio/tools/gstreamer",
  });

  // Пути собирает `path.join`, а он берёт разделитель у **хозяйской** машины,
  // не у параметра `platform`: на Windows та же ветка вернула бы `\`. Проверка
  // здесь про то, куда смотрит GStreamer, поэтому разделитель приводим — иначе
  // тест падал бы на Windows, ничего не говоря о самом окружении.
  const samePath = (value, expected) => assert.equal(value?.replaceAll("\\", "/"), expected);

  samePath(environment.GST_PLUGIN_SYSTEM_PATH, "/opt/fluxio/tools/gstreamer/lib/gstreamer-1.0");
  samePath(
    environment.GST_PLUGIN_SCANNER,
    "/opt/fluxio/tools/gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner",
  );
  // Плагины системы собраны другой сборкой и роняют процесс на первом элементе.
  assert.equal(environment.GST_PLUGIN_PATH, undefined);
  // textrender рисует через pango, а тому нужен fontconfig из того же дерева.
  samePath(environment.FONTCONFIG_PATH, "/opt/fluxio/tools/gstreamer/etc/fonts");
  samePath(environment.LD_LIBRARY_PATH, "/opt/fluxio/tools/gstreamer/lib");
  // Реестр — в каталоге установки: в $HOME служба под systemd писать не может,
  // и он пересобирался бы при каждом старте.
  assert.equal(environment.GST_REGISTRY, "/opt/fluxio/data/gstreamer/registry.bin");

  const windows = gstreamerEnvironment({
    environment: { PATH: "C:/Windows" },
    exists,
    platform: "win32",
    root: "C:/FluxIO/tools/gstreamer",
  });
  assert.equal(windows.GST_PLUGIN_SCANNER.endsWith("gst-plugin-scanner.exe"), true);
  assert.match(windows.PATH, /^C:[\\/]FluxIO[\\/]tools[\\/]gstreamer[\\/]bin;/);
  assert.match(windows.PATH, /;C:\/Windows$/);
});

test("a bundle without GStreamer leaves the operator's environment alone", () => {
  const environment = { GST_PLUGIN_PATH: "/usr/lib/gstreamer-1.0", PATH: "/usr/bin" };
  // Комплект может собираться без медиастека — тогда работает системный
  // GStreamer, и трогать его настройки нельзя.
  assert.deepEqual(gstreamerEnvironment({ environment, root: undefined }), environment);
  // Реестр полезен и с системным GStreamer: служба под systemd пишет не в $HOME.
  assert.equal(
    gstreamerEnvironment({ environment, registryPath: "/opt/fluxio/data/gstreamer/registry.bin" })
      .GST_REGISTRY,
    "/opt/fluxio/data/gstreamer/registry.bin",
  );
  // Дерево без libexec не должно получать выдуманный путь к сканеру.
  const partial = gstreamerEnvironment({
    environment,
    exists: (filePath) => !filePath.includes("libexec"),
    platform: "linux",
    root: "/opt/fluxio/tools/gstreamer",
  });
  assert.equal(partial.GST_PLUGIN_SCANNER, undefined);
});

test("the wizard copy of the GStreamer environment matches the one the service uses", async (t) => {
  // Копия намеренная — мастер работает до сборки, служба не зависит от
  // bootstrap-скриптов, — но разойтись они не имеют права.
  let service;
  try {
    service = await import("../apps/media-server/dist-test/subtitles/gstreamer.js");
  } catch {
    t.skip("media-server не собран: сверять не с чем");
    return;
  }
  if (typeof service.gstreamerEnvironment !== "function") {
    t.skip("dist-test media-server устарел: пересоберите (npm test -w @gruber/media-server)");
    return;
  }

  for (const platform of ["linux", "darwin", "win32"]) {
    for (const exists of [() => true, () => false, (p) => !p.includes("libexec")]) {
      const input = {
        environment: { GST_PLUGIN_PATH: "/system", PATH: "/usr/bin" },
        exists,
        platform,
        registryPath: "/install/data/gstreamer/registry.bin",
        root: "/install/tools/gstreamer",
      };
      assert.deepEqual(gstreamerEnvironment(input), service.gstreamerEnvironment(input));
    }
  }
});

test("the cluster comes back after a reboot on macOS and on Windows too", () => {
  const plist = buildPostgresLaunchAgentPlist({
    dataDirectory: "/Users/iptv/FluxIO/data/postgres",
    label: postgresLaunchAgentLabel,
    postgres: "/Users/iptv/FluxIO/tools/postgres/bin/postgres",
    stderrPath: "/Users/iptv/Library/Logs/GruberPlayout/postgres-error.log",
    stdoutPath: "/Users/iptv/Library/Logs/GruberPlayout/postgres.log",
  });

  assert.equal(postgresLaunchAgentLabel, "live.gruber.postgres");
  // launchd следит за процессом, поэтому запускается сам postgres: pg_ctl
  // завершился бы сразу после старта, и следить было бы не за чем.
  assert.match(plist, /<string>\/Users\/iptv\/FluxIO\/tools\/postgres\/bin\/postgres<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /<key>LC_ALL<\/key><string>C<\/string>/);

  const command = buildPostgresWindowsTaskCommand({
    dataDirectory: "C:/FluxIO/data/postgres",
    pgCtl: "C:/FluxIO/tools/postgres/bin/pg_ctl.exe",
    start: true,
    startupLog: "C:/FluxIO/data/postgres-log/startup.log",
    taskName: postgresWindowsTaskName,
  });

  assert.equal(postgresWindowsTaskName, "FluxIO PostgreSQL");
  // Здесь наоборот: задача обязана завершиться, а сервер остаться работать.
  assert.match(command, /New-ScheduledTaskAction -Execute 'C:\/FluxIO\/tools\/postgres\/bin\/pg_ctl\.exe'/);
  assert.match(command, /-w -t 60 start/);
  assert.match(command, /New-ScheduledTaskTrigger -AtStartup/);
  assert.match(command, /ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
  assert.match(command, /Start-ScheduledTask/);
  assert.doesNotMatch(
    buildPostgresWindowsTaskCommand({
      dataDirectory: "C:/d",
      pgCtl: "C:/p.exe",
      start: false,
      startupLog: "C:/l",
      taskName: postgresWindowsTaskName,
    }),
    /Start-ScheduledTask/,
  );
});


test("the self-extracting file knows exactly where its archive starts", () => {
  const header = selfExtractingHeader({
    directoryName: "FluxIO-9.0.0-linux-x64",
    target: "linux-x64",
    version: "9.0.0",
  });
  const lines = header.split("\n");
  const declared = Number(
    lines.find((line) => line.startsWith("PAYLOAD_LINE="))?.split("=")[1],
  );

  // Номер подставляется после сборки заголовка, поэтому плейсхолдер обязан
  // жить на одной строке: иначе подстановка сдвинет счёт и распаковка
  // начнётся с середины архива.
  assert.equal(declared, lines.length);
  assert.equal(lines[declared - 1], "");
  assert.match(header, /^#!\/bin\/sh/);
  assert.match(header, /tail -n \+\$PAYLOAD_LINE "\$SELF" \| tar xz/);
  // Мастер зовётся рантаймом из комплекта: Node на целевой машине нет.
  assert.match(header, /exec "\$NODE" "\$DESTINATION\/app\/setup\.mjs" --bundle=/);

  assert.equal(archiveFileName("FluxIO-9.0.0-linux-x64"), "FluxIO-9.0.0-linux-x64.tar.gz");
  assert.equal(selfExtractingFileName("FluxIO-9.0.0-linux-x64", "linux"), "FluxIO-9.0.0-linux-x64.run");
  // На Windows единый файл — zip: его открывает сам проводник.
  assert.equal(selfExtractingFileName("FluxIO-9.0.0-win-x64", "win32"), "FluxIO-9.0.0-win-x64.zip");
});

test("a packed bundle unpacks back into the same tree, executable bits included", async (t) => {
  if (process.platform === "win32") {
    t.skip("на Windows единый файл — zip, распаковку делает проводник");
    return;
  }
  if (spawnSync("tar", ["--version"], { stdio: "ignore" }).status !== 0) {
    t.skip("tar недоступен");
    return;
  }

  const workspace = await scratch("fluxio-pack-");
  try {
    const directoryName = "FluxIO-9.0.0-test";
    const bundleRoot = path.join(workspace, directoryName);
    await mkdir(path.join(bundleRoot, "app"), { recursive: true });
    await mkdir(path.join(bundleRoot, "runtime"), { recursive: true });
    await writeFile(path.join(bundleRoot, "app", "setup.mjs"), "// мастер\n");
    await writeFile(path.join(bundleRoot, "manifest.json"), "{}\n");
    // Медиастек — исполняемые файлы: без бита выполнения комплект бесполезен.
    const nodeStub = path.join(bundleRoot, "runtime", "node");
    await writeFile(nodeStub, "#!/bin/sh\necho stub\n");
    await chmod(nodeStub, 0o755);

    const run = async (command, args) => {
      const result = spawnSync(command, args, { stdio: "ignore" });
      if (result.status !== 0) throw new Error(`${command} → ${result.status}`);
    };
    const archivePath = await packArchive({
      directoryName,
      outDirectory: workspace,
      run,
      sourceParent: workspace,
    });
    const runPath = path.join(workspace, `${directoryName}.run`);
    await packSelfExtracting({
      archivePath,
      header: selfExtractingHeader({ directoryName, target: "test", version: "9.0.0" }),
      outputPath: runPath,
    });

    const destination = path.join(workspace, "install");
    // Заголовок сам зовёт мастера — здесь его подменяет заглушка runtime/node.
    const extracted = spawnSync("sh", [runPath, destination], { encoding: "utf8" });
    assert.equal(extracted.status, 0, extracted.stderr);
    assert.equal(await readFile(path.join(destination, "manifest.json"), "utf8"), "{}\n");
    assert.match(await readFile(path.join(destination, "app", "setup.mjs"), "utf8"), /мастер/);
    // Бит выполнения пережил упаковку: иначе на целевой машине не запустится
    // ни Node из комплекта, ни FFmpeg.
    assert.match(extracted.stdout, /stub/);

    // Повторный запуск в тот же каталог — отказ, а не молчаливая перезапись
    // рабочей установки с её базой и `.env`.
    const again = spawnSync("sh", [runPath, destination], { encoding: "utf8" });
    assert.equal(again.status, 1);
    assert.match(again.stderr, /уже существует/);

    const { checksumPath, digest } = await writeChecksum(runPath);
    assert.match(await readFile(checksumPath, "utf8"), new RegExp(`^${digest}  ${directoryName}\\.run$`, "m"));
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test("the bundle carries only the database engine FluxIO actually uses", () => {
  // Prisma кладёт компилятор запросов на каждую СУБД — по 4.5 МБ в двух
  // вариантах и двух форматах модулей. Работаем мы только с PostgreSQL.
  assert.ok(pruneReason("@prisma/client/runtime/query_compiler_fast_bg.mysql.wasm-base64.js"));
  assert.ok(pruneReason("@prisma/client/runtime/query_compiler_small_bg.sqlserver.mjs"));
  assert.ok(pruneReason("@prisma/client/runtime/query_compiler_fast_bg.sqlite.js"));
  assert.ok(pruneReason("@prisma/client/runtime/query_compiler_fast_bg.cockroachdb.js"));

  // А его собственный — обязан остаться, иначе служба не сделает ни запроса.
  assert.equal(
    pruneReason("@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.js"),
    null,
  );
  assert.equal(pruneReason("@prisma/client/runtime/client.js"), null);
  assert.equal(pruneReason("@prisma/client/index.js"), null);

  // Карты исходников и просмотрщик PDF на эфирной машине не нужны, а разбор
  // документа — нужен.
  assert.ok(pruneReason("@prisma/client/runtime/client.js.map"));
  assert.ok(pruneReason("pdfjs-dist/web/viewer.mjs"));
  assert.equal(pruneReason("pdfjs-dist/legacy/build/pdf.mjs"), null);

  // Чужие пакеты правила не трогают: обрезка узкая и с причиной у каждого.
  assert.equal(pruneReason("fastify/lib/route.js.map"), null);
  assert.equal(pruneReason("pg/lib/client.js"), null);
  for (const rule of pruneRules()) assert.ok(rule.reason.length > 10, rule.id);
});

test("the entry script inside the bundle starts the wizard with the bundled runtime", () => {
  const windows = bundleEntryScript("win32");
  // Обратный слэш обязан остаться слэшем: путь с переводом строки внутри
  // молча ломает .cmd, и оператор видит непонятную ошибку вместо мастера.
  assert.match(windows, /"%ROOT%runtime\\node\.exe" "%ROOT%app\\setup\.mjs" --bundle=/);
  assert.doesNotMatch(windows, /runtime\node/);
  assert.match(windows, /^@echo off/);

  const posix = bundleEntryScript("linux");
  assert.match(posix, /^#!\/bin\/sh/);
  assert.match(posix, /exec "\$ROOT\/runtime\/node" "\$ROOT\/app\/setup\.mjs" --bundle="\$ROOT"/);
});

test("an update refuses everything it cannot safely do", () => {
  const installed = manifest({ version: "9.0.0" });
  const incoming = manifest({ version: "9.0.1" });

  assert.equal(updateRefusal(installed, incoming), null);
  // Та же версия — переносить нечего, а перезапись рабочей установки ради
  // ничего это лишний риск.
  assert.match(updateRefusal(installed, manifest({ version: "9.0.0" })) ?? "", /уже установлена/);
  // Чужая платформа: нативные части не переносятся.
  assert.match(
    updateRefusal(installed, manifest({
      target: { arch: "x64", id: "win-x64", platform: "win32" },
      version: "9.0.1",
    })) ?? "",
    /Платформы не совпадают/,
  );
});

test("an update keeps the database and the station settings", async () => {
  const workspace = await scratch("fluxio-update-");
  try {
    const installation = path.join(workspace, "installed");
    const incoming = path.join(workspace, "incoming");

    // Установленный комплект: приложение, титры, база и настройка станции.
    await mkdir(path.join(installation, "app"), { recursive: true });
    await mkdir(path.join(installation, "assets"), { recursive: true });
    await mkdir(path.join(installation, "data", "postgres"), { recursive: true });
    await writeFile(path.join(installation, "app", "setup.mjs"), "// 9.0.0\n");
    await writeFile(path.join(installation, "app", ".env"), "DATABASE_URL=\"живая\"\n");
    await writeFile(path.join(installation, "assets", "title.fto"), "старый\n");
    await writeFile(path.join(installation, "data", "postgres", "PG_VERSION"), "18\n");
    await writeFile(path.join(installation, "manifest.json"), "{}\n");

    // Новый комплект: приложение изменилось, титры — нет.
    await mkdir(path.join(incoming, "app"), { recursive: true });
    await mkdir(path.join(incoming, "assets"), { recursive: true });
    await writeFile(path.join(incoming, "app", "setup.mjs"), "// 9.0.1\n");
    await writeFile(path.join(incoming, "assets", "title.fto"), "старый\n");
    await writeFile(path.join(incoming, "manifest.json"), "{\"version\":\"9.0.1\"}\n");

    const installedManifest = manifest({
      components: [
        { bytes: 1, digest: "sha256:app-900", files: 1, id: "app", path: "app" },
        { bytes: 1, digest: "sha256:assets", files: 1, id: "assets", path: "assets" },
      ],
      version: "9.0.0",
    });
    const incomingManifest = manifest({
      components: [
        { bytes: 1, digest: "sha256:app-901", files: 1, id: "app", path: "app" },
        { bytes: 1, digest: "sha256:assets", files: 1, id: "assets", path: "assets" },
      ],
      version: "9.0.1",
    });

    const plan = planUpdate(installedManifest, incomingManifest);
    assert.deepEqual(plan, { changed: ["app"], removed: [], unchanged: ["assets"] });

    const result = await applyBundleUpdate({
      incoming: incomingManifest,
      installationRoot: installation,
      plan,
      sourceRoot: incoming,
    });
    assert.deepEqual(result, { kept: 1, moved: 1 });

    // Приложение обновилось…
    assert.equal(
      await readFile(path.join(installation, "app", "setup.mjs"), "utf8"),
      "// 9.0.1\n",
    );
    // …а настройка станции пережила замену компонента, внутри которого лежала.
    assert.equal(
      await readFile(path.join(installation, "app", ".env"), "utf8"),
      "DATABASE_URL=\"живая\"\n",
    );
    // База не входит ни в один компонент и не трогается вовсе.
    assert.equal(
      await readFile(path.join(installation, "data", "postgres", "PG_VERSION"), "utf8"),
      "18\n",
    );
    // Описание установки заменено новым.
    assert.match(await readFile(path.join(installation, "manifest.json"), "utf8"), /9\.0\.1/);
    // Времянка после переноса не остаётся: в следующий раз она выглядела бы
    // как чужие остатки.
    assert.equal(existsSync(path.join(installation, ".fluxio-update-stash")), false);
    assert.ok(preservedApplicationFiles.includes(".env"));
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test("a macOS application is described by its links, not unpacked into copies", async (t) => {
  if (process.platform === "win32") {
    t.skip("на Windows приложение macOS собирать нечем");
    return;
  }
  const root = await scratch("fluxio-symlink-");
  try {
    // Форма фреймворка macOS: реальные файлы в Versions/A, ссылки рядом.
    const versions = path.join(root, "Frameworks", "Electron.framework", "Versions");
    await mkdir(path.join(versions, "A", "Resources"), { recursive: true });
    await writeFile(path.join(versions, "A", "Electron"), "двоичный код");
    await writeFile(path.join(versions, "A", "Resources", "Info.plist"), "<plist/>");
    await symlink("A", path.join(versions, "Current"));
    await symlink(
      "Versions/Current/Electron",
      path.join(root, "Frameworks", "Electron.framework", "Electron"),
    );

    const first = await digestDirectory(root);
    // Ссылки посчитаны как записи, но их содержимое не удвоило размер.
    assert.equal(first.files, 4);
    assert.equal(first.bytes, Buffer.byteLength("двоичный код") + "<plist/>".length);

    // Подменённая ссылка — это подменённый фреймворк, и отпечаток обязан это
    // заметить.
    await rm(path.join(versions, "Current"));
    await symlink("B", path.join(versions, "Current"));
    assert.notEqual((await digestDirectory(root)).digest, first.digest);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
