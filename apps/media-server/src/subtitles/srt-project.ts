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
  firstCueStartSeconds: number | null;
  preRollSeconds: number;
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
  preRollSeconds = 0,
): Promise<DvbSubtitleProject> {
  const offsets: number[] = [];
  let offset = 0;
  for (const item of items) {
    offsets.push(offset);
    offset += item.durationSeconds;
  }
  const cueGroups = new Array<SrtCue[]>(items.length).fill([]);
  const subtitleReadConcurrency = 8;
  for (let start = 0; start < items.length; start += subtitleReadConcurrency) {
    await Promise.all(items.slice(start, start + subtitleReadConcurrency).map(async (item, localIndex) => {
      const index = start + localIndex;
      if (!item.subtitles?.enabled || !item.subtitles.filePath) return;
      const source = decodeSubtitleBuffer(await readFile(item.subtitles.filePath));
      const programOffset = offsets[index] ?? 0;
      cueGroups[index] = parseSrt(source)
        .map((cue) => ({
          startSeconds: programOffset + Math.max(0, cue.startSeconds - item.trimInSeconds),
          endSeconds: programOffset + Math.min(
            item.durationSeconds,
            cue.endSeconds - item.trimInSeconds,
          ),
          text: cue.text,
        }))
        .filter((cue) => cue.endSeconds > cue.startSeconds);
    }));
  }
  const programCues = cueGroups.flat();
  const sourceItems = cueGroups.filter((cues) => cues.length > 0).length;
  const firstCueStartSeconds = programCues[0]?.startSeconds ?? null;

  const effectivePreRollSeconds = Math.min(
    Math.max(0, preRollSeconds),
    firstCueStartSeconds ?? 0,
  );
  const transmittedCues = programCues.map((cue) => ({
    ...cue,
    endSeconds: cue.endSeconds - effectivePreRollSeconds,
    startSeconds: cue.startSeconds - effectivePreRollSeconds,
  }));
  return {
    content: serializeSrt(transmittedCues),
    cueCount: programCues.length,
    sourceItems,
    firstCueStartSeconds,
    preRollSeconds: effectivePreRollSeconds,
  };
}

export function decodeSubtitleBuffer(buffer: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1251").decode(buffer);
  }
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
