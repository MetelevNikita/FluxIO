import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveBundledExecutable } from "./bundle-install.mjs";

/* -------------------------------------------------------------------------- *
 * PostgreSQL из офлайн-комплекта.
 *
 * Кластер разворачивается в каталоге установки, а не в системном: на машине без
 * интернета ставить сервер нечем, а трогать уже работающий чужой кластер —
 * последнее, что должен делать установщик эфирного приложения.
 *
 * Данные лежат рядом с комплектом, но **вне** его компонентов: обновление
 * перекладывает только то, что перечислено в манифесте, и до `data/` не
 * доходит.
 * ------------------------------------------------------------------------- */

/** Исполняемые файлы кластера внутри `tools/postgres`. */
export function postgresExecutables(toolRoot, platform = process.platform) {
  const names = {
    initdb: "initdb",
    pgCtl: "pg_ctl",
    pgIsReady: "pg_isready",
    postgres: "postgres",
    psql: "psql",
  };
  const executables = {};
  for (const [key, name] of Object.entries(names)) {
    const resolved = resolveBundledExecutable(toolRoot, name, platform);
    if (resolved) executables[key] = resolved;
  }
  return executables;
}

/**
 * Куда положить Unix-сокет кластера.
 *
 * Длина пути к сокету ограничена ядром сотней с небольшим байт — это `sun_path`,
 * и ограничение не обходится ничем. Каталог установки может оказаться глубоким
 * (домашняя папка, кириллица, распаковка «куда получится»), и postmaster тогда
 * не стартует вовсе: «could not create any Unix-domain sockets».
 *
 * Поэтому сокет живёт рядом с данными, только пока помещается; иначе остаётся
 * системный каталог по умолчанию. Приложение ходит в базу по TCP на петлю, так
 * что сокет нужен лишь `psql` под рукой у инженера.
 */
export const unixSocketPathLimit = 103;

export function socketDirectoryFor(dataDirectory, port, platform = process.platform) {
  // На Windows Unix-сокетов нет вовсе.
  if (platform === "win32") return null;
  const socketPath = `${dataDirectory}/.s.PGSQL.${port}`;
  return Buffer.byteLength(socketPath) <= unixSocketPathLimit ? dataDirectory : null;
}

export function clusterDataDirectory(installRoot) {
  return path.join(installRoot, "data", "postgres");
}

export function clusterLogDirectory(installRoot) {
  return path.join(installRoot, "data", "postgres-log");
}

/**
 * Настройки кластера поверх умолчаний `initdb`.
 *
 * `listen_addresses` — только петля, даже в серверном профиле: по сети ходит
 * интерфейс, а к базе обращается только media-service на той же машине.
 */
