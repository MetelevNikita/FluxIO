import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { mediaProbeSchema, type MediaProbe } from "@gruber/contracts";
import { runCommand } from "./process.js";

const videoExtensions = new Set([
  ".avi",
  ".m2ts",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".mxf",
  ".ts",
  ".webm",
]);

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  pix_fmt?: string;
  color_space?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
}

interface ProbeDocument {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
    bit_rate?: string;
    size?: string;
  };
}

export async function probeMedia(
  filePath: string,
  ffprobePath: string,
): Promise<MediaProbe> {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`Media path must be absolute: ${filePath}`);
  }
  const resolvedPath = await realpath(filePath);
  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) {
    throw new Error(`Media path is not a file: ${resolvedPath}`);
  }
  const result = await runCommand(ffprobePath, [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    resolvedPath,
  ]);
  const document = JSON.parse(result.stdout) as ProbeDocument;
  const streams = document.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");

  if (!video) {
    throw new Error(`No video stream found: ${resolvedPath}`);
  }

  return mediaProbeSchema.parse({
    filePath: resolvedPath,
    name: path.basename(resolvedPath),
    durationSeconds: numberValue(document.format?.duration),
    videoCodec: video.codec_name ?? "unknown",
    videoProfile: video.profile ?? "unknown",
    width: video.width ?? 0,
    height: video.height ?? 0,
    frameRate: parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate),
    bitrate: numberValue(video.bit_rate ?? document.format?.bit_rate),
    sizeBytes: numberValue(document.format?.size, fileStat.size),
    pixelFormat: video.pix_fmt ?? "unknown",
    colorSpace: video.color_space ?? "unknown",
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name ?? null,
    audioSampleRate: audio ? Math.round(numberValue(audio.sample_rate)) : null,
    audioChannels: audio?.channels ?? null,
  });
}

/**
 * Длительность звукового файла в секундах. Нужна, чтобы показать оператору
 * дорожку короче ролика: такую дорожку эфир доигрывает тишиной.
 * `null` — ffprobe не смог определить длительность (битый или сырой поток).
 */
export async function probeAudioDurationSeconds(
  filePath: string,
  ffprobePath: string,
): Promise<number | null> {
  const result = await runCommand(ffprobePath, [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "format=duration:stream=duration",
    "-of",
    "json",
    filePath,
  ]);
  const document = JSON.parse(result.stdout) as ProbeDocument;
  const candidates = [
    document.format?.duration,
    document.streams?.[0]?.duration,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

export async function scanMediaDirectory(
  directoryPath: string,
  maxFiles = 1_000,
): Promise<string[]> {
  if (!path.isAbsolute(directoryPath)) {
    throw new Error(`Directory path must be absolute: ${directoryPath}`);
  }
  const root = await realpath(directoryPath);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Media path is not a directory: ${root}`);
  }
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (
        entry.isFile() &&
        videoExtensions.has(path.extname(entry.name).toLowerCase())
      ) {
        files.push(entryPath);
        if (files.length > maxFiles) {
          throw new Error(`Directory contains more than ${maxFiles} media files`);
        }
      }
    }
  }

  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function parseFrameRate(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const [numerator, denominator] = value.split("/").map(Number);
  if (!numerator || !denominator) {
    return numberValue(value);
  }
  return numerator / denominator;
}

function numberValue(value: string | number | undefined, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
