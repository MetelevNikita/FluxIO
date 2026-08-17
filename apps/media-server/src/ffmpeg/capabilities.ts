import {
  ffmpegCapabilitiesSchema,
  type FfmpegCapabilities,
} from "@gruber/contracts";
import { runCommand } from "./process.js";

/** `ffmpeg -filters` печатает строки вида ` ... subtitles         V->V  Render text ...`. */
export function hasFilter(filterList: string, name: string): boolean {
  return filterList.split(/\r?\n/).some((line) => {
    const columns = line.trim().split(/\s+/);
    return columns.length >= 2 && columns[1] === name;
  });
}

export class FfmpegCapabilitiesService {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  #cached: Promise<FfmpegCapabilities> | null = null;

  constructor(
    ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg",
    ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe",
  ) {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
  }

  get(): Promise<FfmpegCapabilities> {
    this.#cached ??= this.#detect();
    return this.#cached;
  }

  async #detect(): Promise<FfmpegCapabilities> {
    const [version, encoders, protocols, accelerators, filters] = await Promise.all([
      runCommand(this.ffmpegPath, ["-hide_banner", "-version"]),
      runCommand(this.ffmpegPath, ["-hide_banner", "-encoders"]),
      runCommand(this.ffmpegPath, ["-hide_banner", "-protocols"]),
      runCommand(this.ffmpegPath, ["-hide_banner", "-hwaccels"]),
      runCommand(this.ffmpegPath, ["-hide_banner", "-filters"]),
    ]);
    const videoEncoders = parseEncoders(encoders.stdout, "V");
    const audioEncoders = parseEncoders(encoders.stdout, "A");
    const outputProtocols = parseOutputProtocols(protocols.stdout);
    const hardwareAccelerators = parseListAfterHeader(
      accelerators.stdout,
      "Hardware acceleration methods:",
    );

    return ffmpegCapabilitiesSchema.parse({
      ffmpegPath: this.ffmpegPath,
      ffprobePath: this.ffprobePath,
      version: version.stdout.split("\n")[0]?.trim() ?? "unknown",
      videoEncoders,
      audioEncoders,
      outputProtocols,
      hardwareAccelerators,
      supports: {
        udp: outputProtocols.includes("udp"),
        srt: outputProtocols.includes("srt"),
        rtmp: outputProtocols.includes("rtmp"),
        h264: videoEncoders.some((name) =>
          ["libx264", "h264_nvenc", "h264_qsv", "h264_vaapi", "h264_videotoolbox"].includes(name),
        ),
        h265: videoEncoders.some((name) =>
          ["libx265", "hevc_nvenc", "hevc_qsv", "hevc_vaapi", "hevc_videotoolbox"].includes(name),
        ),
        mpeg2: videoEncoders.includes("mpeg2video"),
        aac: audioEncoders.includes("aac") || audioEncoders.includes("aac_at"),
        burnInSubtitles: hasFilter(filters.stdout, "subtitles"),
      },
    });
  }
}

function parseEncoders(output: string, mediaType: "V" | "A"): string[] {
  const names = new Set<string>();
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*([VAS])[A-Z.]{5}\s+(\S+)/);
    if (match?.[1] === mediaType && match[2]) {
      names.add(match[2]);
    }
  }
  return [...names].sort();
}

function parseOutputProtocols(output: string): string[] {
  const marker = output.indexOf("Output:");
  if (marker < 0) {
    return [];
  }
  return output
    .slice(marker + "Output:".length)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function parseListAfterHeader(output: string, header: string): string[] {
  const marker = output.indexOf(header);
  if (marker < 0) {
    return [];
  }
  return output
    .slice(marker + header.length)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}
