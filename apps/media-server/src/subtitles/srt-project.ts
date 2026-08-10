import { readFile } from "node:fs/promises";
import type { PreparedPlayoutItem } from "../ffmpeg/command-builder.js";

export interface SrtCue {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface DvbSubtitleProject {
  content: string;
  cueCount: number;
  sourceItems: number;
}

export function parseSrt(content: string): SrtCue[] {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const cues: SrtCue[] = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex]?.match(
      /^\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})/,
    );
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    if (!timing || !text) continue;
    const startSeconds = parseSrtTime(timing[1] ?? "00:00:00,000");
    const endSeconds = parseSrtTime(timing[2] ?? "00:00:00,000");
    if (endSeconds <= startSeconds) continue;
    cues.push({ startSeconds, endSeconds, text });
  }
  return cues.sort((left, right) => left.startSeconds - right.startSeconds);
}

export async function buildDvbSubtitleProject(
  items: PreparedPlayoutItem[],
): Promise<DvbSubtitleProject> {
  const programCues: SrtCue[] = [];
  let programOffset = 0;
  let sourceItems = 0;

  for (const item of items) {
    if (item.subtitles?.enabled && item.subtitles.filePath) {
      const source = await readFile(item.subtitles.filePath, "utf8");
      const clipStart = item.trimInSeconds;
      const cues = parseSrt(source)
        .map((cue) => ({
          startSeconds: programOffset + Math.max(0, cue.startSeconds - clipStart),
          endSeconds: programOffset + Math.min(item.durationSeconds, cue.endSeconds - clipStart),
          text: cue.text,
        }))
        .filter((cue) => cue.endSeconds > programOffset && cue.endSeconds > cue.startSeconds);
      if (cues.length > 0) {
        sourceItems += 1;
        programCues.push(...cues);
      }
    }
    programOffset += item.durationSeconds;
  }

  return {
    content: serializeSrt(programCues),
    cueCount: programCues.length,
    sourceItems,
  };
}

export function serializeSrt(cues: SrtCue[]): string {
  if (cues.length === 0) return "";
  return cues.map((cue, index) => [
    String(index + 1),
    `${formatSrtTime(cue.startSeconds)} --> ${formatSrtTime(cue.endSeconds)}`,
    cue.text,
  ].join("\n")).join("\n\n") + "\n";
}

function parseSrtTime(value: string): number {
  const [hours = "0", minutes = "0", secondsAndMilliseconds = "0"] = value.split(":");
  const [seconds = "0", milliseconds = "0"] = secondsAndMilliseconds.split(/[,.]/);
  return Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds) +
    Number(milliseconds.padEnd(3, "0").slice(0, 3)) / 1_000;
}

function formatSrtTime(value: number): string {
  const totalMilliseconds = Math.max(0, Math.round(value * 1_000));
  const milliseconds = totalMilliseconds % 1_000;
  const totalSeconds = Math.floor(totalMilliseconds / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}
