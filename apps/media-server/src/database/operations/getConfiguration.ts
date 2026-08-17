import {
  savedBroadcastConfigurationSchema,
  startPlayoutRequestSchema,
  type SavedBroadcastConfiguration,
} from "@gruber/contracts";

//

import type { DatabaseContext } from "../context.js";
import { restoreEndpoint } from "../mappers.js";

export async function getConfiguration(
  database: DatabaseContext,
  id: string,
): Promise<SavedBroadcastConfiguration> {
  const configuration = await database.client.broadcastConfiguration.findUnique({
    include: {
      endpoint: true,
      playlist: {
        include: {
          items: {
            include: { mediaAsset: true },
            orderBy: { position: "asc" },
          },
        },
      },
      profile: true,
    },
    where: { id },
  });

  if (!configuration) {
    throw new Error("Broadcast configuration not found");
  }

  const profile = configuration.profile.settings as Record<string, unknown>;
  const endpoint = restoreEndpoint(
    configuration.endpoint.configuration,
    configuration.endpoint.encryptedSecret
      ? database.secrets.decrypt(configuration.endpoint.encryptedSecret)
      : "",
  );

  const request = startPlayoutRequestSchema.parse({
    playlist: configuration.playlist.items.map(restorePlaylistItem),
    video: profile.video,
    audio: profile.audio,
    logo: profile.logo ?? null,
    endpoint,
    repeatPlaylist: profile.repeatPlaylist ?? false,
    scte35: profile.scte35 ?? {},
  });

  return savedBroadcastConfigurationSchema.parse({
    ...request,
    id: configuration.id,
    name: configuration.name,
    createdAt: configuration.createdAt.toISOString(),
    updatedAt: configuration.updatedAt.toISOString(),
  });
}

//

function restorePlaylistItem(item: {
  id: string;
  trimInSeconds: number;
  trimOutSeconds: number | null;
  scte35Markers: unknown;
  scheduleMetadata: unknown;
  mediaAsset: {
    name: string;
    filePath: string;
    durationSeconds: number;
    hasAudio: boolean;
  };
}) {
  const schedule = item.scheduleMetadata as Record<string, unknown>;

  return {
    id: item.id,
    name: item.mediaAsset.name,
    filePath: item.mediaAsset.filePath,
    sourceDurationSeconds: item.mediaAsset.durationSeconds,
    hasAudio: item.mediaAsset.hasAudio,
    trimInSeconds: item.trimInSeconds,
    trimOutSeconds: item.trimOutSeconds,
    scte35Markers: item.scte35Markers,
    scheduleType: schedule.scheduleType ?? null,
    declaredDurationSeconds: schedule.declaredDurationSeconds ?? null,
    ageTitle: schedule.ageTitle ?? null,
    itemLogo: schedule.itemLogo ?? null,
  };
}
