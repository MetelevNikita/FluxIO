import { scheduleItemTypeFor } from "@gruber/contracts";
import type { AudioScanLanguage, SerializeScheduleRequest, GraphicEffectAsset } from "@gruber/contracts";
import type { MediaAsset, ScheduleMetadata, AudioTrackLibrary } from "./types.js";
import { encodeScheduleBlob } from "./schedule-blob.js";

export function scheduleExportRequest(items: MediaAsset[], metadata: ScheduleMetadata | null, effectLibrary: GraphicEffectAsset[], audioTrackLibrary: AudioTrackLibrary | null): SerializeScheduleRequest {
      const usedEffectIds = new Set(
        items.flatMap((asset) => (asset.scenes ?? []).map((show) => show.effectId)),
      );
      // Пометка между частями идёт в файл своей строкой — перед роликом, за
      // которым стояла в списке; роликом она при этом не считается.
      const media = items.filter((asset) => asset.rowKind !== "comment");
      const comments: NonNullable<SerializeScheduleRequest["comments"]> = [];
      let mediaBefore = 0;
      for (const asset of items) {
        if (asset.rowKind === "comment") comments.push({ beforeItemIndex: mediaBefore, text: asset.name });
        else mediaBefore += 1;
      }
      return {
        comments,
        delaySeconds: metadata?.delaySeconds ?? 0,
        extension: "txt",
        // Языки переводов уходят в файл заголовком: расписание открывают на
        // другой машине и через неделю, а пересканировать папку переводов при
        // открытии нечем — это ffprobe по каждому файлу расписания.
        audioLanguages: audioTrackLibrary?.languages
          ?? languagesFromPlaylist(items),
        broadcastEffects: effectLibrary
          .filter((effect) => effect.broadcast && usedEffectIds.has(effect.id))
          .map((effect) => ({
            effectId: effect.id,
            name: effect.name,
            kind: effect.broadcast!.kind,
            // base64: расписание разбирается по фигурным скобкам, а в JSON
            // сцены их полно.
            data: encodeScheduleBlob(effect.broadcast),
          })),
        items: media.map((asset) => ({
          type: asset.scheduleType ?? scheduleItemTypeFor(
            asset.declaredDurationSeconds ?? asset.durationSeconds,
          ),
          declaredDurationSeconds: asset.declaredDurationSeconds ?? asset.durationSeconds,
          // Часть разрезанного ролика играет файл со своей точки входа, а имя ей
          // дал оператор: без них открытое заново расписание пустило бы вторую
          // часть с начала фильма и под именем файла.
          inPointSeconds: asset.trimInSeconds || undefined,
          name: asset.name !== asset.filePath.split(/[\\/]/).at(-1) ? asset.name : undefined,
          filePath: asset.filePath,
          ageTitle: asset.ageTitle
            ? {
                durationSeconds: clampAgeDuration(asset.ageTitle.durationSeconds),
                enabled: asset.ageTitle.enabled,
                text: asset.ageTitle.text,
                filePath: asset.ageTitle.filePath,
              }
            : null,
          logoPath: asset.itemLogo?.enabled ? asset.itemLogo.filePath : null,
          graphicElements: (asset.effects ?? []).map((effect) => ({
            backgroundPath: effect.backgroundPath ?? effect.filePath,
            durationSeconds: effect.endSeconds - effect.startSeconds,
            endOnSeconds: effect.endSeconds,
            name: effect.name,
            startOnSeconds: effect.startSeconds,
            titlePath: effect.titlePath ?? null,
            titlePaths: effect.titlePaths,
          })),
          broadcastShows: (asset.scenes ?? []).map((show) => ({
            effectId: show.effectId,
            startOnSeconds: show.startSeconds,
            endOnSeconds: show.startSeconds + show.durationSeconds,
            fields: Object.keys(show.fields).length > 0 ? encodeScheduleBlob(show.fields) : "",
          })),
          scte35Markers: asset.scte35Markers ?? [],
          srtPath: asset.subtitles?.filePath ?? null,
          srtEnabled: Boolean(asset.subtitles?.enabled),
          audioTracks: (asset.audioTracks ?? []).map((track) => ({
            language: track.label,
            languageCode: track.languageCode,
            filePath: track.filePath,
          })),
        })),
        startTime: metadata?.startTime ?? "12:00:00.00",
      };
}

function languagesFromPlaylist(items: MediaAsset[]): AudioScanLanguage[] {
  const counts = new Map<string, { label: string; itemCount: number }>();
  for (const asset of items) {
    for (const track of asset.audioTracks ?? []) {
      const known = counts.get(track.languageCode);
      if (known) known.itemCount += 1;
      else counts.set(track.languageCode, { label: track.label, itemCount: 1 });
    }
  }
  return [...counts.entries()]
    .map(([languageCode, value]) => ({ languageCode, ...value }))
    .sort((left, right) => left.languageCode.localeCompare(right.languageCode));
}



function clampAgeDuration(value: number): number {
  return Math.round(Number.isFinite(value) ? Math.min(60, Math.max(10, value)) : 10);
}
