import type { AudioProgram, ProgramAudioTrack } from "@gruber/contracts";
import { maximumProgramAudioTracks } from "@gruber/contracts";

//

import type { AudioTrackInfo, MediaAsset } from "./types";

/**
 * Набор дорожек программы: сначала оригинал на основном audio PID, затем языки,
 * найденные по всему плейлисту, каждый со своим PID подряд. Набор фиксируется на
 * Start, потому что PMT нельзя менять в течение сессии.
 */
export function buildProgramAudioTracks(
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
export function collectLanguages(playlist: MediaAsset[]): AudioTrackInfo[] {
  const byLanguage = new Map<string, AudioTrackInfo>();

  for (const asset of playlist) {
    for (const track of asset.audioTracks ?? []) {
      if (!byLanguage.has(track.languageCode)) byLanguage.set(track.languageCode, track);
    }
  }

  return [...byLanguage.values()]
    .sort((left, right) => left.languageCode.localeCompare(right.languageCode));
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
