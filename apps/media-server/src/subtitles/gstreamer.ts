import { spawn } from "node:child_process";
import path from "node:path";
import type { StartPlayoutRequest } from "@gruber/contracts";

export interface GstreamerDvbSubtitleCommandOptions {
  inputPath: string;
  outputPort: number;
  preRollMs?: number;
  request: StartPlayoutRequest;
}

export interface GstreamerCapabilities {
  launchPath: string;
  inspectPath: string;
  assertDvbSubtitlesAvailable(): Promise<void>;
}

export function createGstreamerCapabilities(
  launchPath = process.env.GSTREAMER_LAUNCH_PATH || "gst-launch-1.0",
): GstreamerCapabilities {
  const inspectPath = process.env.GSTREAMER_INSPECT_PATH || siblingCommand(launchPath, "gst-inspect-1.0");
  return {
    launchPath,
    inspectPath,
    async assertDvbSubtitlesAvailable() {
      await runWithTimeout(inspectPath, ["--exists", "dvbsubenc"], 15_000).catch((error) => {
        throw new Error(
          `DVB subtitles require GStreamer with the dvbsubenc plugin (${inspectPath}): ${errorMessage(error)}`,
        );
      });
    },
  };
}

export function buildGstreamerDvbSubtitleCommand({
  inputPath,
  outputPort,
  preRollMs = 0,
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
    `ts-offset=${(subtitles.ptsOffsetMs + preRollMs) * 1_000_000}`,
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
export function gstreamerFileLocation(inputPath: string): string {
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

function runWithTimeout(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
