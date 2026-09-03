import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { StartPlayoutRequest } from "@gruber/contracts";

export interface GstreamerDvbSubtitleCommandOptions {
  inputPath: string;
  outputPort: number;
  preRollMs?: number;
  /**
   * Сдвиг файла субтитров относительно начала эфира. Ненулевой только при
   * перезапуске ветки посреди эфира: файл начинается с текущего момента, а PTS
   * обязаны остаться на программной шкале.
   */
  timelineOffsetMs?: number;
  request: StartPlayoutRequest;
}

export interface GstreamerCapabilities {
  launchPath: string;
  inspectPath: string;
  /** Окружение для процессов GStreamer: своё дерево плагинов и свой реестр. */
  environment: NodeJS.ProcessEnv;
  assertDvbSubtitlesAvailable(): Promise<void>;
  /** Версия GStreamer для журнала: разбор падений начинается именно с неё. */
  readVersion(): Promise<string | null>;
}

/**
 * Окружение процессов GStreamer.
 *
 * Две задачи, и обе видны только в бою.
 *
 * Первая — переносимость: GStreamer из офлайн-комплекта лежит в каталоге
 * установки, и без `GST_PLUGIN_SYSTEM_PATH` со сканером он найдёт плагины
 * системы или не найдёт вовсе. Пути ставятся только те, что реально есть в
 * дереве: выдуманный путь к сканеру хуже отсутствующего.
 *
 * Вторая — реестр плагинов. Он строится минуты, а кешируется в `$HOME`, куда
 * служба под systemd писать не может (`ProtectHome=read-only`): реестр
 * пересобирался бы при **каждом** старте, и первый ролик с субтитрами ждал бы
 * его. `GST_REGISTRY` уводит кеш в каталог установки, где право на запись есть.
 *
 * Переменные окружения оператора не трогаются, если комплект их не задал: с
 * системным GStreamer всё продолжает работать как раньше.
 */
export function gstreamerEnvironment({
  environment = process.env,
  exists = existsSync,
  platform = process.platform,
  registryPath = process.env.GSTREAMER_REGISTRY,
  root = process.env.GSTREAMER_ROOT,
}: {
  environment?: NodeJS.ProcessEnv;
  exists?: (filePath: string) => boolean;
  platform?: NodeJS.Platform;
  registryPath?: string | undefined;
  root?: string | undefined;
} = {}): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...environment };
  if (registryPath) result.GST_REGISTRY = registryPath;
  if (!root) return result;

  const join = (...parts: string[]) => path.join(root, ...parts);
  const pluginPath = join("lib", "gstreamer-1.0");
  if (exists(pluginPath)) {
    result.GST_PLUGIN_SYSTEM_PATH = pluginPath;
    // Плагины системы в комплекте не участвуют: собранные другой сборкой, они
    // роняют процесс на первом же элементе.
    delete result.GST_PLUGIN_PATH;
  }

  const scanner = join(
    "libexec",
    "gstreamer-1.0",
    platform === "win32" ? "gst-plugin-scanner.exe" : "gst-plugin-scanner",
  );
  if (exists(scanner)) result.GST_PLUGIN_SCANNER = scanner;

  const fonts = join("etc", "fonts");
  if (exists(fonts)) result.FONTCONFIG_PATH = fonts;

  const libraryPath = join("lib");
  if (exists(libraryPath)) {
    const variable = platform === "darwin"
      ? "DYLD_LIBRARY_PATH"
      : platform === "win32"
        ? "PATH"
        : "LD_LIBRARY_PATH";
    const separator = platform === "win32" ? ";" : ":";
    const previous = result[variable];
    const prefix = platform === "win32" ? [join("bin"), libraryPath] : [libraryPath];
    result[variable] = [...prefix, previous].filter(Boolean).join(separator);
  }

  return result;
}

