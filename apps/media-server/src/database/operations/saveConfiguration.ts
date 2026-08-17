import type {
  MediaProbe,
  SaveBroadcastConfigurationRequest,
  SavedBroadcastConfiguration,
} from "@gruber/contracts";

//

import type { DatabaseContext, TransactionClient } from "../context.js";
import {
  endpointSecret,
  endpointWithoutSecret,
  jsonValue,
  mediaAssetData,
  protocolEnum,
} from "../mappers.js";
import { getConfiguration } from "./getConfiguration.js";

type PlaylistInput = SaveBroadcastConfigurationRequest["playlist"];
type ProbeByPath = Map<string, MediaProbe>;

interface ConfigurationRecords {
  configurationId: string;
  playlistId: string;
}

export async function saveConfiguration(
  database: DatabaseContext,
  input: SaveBroadcastConfigurationRequest,
  probes: MediaProbe[],
): Promise<SavedBroadcastConfiguration> {
  const probeByPath: ProbeByPath = new Map(probes.map((probe) => [probe.filePath, probe]));

  const configurationId = await database.client.$transaction(async (transaction) => {
    const records = await upsertConfigurationRecords(transaction, database, input);
    await replacePlaylistItems(transaction, records.playlistId, input.playlist, probeByPath);
    return records.configurationId;
  });

  return getConfiguration(database, configurationId);
}

//
// Конфигурация: playlist + encoding profile + output endpoint под общим именем
//

async function upsertConfigurationRecords(
  transaction: TransactionClient,
  database: DatabaseContext,
  input: SaveBroadcastConfigurationRequest,
): Promise<ConfigurationRecords> {
  const existing = await findExistingConfiguration(transaction, input);
  const data = buildConfigurationData(database, input);

  if (!existing) {
    return createConfigurationRecords(transaction, input.name, data);
  }

  await updateConfigurationRecords(transaction, existing, input.name, data);

  return { configurationId: existing.id, playlistId: existing.playlistId };
}

async function findExistingConfiguration(
  transaction: TransactionClient,
  input: SaveBroadcastConfigurationRequest,
) {
  if (input.id) {
    return transaction.broadcastConfiguration.findUnique({ where: { id: input.id } });
  }

  return transaction.broadcastConfiguration.findUnique({ where: { name: input.name } });
}

function buildConfigurationData(
  database: DatabaseContext,
  input: SaveBroadcastConfigurationRequest,
) {
  const secret = endpointSecret(input.endpoint);

  return {
    profileName: `${input.name}::profile`,
    endpointName: `${input.name}::endpoint`,
    profileSettings: jsonValue({
      video: input.video,
      audio: input.audio,
      logo: input.logo,
      repeatPlaylist: input.repeatPlaylist,
      scte35: input.scte35,
    }),
    protocol: protocolEnum(input.endpoint),
    configuration: jsonValue(endpointWithoutSecret(input.endpoint)),
    encryptedSecret: secret ? database.secrets.encrypt(secret) : null,
  };
}

type ConfigurationData = ReturnType<typeof buildConfigurationData>;

async function createConfigurationRecords(
  transaction: TransactionClient,
  name: string,
  data: ConfigurationData,
): Promise<ConfigurationRecords> {
  const playlist = await transaction.playlist.create({ data: { name } });
  const profile = await transaction.encodingProfile.create({
    data: { name: data.profileName, settings: data.profileSettings },
  });
  const endpoint = await transaction.outputEndpoint.create({
    data: {
      name: data.endpointName,
      protocol: data.protocol,
      configuration: data.configuration,
      encryptedSecret: data.encryptedSecret,
    },
  });
  const configuration = await transaction.broadcastConfiguration.create({
    data: {
      name,
      playlistId: playlist.id,
      profileId: profile.id,
      endpointId: endpoint.id,
    },
  });

  return { configurationId: configuration.id, playlistId: playlist.id };
}

async function updateConfigurationRecords(
  transaction: TransactionClient,
  existing: { id: string; playlistId: string; profileId: string; endpointId: string },
  name: string,
  data: ConfigurationData,
): Promise<void> {
  await transaction.playlistItem.deleteMany({ where: { playlistId: existing.playlistId } });
  await transaction.playlist.update({
    data: { name },
    where: { id: existing.playlistId },
  });
  await transaction.encodingProfile.update({
    data: { name: data.profileName, settings: data.profileSettings },
    where: { id: existing.profileId },
  });
  await transaction.outputEndpoint.update({
    data: {
      name: data.endpointName,
      protocol: data.protocol,
      configuration: data.configuration,
      encryptedSecret: data.encryptedSecret,
    },
    where: { id: existing.endpointId },
  });
  await transaction.broadcastConfiguration.update({
    data: { name },
    where: { id: existing.id },
  });
}

//
// Playlist: media asset upsert + позиция в эфирном порядке
//

async function replacePlaylistItems(
  transaction: TransactionClient,
  playlistId: string,
  playlist: PlaylistInput,
  probeByPath: ProbeByPath,
): Promise<void> {
  for (let position = 0; position < playlist.length; position += 1) {
    const item = playlist[position];
    if (!item) continue;

    const probe = probeByPath.get(item.filePath);
    if (!probe) {
      throw new Error(`Missing ffprobe result for ${item.filePath}`);
    }

    const asset = await transaction.mediaAsset.upsert({
      create: mediaAssetData(probe),
      update: mediaAssetData(probe),
      where: { filePath: probe.filePath },
    });

    await transaction.playlistItem.create({
      data: {
        playlistId,
        mediaAssetId: asset.id,
        position,
        trimInSeconds: item.trimInSeconds,
        trimOutSeconds: item.trimOutSeconds,
        scte35Markers: jsonValue(item.scte35Markers),
        scheduleMetadata: jsonValue({
          ageTitle: item.ageTitle,
          declaredDurationSeconds: item.declaredDurationSeconds,
          itemLogo: item.itemLogo,
          scheduleType: item.scheduleType,
        }),
      },
    });
  }
}
