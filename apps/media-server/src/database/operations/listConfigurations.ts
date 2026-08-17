import type { BroadcastConfigurationSummary } from "@gruber/contracts";

//

import type { DatabaseContext } from "../context.js";

export async function listConfigurations(
  database: DatabaseContext,
): Promise<BroadcastConfigurationSummary[]> {
  const configurations = await database.client.broadcastConfiguration.findMany({
    include: {
      endpoint: true,
      playlist: { select: { _count: { select: { items: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return configurations.map((configuration) => ({
    id: configuration.id,
    name: configuration.name,
    protocol: configuration.endpoint.protocol.toLowerCase() as "udp" | "srt" | "rtmp",
    playlistItems: configuration.playlist._count.items,
    updatedAt: configuration.updatedAt.toISOString(),
  }));
}

export async function deleteConfiguration(
  database: DatabaseContext,
  id: string,
): Promise<void> {
  await database.client.$transaction(async (transaction) => {
    const configuration = await transaction.broadcastConfiguration.delete({ where: { id } });

    await transaction.playlist.delete({ where: { id: configuration.playlistId } });
    await transaction.encodingProfile.delete({ where: { id: configuration.profileId } });
    await transaction.outputEndpoint.delete({ where: { id: configuration.endpointId } });
  });
}