export function createGstreamerCapabilities(
  launchPath = process.env.GSTREAMER_LAUNCH_PATH || "gst-launch-1.0",
): GstreamerCapabilities {
  const inspectPath = process.env.GSTREAMER_INSPECT_PATH || siblingCommand(launchPath, "gst-inspect-1.0");
  const environment = gstreamerEnvironment();
  return {
    launchPath,
    inspectPath,
    environment,
    async assertDvbSubtitlesAvailable() {
      await runWithTimeout(inspectPath, ["--exists", "dvbsubenc"], 15_000, environment).catch((error) => {
        throw new Error(
          `DVB subtitles require GStreamer with the dvbsubenc plugin (${inspectPath}): ${errorMessage(error)}`,
        );
      });
    },
    async readVersion() {
      // Версия — справочная величина, поэтому любая осечка гасится: из-за неё
      // эфир вставать не должен.
      const output = await captureWithTimeout(launchPath, ["--version"], 15_000, environment)
        .catch(() => "");
      return output.split(/\r?\n/)[0]?.trim() || null;
    },
  };
}

export function buildGstreamerDvbSubtitleCommand({
  inputPath,
  outputPort,
  preRollMs = 0,
  timelineOffsetMs = 0,
  request,
}: GstreamerDvbSubtitleCommandOptions): string[] {
  const subtitles = request.subtitleOutput;
  if (subtitles.mode !== "dvb") {
    throw new Error("DVB subtitle command requested while burn-in mode is selected");
  }
  const fontDescription = `${subtitles.fontFamily} ${subtitles.fontSize}`;
  return [
    "-q",
    "mpegtsmux",
    "name=mux",
    "alignment=7",
    `bitrate=${subtitles.bitrateKbps * 1_000}`,
    "!",
    "udpsink",
    "host=127.0.0.1",
    `port=${outputPort}`,
    "sync=true",
    "async=false",
    "filesrc",
    `location=${gstreamerFileLocation(inputPath)}`,
    "!",
    "subparse",
    "!",
    "textrender",
    `font-desc=${fontDescription}`,
    "halignment=center",
    "line-alignment=center",
    "valignment=bottom",
    `ypad=${subtitles.bottomMargin}`,
    "!",
    `video/x-raw,format=AYUV,width=${request.video.width},height=${request.video.height}`,
    "!",
    "dvbsubenc",
    `max-colours=${subtitles.maxColours}`,
    `ts-offset=${(subtitles.ptsOffsetMs + preRollMs + timelineOffsetMs) * 1_000_000}`,
    "!",
    "queue",
    "!",
    `mux.sink_${subtitles.pid}`,
  ];
}

/**
 * gst-launch parses backslashes in property values as escape characters even
 * when Node passes the value as a single spawn argument. GLib accepts forward
 * slashes for both drive-letter and UNC paths on Windows, so normalizing only
 * Windows-shaped paths keeps POSIX filenames untouched and prevents
 * C:\\Users\\... from becoming C:Users... inside filesrc.
 */
function gstreamerFileLocation(inputPath: string): string {
  const isWindowsDrivePath = /^[a-z]:[\\/]/i.test(inputPath);
  const isWindowsUncPath = /^\\\\/.test(inputPath);
  return isWindowsDrivePath || isWindowsUncPath
    ? inputPath.replace(/\\/g, "/")
    : inputPath;
}

function siblingCommand(commandPath: string, sibling: string): string {
  if (!commandPath.includes("/") && !commandPath.includes("\\")) return sibling;
  const extension = commandPath.toLowerCase().endsWith(".exe") ? ".exe" : "";
  return path.join(path.dirname(commandPath), `${sibling}${extension}`);
}

function runWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: environment, stdio: "ignore", windowsHide: true });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`probe timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`probe exited with code ${code ?? "unknown"}`));
    });
  });
}

function captureWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`probe timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(new Error(`probe exited with code ${code ?? "unknown"}`));
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
