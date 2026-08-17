import { readdir, stat } from "node:fs/promises";
import path from "node:path";

//

import {
  audioTrackScanSchema,
  maximumProgramAudioTracks,
  type AudioTrack,
  type AudioTrackMatch,
  type AudioTrackScan,
} from "@gruber/contracts";
import { languageLabel, resolveLanguageCode } from "./languages.js";

/** `{eng} Название ролика.m4a` → токен языка + базовое имя без расширения. */
const languageTokenPattern = /^\{([^}]{1,32})\}\s*(.+)$/;

const audioExtensions = new Set([
  ".aac", ".ac3", ".eac3", ".flac", ".m4a", ".mka", ".mp2", ".mp3",
  ".oga", ".ogg", ".opus", ".wav", ".wma",
  // контейнеры с видео тоже принимаются: берём из них первую аудиодорожку
  ".mkv", ".mov", ".mp4", ".m4v", ".ts", ".mxf", ".webm",
]);

export class AudioTrackScanError extends Error {}

/**
 * Ищет дополнительные дорожки для каждого ролика: сначала в указанной папке,
 * затем в папке самого видео. Совпадением считается файл `{язык} <имя видео>`.
 */
export async function scanAudioTracks(
  directoryPath: string | null,
  mediaPaths: string[],
): Promise<AudioTrackScan> {
  const candidates = new Map<string, AudioCandidate[]>();

  for (const directory of await collectSearchDirectories(directoryPath, mediaPaths)) {
    for (const candidate of await readAudioCandidates(directory)) {
      const bucket = candidates.get(candidate.baseKey);
      if (bucket) bucket.push(candidate);
      else candidates.set(candidate.baseKey, [candidate]);
    }
  }

  const items: AudioTrackMatch[] = [];
  const languageCounts = new Map<string, { label: string; itemCount: number }>();

  for (const mediaFilePath of mediaPaths) {
    const tracks = matchTracks(candidates, mediaFilePath);
    items.push({ mediaFilePath, tracks });

    for (const track of tracks) {
      const known = languageCounts.get(track.languageCode);
      if (known) known.itemCount += 1;
      else languageCounts.set(track.languageCode, { label: track.label, itemCount: 1 });
    }
  }

  return audioTrackScanSchema.parse({
    items,
    languages: [...languageCounts.entries()]
      .map(([languageCode, value]) => ({ languageCode, ...value }))
      .sort((left, right) => left.languageCode.localeCompare(right.languageCode)),
  });
}

//
// Поиск файлов
//

interface AudioCandidate {
  baseKey: string;
  filePath: string;
  languageCode: string;
  label: string;
}

async function collectSearchDirectories(
  directoryPath: string | null,
  mediaPaths: string[],
): Promise<string[]> {
  const directories = new Set<string>();

  if (directoryPath) {
    if (!path.isAbsolute(directoryPath)) {
      throw new AudioTrackScanError("Audio track directory must be an absolute path");
    }
    const info = await stat(directoryPath).catch(() => null);
    if (!info?.isDirectory()) {
      throw new AudioTrackScanError(`Audio track directory not found: ${directoryPath}`);
    }
    directories.add(directoryPath);
  }

  for (const mediaFilePath of mediaPaths) {
    if (path.isAbsolute(mediaFilePath)) directories.add(path.dirname(mediaFilePath));
  }

  return [...directories];
}

async function readAudioCandidates(directory: string): Promise<AudioCandidate[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const candidates: AudioCandidate[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue;
    if (!audioExtensions.has(path.extname(entry.name).toLowerCase())) continue;

    const match = languageTokenPattern.exec(path.parse(entry.name).name);
    if (!match) continue;

    const [, token, baseName] = match;
    if (!token || !baseName) continue;

    candidates.push({
      baseKey: normalizeBaseName(baseName),
      filePath: path.join(directory, entry.name),
      languageCode: resolveLanguageCode(token),
      label: languageLabel(token),
    });
  }

  return candidates;
}

function matchTracks(
  candidates: Map<string, AudioCandidate[]>,
  mediaFilePath: string,
): AudioTrack[] {
  const baseKey = normalizeBaseName(path.parse(mediaFilePath).name);
  const found = candidates.get(baseKey);
  if (!found) return [];

  const byLanguage = new Map<string, AudioCandidate>();
  for (const candidate of found) {
    // Один язык — одна дорожка: первый найденный файл побеждает.
    if (!byLanguage.has(candidate.languageCode)) byLanguage.set(candidate.languageCode, candidate);
  }

  return [...byLanguage.values()]
    .sort((left, right) => left.languageCode.localeCompare(right.languageCode))
    .slice(0, maximumProgramAudioTracks)
    .map((candidate) => ({
      languageCode: candidate.languageCode,
      label: candidate.label,
      filePath: candidate.filePath,
      streamIndex: 0,
    }));
}

/** Имена сравниваются без регистра и без разницы в пробелах. */
export function normalizeBaseName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
