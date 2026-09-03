import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

/* -------------------------------------------------------------------------- *
 * Единый файл установки.
 *
 * Комплект — это каталог на сотни мегабайт, а до эфирной машины он едет
 * флешкой. Копировать дерево из тысяч файлов нельзя: половина копирований
 * обрывается на середине, и битый комплект выясняется уже на установке.
 *
 * Архив создаётся системным `tar`: он есть на всех трёх платформах (Windows
 * 10+ несёт bsdtar), сохраняет права на исполняемые файлы медиастека и не
 * требует ни одной зависимости в сборщике.
 *
 * На POSIX поверх архива кладётся самораспаковывающийся запуск: `sh`-заголовок
 * плюс тот же архив. Оператор запускает один файл, тот распаковывается и сам
 * зовёт мастера.
 * ------------------------------------------------------------------------- */

/** Строка, с которой в самораспаковывающемся файле начинается архив. */
const payloadLinePlaceholder = "__FLUXIO_PAYLOAD_LINE__";

export function archiveFileName(directoryName) {
  return `${directoryName}.tar.gz`;
}

export function selfExtractingFileName(directoryName, platform) {
  return platform === "win32" ? `${directoryName}.zip` : `${directoryName}.run`;
}

/**
 * Заголовок самораспаковывающегося файла.
 *
 * `tail -n +N` — приём makeself: заголовок считается строками, а всё после него
 * уходит в `tar` побайтно. Номер строки подставляется после сборки заголовка,
 * поэтому плейсхолдер обязан жить на одной строке — иначе подстановка сдвинет
 * счёт, и распаковка начнётся с середины архива.
 */
export function selfExtractingHeader({ directoryName, target, version }) {
  const header = `#!/bin/sh
# FluxIO ${version} (${target}) — самораспаковывающийся комплект.
# Запуск:   ./${directoryName}.run [каталог установки]
set -eu

PAYLOAD_LINE=${payloadLinePlaceholder}
SELF="$0"
DESTINATION="\${1:-$(pwd)/${directoryName}}"

if [ -e "$DESTINATION" ]; then
  echo "Каталог $DESTINATION уже существует." >&2
  echo "Укажите другой: ./${directoryName}.run /путь/установки" >&2
  exit 1
fi

echo "FluxIO ${version}: распаковка в $DESTINATION"
mkdir -p "$DESTINATION"
# Архив хранит один каталог верхнего уровня — снимаем его, чтобы содержимое
# легло прямо в выбранный каталог.
tail -n +$PAYLOAD_LINE "$SELF" | tar xz -C "$DESTINATION" --strip-components=1

NODE="$DESTINATION/runtime/node"
if [ ! -x "$NODE" ]; then
  echo "В комплекте нет runtime/node: файл повреждён при копировании." >&2
  exit 1
fi

echo "FluxIO ${version}: запуск мастера установки"
exec "$NODE" "$DESTINATION/app/setup.mjs" --bundle="$DESTINATION"
`;
  const lines = header.split("\n").length;
  return header.replace(payloadLinePlaceholder, String(lines));
}

/**
 * Точка входа внутри комплекта.
 *
 * Нужна прежде всего Windows: там единый файл — это zip, проводник его
 * распаковывает сам, и оператору нужен один понятный файл, по которому он
 * щёлкает. На POSIX то же самое лежит рядом с самораспаковывающимся запуском —
 * на случай, когда комплект уже распакован (обновление, повторная установка).
 */
export function bundleEntryScript(platform) {
  if (platform === "win32") {
    return `@echo off
rem FluxIO — установка из офлайн-комплекта.
setlocal
set "ROOT=%~dp0"
if not exist "%ROOT%runtime\\node.exe" (
  echo В комплекте нет runtime\\node.exe: архив распакован не полностью.
  pause
  exit /b 1
)
"%ROOT%runtime\\node.exe" "%ROOT%app\\setup.mjs" --bundle="%ROOT%."
pause
`;
  }
  return `#!/bin/sh
# FluxIO — установка из офлайн-комплекта.
set -eu
ROOT="$(cd "$(dirname "$0")" && pwd)"
if [ ! -x "$ROOT/runtime/node" ]; then
  echo "В комплекте нет runtime/node: архив распакован не полностью." >&2
  exit 1
fi
if [ "\${1:-}" = "--update" ]; then
  if [ -z "\${2:-}" ]; then
    echo "Укажите каталог установленного комплекта: ./install.sh --update /путь" >&2
    exit 1
  fi
  exec "$ROOT/runtime/node" "$ROOT/app/setup.mjs" --update="$2"
fi
exec "$ROOT/runtime/node" "$ROOT/app/setup.mjs" --bundle="$ROOT"
`;
}

/** Собирает архив каталога системным `tar`. */
export async function packArchive({ directoryName, outDirectory, run, sourceParent }) {
  const archivePath = path.join(outDirectory, archiveFileName(directoryName));
  await run("tar", ["-czf", archivePath, "-C", sourceParent, directoryName]);
  return archivePath;
}

/** Собирает zip для Windows: там его открывает сам проводник. */
export async function packZip({ directoryName, outDirectory, run, sourceParent }) {
  const zipPath = path.join(outDirectory, `${directoryName}.zip`);
  await run("tar", ["-a", "-c", "-f", zipPath, "-C", sourceParent, directoryName]);
  return zipPath;
}

/** Склеивает заголовок с архивом в один запускаемый файл. */
export async function packSelfExtracting({ archivePath, header, outputPath }) {
  const output = createWriteStream(outputPath, { mode: 0o755 });
  output.write(header);
  await pipeline(createReadStream(archivePath), output);
  return outputPath;
}

/**
 * Контрольная сумма рядом с файлом.
 *
 * Формат — как у `sha256sum`: оператор проверяет копию штатной командой своей
 * системы, а не нашим скриптом.
 */
export async function writeChecksum(filePath) {
  const digest = await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
  const checksumPath = `${filePath}.sha256`;
  await writeFile(checksumPath, `${digest}  ${path.basename(filePath)}\n`, "utf8");
  return { checksumPath, digest };
}

export async function fileSize(filePath) {
  return (await stat(filePath)).size;
}