export function clusterConfig({ logDirectory, port, socketDirectory }) {
  const lines = [
    "# FluxIO offline bundle",
    `port = ${port}`,
    "listen_addresses = '127.0.0.1'",
    "logging_collector = on",
    `log_directory = '${escapeConfigValue(logDirectory)}'`,
    "log_filename = 'postgresql-%Y-%m-%d.log'",
    "log_rotation_age = 1d",
    // Эфир держит несколько соединений: пул сервиса плюс мастер установки.
    "max_connections = 40",
  ];
  if (socketDirectory) {
    lines.push(`unix_socket_directories = '${escapeConfigValue(socketDirectory)}'`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Локаль кластера задаётся явно (`C` при кодировке UTF-8).
 *
 * Комплект ставится на машины, где локалей может не быть вовсе — минимальный
 * серверный образ, — и кластер, собранный по локали хоста, на соседней машине
 * повёл бы себя иначе. Сортировкой текста приложение всё равно занимается само.
 */
export function initdbArguments({ dataDirectory, passwordFile, superuser }) {
  return [
    "--pgdata", dataDirectory,
    "--username", superuser,
    "--pwfile", passwordFile,
    "--auth-local=scram-sha-256",
    "--auth-host=scram-sha-256",
    "--encoding=UTF8",
    "--locale=C",
  ];
}

/**
 * Окружение для процессов кластера.
 *
 * Две причины держать его отдельно от окружения оператора:
 *
 * - `PGHOST`, `PGPORT` и прочие `PG*` увели бы `pg_ctl` и `psql` на **чужой**
 *   сервер, который уже стоит на машине, — установка молча правила бы не тот
 *   кластер;
 * - без внятной локали postmaster на macOS отказывается стартовать вовсе
 *   («postmaster стал многопоточным при запуске»), а на минимальном Linux
 *   выбирает её наугад.
 */
export function clusterEnvironment(environment = process.env) {
  const result = { ...environment, LANG: "C", LC_ALL: "C" };
  for (const key of Object.keys(result)) {
    if (key.startsWith("PG")) delete result[key];
  }
  return result;
}

export function pgCtlStartArguments({ dataDirectory, logFile }) {
  // `-w` — ждать готовности: без него мастер пошёл бы создавать роль в
  // ещё не поднявшийся кластер.
  return ["-D", dataDirectory, "-l", logFile, "-w", "-t", "60", "start"];
}

export function pgCtlStopArguments({ dataDirectory }) {
  return ["-D", dataDirectory, "-m", "fast", "-w", "-t", "60", "stop"];
}

/** Кластер уже развёрнут: `PG_VERSION` появляется последним шагом `initdb`. */
export async function clusterExists(dataDirectory) {
  return existsSync(path.join(dataDirectory, "PG_VERSION"));
}

/**
 * Что делать с каталогом данных перед `initdb`.
 *
 * `initdb` отказывается работать в непустом каталоге, а прерванная первая
 * установка оставляет ровно его — недоделанный кластер без `PG_VERSION`.
 * Оператору на машине без интернета такой отказ нечем разобрать, поэтому
 * остатки убираются: своих данных в них нет, путь задаём мы сами.
 */
export async function clusterDirectoryState(dataDirectory) {
  if (!existsSync(dataDirectory)) return "absent";
  if (existsSync(path.join(dataDirectory, "PG_VERSION"))) return "cluster";
  return (await readdir(dataDirectory)).length === 0 ? "empty" : "incomplete";
}

/**
 * Строковый литерал SQL.
 *
 * Пароль оператор набирает сам, и одинарная кавычка в нём не должна ни ломать
 * запрос, ни тем более менять его. Управляющие символы отклоняются: в пароле
 * им делать нечего, а экранировать их по-разному умеют разные клиенты.
 */
export function escapeSqlLiteral(value) {
  if (/[\u0000-\u001f]/.test(value)) {
    throw new Error("Пароль содержит управляющие символы — уберите переводы строк и табуляции");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Заводит роль и базу, если их ещё нет.
 *
 * Идемпотентно: мастер запускают повторно, и вторая установка не должна падать
 * на существующей роли. Имена подставляются в кавычках как идентификаторы —
 * их проверяет сам мастер, пароль уходит литералом.
 */
export async function ensureRoleAndDatabase(client, { database, password, username }) {
  const role = quoteIdentifier(username);
  const created = { database: false, role: false };

  const { rows } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [username]);
  if (rows.length === 0) {
    await client.query(`CREATE ROLE ${role} LOGIN PASSWORD ${escapeSqlLiteral(password)}`);
    created.role = true;
  } else {
    await client.query(`ALTER ROLE ${role} LOGIN PASSWORD ${escapeSqlLiteral(password)}`);
  }

  const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
  if (existing.rows.length === 0) {
    // CREATE DATABASE не живёт в транзакции и не имеет IF NOT EXISTS — отсюда
    // проверка отдельным запросом.
    await client.query(`CREATE DATABASE ${quoteIdentifier(database)} OWNER ${role}`);
    created.database = true;
  }

  return created;
}

/**
 * Пароль суперпользователя кластера.
 *
 * Хранится рядом с данными и правами `0600`. Секрета он не добавляет и не
 * отнимает: кто читает каталог данных, тот и так владеет базой целиком. Зато
 * повторный запуск мастера может подключиться к уже развёрнутому кластеру —
 * иначе вторая установка упиралась бы в пароль, которого никто не знает.
 */
export function superuserPasswordFile(installRoot) {
  return path.join(clusterDataDirectory(installRoot), ".fluxio-superuser");
}

export async function readOrCreateSuperuserPassword(installRoot, generate) {
  const filePath = superuserPasswordFile(installRoot);
  try {
    const stored = (await readFile(filePath, "utf8")).trim();
    if (stored) return stored;
  } catch {
    // Файла ещё нет — кластер разворачивается впервые.
  }
  const password = generate();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${password}\n`, { encoding: "utf8", mode: 0o600 });
  return password;
}

/**
 * Разворачивает кластер комплекта и возвращает пути и признак «создан заново».
 *
 * `run` — запуск процесса (в мастере это его `runCommand`): отдельным
 * параметром, чтобы разворачивание можно было проверить тестом, не поднимая
 * весь мастер.
 */
export async function provisionCluster({
  executables,
  installRoot,
  log = () => {},
  port,
  run,
  superuser,
  superuserPassword,
}) {
  const dataDirectory = clusterDataDirectory(installRoot);
  const logDirectory = clusterLogDirectory(installRoot);
  const startupLog = path.join(logDirectory, "startup.log");
  await mkdir(logDirectory, { recursive: true });

  const environment = clusterEnvironment();
  const state = await clusterDirectoryState(dataDirectory);
  if (state === "incomplete") {
    log(`  Убираю остатки прерванной установки: ${dataDirectory}`);
    await rm(dataDirectory, { force: true, recursive: true });
  }
  const initialized = state === "cluster";
  if (!initialized) {
    log(`  Разворачиваю кластер: ${dataDirectory}`);
    await mkdir(path.dirname(dataDirectory), { recursive: true });
    const passwordFile = path.join(logDirectory, "initdb.pwd");
    // Пароль суперпользователя уходит в файл: в командной строке его видно
    // всей машине через список процессов.
    await writeFile(passwordFile, `${superuserPassword}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      await run(
        executables.initdb,
        initdbArguments({ dataDirectory, passwordFile, superuser }),
        { env: environment },
      );
    } finally {
      await rm(passwordFile, { force: true });
    }
    await writeFile(
      superuserPasswordFile(installRoot),
      `${superuserPassword}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } else {
    log(`  Кластер уже развёрнут: ${dataDirectory}`);
  }

  // Настройки переписываются на каждой установке: порт оператор мог изменить,
  // а кластер прошлой версии мог быть развёрнут вообще без нашего файла.
  await writeFile(
    path.join(dataDirectory, "conf.d-fluxio.conf"),
    clusterConfig({
      logDirectory,
      port,
      socketDirectory: socketDirectoryFor(dataDirectory, port),
    }),
    "utf8",
  );
  await ensureInclude(dataDirectory);

  return { dataDirectory, initialized: !initialized, logDirectory, startupLog };
}

/**
 * Подключает файл настроек комплекта к `postgresql.conf`.
 *
 * Дописывается ровно один раз: повторная установка не должна плодить строки
 * `include`, а сам `postgresql.conf` мы не переписываем — в нём могут быть
 * правки оператора.
 */
async function ensureInclude(dataDirectory) {
  const configPath = path.join(dataDirectory, "postgresql.conf");
  const contents = await readFile(configPath, "utf8");
  if (contents.includes("include = 'conf.d-fluxio.conf'")) return;
  await appendFile(
    configPath,
    "\n# FluxIO offline bundle\ninclude = 'conf.d-fluxio.conf'\n",
    "utf8",
  );
}

/**
 * systemd-unit кластера из комплекта.
 *
 * Отдельный unit, а не «пусть оператор сам»: после перезагрузки эфир обязан
 * подняться сам, а `autoResumeOnLaunch` без базы не восстановит ни расписание,
 * ни точку прерывания. Media-service привязывается к этому unit-у требованием,
 * иначе он стартует раньше и падает на первом же запросе к базе.
 */
export function buildPostgresSystemdUnit({ dataDirectory, pgCtl, serviceUser, startupLog }) {
  return `[Unit]
Description=FluxIO bundled PostgreSQL
After=network.target

[Service]
Type=forking
User=${serviceUser}
Environment=LANG=C
Environment=LC_ALL=C
ExecStart=${pgCtl} ${pgCtlStartArguments({ dataDirectory, logFile: startupLog }).join(" ")}
ExecStop=${pgCtl} ${pgCtlStopArguments({ dataDirectory }).join(" ")}
TimeoutSec=90
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
`;
}

/** Имя unit-а кластера: на него ссылается unit media-service. */
export const postgresServiceName = "fluxio-postgres.service";

/** Метка LaunchAgent кластера на macOS. */
export const postgresLaunchAgentLabel = "live.gruber.postgres";

/** Имя задачи планировщика Windows. */
export const postgresWindowsTaskName = "FluxIO PostgreSQL";

/**
 * LaunchAgent кластера.
 *
 * Запускается сам `postgres`, а не `pg_ctl`: launchd следит за процессом, а
 * `pg_ctl` завершается сразу после старта, и следить ему было бы не за чем.
 * Порт и остальные настройки берутся из `postgresql.conf` каталога данных.
 */
export function buildPostgresLaunchAgentPlist({
  dataDirectory,
  label,
  postgres,
  stderrPath,
  stdoutPath,
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(postgres)}</string>
    <string>-D</string>
    <string>${escapeXml(dataDirectory)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LANG</key><string>C</string>
    <key>LC_ALL</key><string>C</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(stdoutPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(stderrPath)}</string>
</dict>
</plist>
`;
}

/**
 * Задача планировщика Windows для кластера.
 *
 * Здесь наоборот — `pg_ctl start`: задача обязана завершиться, а сервер
 * остаётся работать сам. `-w` держит задачу до готовности кластера, поэтому
 * служба, стартующая следом, застаёт базу поднятой.
 */
export function buildPostgresWindowsTaskCommand({
  dataDirectory,
  pgCtl,
  start,
  startupLog,
  taskName,
}) {
  const args = pgCtlStartArguments({ dataDirectory, logFile: startupLog }).join(" ");
  const commands = [
    `Unregister-ScheduledTask -TaskName '${escapePowerShell(taskName)}' -Confirm:$false -ErrorAction SilentlyContinue`,
    `$action = New-ScheduledTaskAction -Execute '${escapePowerShell(pgCtl)}' -Argument '${escapePowerShell(args)}'`,
    "$trigger = New-ScheduledTaskTrigger -AtStartup",
    "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)",
    `Register-ScheduledTask -TaskName '${escapePowerShell(taskName)}' -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force`,
  ];
  if (start) commands.push(`Start-ScheduledTask -TaskName '${escapePowerShell(taskName)}'`);
  return commands.join("; ");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapePowerShell(value) {
  return value.replaceAll("'", "''");
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) {
    throw new Error(`Недопустимое имя PostgreSQL: ${value}`);
  }
  return `"${value}"`;
}

function escapeConfigValue(value) {
  return value.replaceAll("'", "''");
}
