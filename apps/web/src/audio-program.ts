import type { AudioProgram, ProgramAudioTrack } from "@gruber/contracts";
import { maximumProgramAudioTracks } from "@gruber/contracts";

//

import type { AudioTrackInfo, MediaAsset } from "./types.js";

/**
 * Набор дорожек программы: сначала оригинал на основном audio PID, затем языки,
 * найденные по всему плейлисту, каждый со своим PID подряд. Набор фиксируется на
 * Start, потому что PMT нельзя менять в течение сессии.
 */
function buildProgramAudioTracks(
  playlist: MediaAsset[],
  originalLanguageCode: string,
  originalLabel: string,
  basePid: number,
): ProgramAudioTrack[] {
  const tracks: ProgramAudioTrack[] = [{
    languageCode: originalLanguageCode,
    label: originalLabel,
    original: true,
    pid: basePid,
  }];

  for (const language of collectLanguages(playlist)) {
    if (tracks.length >= maximumProgramAudioTracks) break;
    if (tracks.some((track) => track.languageCode === language.languageCode)) continue;

    tracks.push({
      languageCode: language.languageCode,
      label: language.label,
      original: false,
      pid: basePid + tracks.length,
    });
  }

  return tracks;
}

/** Языки, встречающиеся хотя бы у одного ролика, в стабильном порядке. */
function collectLanguages(playlist: MediaAsset[]): AudioTrackInfo[] {
  const byLanguage = new Map<string, AudioTrackInfo>();

  for (const asset of playlist) {
    for (const track of asset.audioTracks ?? []) {
      if (!byLanguage.has(track.languageCode)) byLanguage.set(track.languageCode, track);
    }
  }

  return [...byLanguage.values()]
    .sort((left, right) => left.languageCode.localeCompare(right.languageCode));
}

/**
 * Дорожка на таймлайне ролика: от левого края превью вправо на долю `fill`.
 * `fill < 1` — файл перевода короче ролика, остаток эфир доигрывает тишиной.
 */
export interface AudioTrackLane {
  key: string;
  label: string;
  kind: "original" | "present" | "partial" | "silent";
  /** Доля ширины ролика, покрытая реальным звуком, 0…1. */
  fill: number;
  durationSeconds: number | null;
  shortfallSeconds: number;
}

/**
 * Полосы для всех дорожек программы у выбранного ролика. Первая — оригинал: он
 * берётся из самого видео и всегда равен ролику. Дальше по одной на язык
 * программы; язык без файла у этого ролика — сплошная тишина.
 */
export function assetAudioLanes(
  asset: MediaAsset,
  programLanguageLabels: string[],
  originalLabel: string,
): AudioTrackLane[] {
  const clipSeconds = asset.durationSeconds > 0 ? asset.durationSeconds : 0;
  const byLabel = new Map((asset.audioTracks ?? []).map((track) => [track.label, track]));

  const lanes: AudioTrackLane[] = [{
    key: "original",
    label: originalLabel,
    kind: "original",
    fill: 1,
    durationSeconds: clipSeconds || null,
    shortfallSeconds: 0,
  }];

  for (const label of programLanguageLabels) {
    const track = byLabel.get(label);
    if (!track) {
      lanes.push({
        key: label,
        label,
        kind: "silent",
        fill: 0,
        durationSeconds: null,
        shortfallSeconds: clipSeconds,
      });
      continue;
    }

    // Длительность неизвестна (старый снимок сессии, ffprobe промолчал) —
    // рисуем полную полосу, а не пугаем оператора ложной недостачей.
    const durationSeconds = track.durationSeconds;
    const fill = durationSeconds != null && clipSeconds > 0
      ? Math.min(1, Math.max(0, durationSeconds / clipSeconds))
      : 1;
    const shortfallSeconds = durationSeconds != null && clipSeconds > 0
      ? Math.max(0, clipSeconds - durationSeconds)
      : 0;
    lanes.push({
      key: label,
      label,
      kind: fill < 1 ? "partial" : "present",
      fill,
      durationSeconds,
      shortfallSeconds,
    });
  }

  return lanes;
}

/** Подписи языков ролика для бейджей: `{eng}`, `{spain}`… */
export function assetLanguageLabels(asset: MediaAsset): string[] {
  return (asset.audioTracks ?? [])
    .map((track) => track.label)
    .sort((left, right) => left.localeCompare(right));
}

export function buildAudioProgram(
  playlist: MediaAsset[],
  options: {
    enabled: boolean;
    directoryPath: string | null;
    originalLanguageCode: string;
    originalLabel: string;
    basePid: number;
  },
): AudioProgram {
  const tracks = options.enabled
    ? buildProgramAudioTracks(
        playlist,
        options.originalLanguageCode,
        options.originalLabel,
        options.basePid,
      )
    : [];

  return {
    // Одна дорожка — это обычный одноязычный эфир, отдельный тракт не нужен.
    enabled: options.enabled && tracks.length > 1,
    directoryPath: options.directoryPath,
    originalLanguageCode: options.originalLanguageCode,
    originalLabel: options.originalLabel,
    tracks,
  };
}
