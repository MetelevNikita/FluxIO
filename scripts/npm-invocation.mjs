import { existsSync } from "node:fs";
import path from "node:path";

/* -------------------------------------------------------------------------- *
 * Как звать npm.
 *
 * На Windows `npm` — это `npm.cmd`, а Node начиная с 18.20.2 / 20.12 отказывается
 * запускать `.cmd` и `.bat` без `shell: true` (закрытие CVE-2024-27980) и отдаёт
 * `EINVAL`. Процесс при этом не стартует вовсе, поэтому `status` равен `null`, и
 * вызывающий код, смотрящий только на код возврата, сообщает «завершился с кодом
 * unknown» — то есть ничего.
 *
 * Предпочтительный путь — `node npm-cli.js`: он обходит `.cmd` целиком и не
 * требует shell, а значит не зависит от кавычек и от того, что окажется в PATH.
 * `npm.cmd` через shell остаётся запасным для установок, где `npm-cli.js` лежит
 * не рядом с `node.exe`.
 *
 * Модуль общий для мастера и сборщика: у них была своя логика запуска, и
 * сборщик на Windows падал там, где мастер уже работал.
 * ------------------------------------------------------------------------- */

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

/**
 * Причина, по которой процесс не выполнился, — словами.
 *
 * `spawnSync` при незапустившемся процессе оставляет `status === null` и кладёт
 * настоящую причину в `error`. Сообщение «с кодом unknown» её теряло, и
 * `EINVAL` от `.cmd` выглядел как необъяснимый отказ сборки.
 */
export function describeProcessFailure(label, result) {
  if (result.error) return `${label} не запустился: ${result.error.message}`;
  if (result.signal) return `${label} остановлен сигналом ${result.signal}`;
  return `${label} завершился с кодом ${result.status}`;
}
