import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  savedBroadcastConfigurationSchema,
  startPlayoutRequestSchema,
  type BroadcastConfigurationSummary,
  type MediaProbe,
  type PlayoutEndpoint,
  type PlayoutStatus,
  type SaveBroadcastConfigurationRequest,
  type SavedBroadcastConfiguration,
  type StartPlayoutRequest,
} from "@gruber/contracts";
import {
  Prisma,
  PrismaClient,
} from "../generated/prisma/client.js";
import {
  BroadcastSessionState,
  OutputProtocol,
} from "../generated/prisma/enums.js";

export class DatabaseService {
  readonly client: PrismaClient;
  #secretKey: Buffer | null;

  constructor(connectionString: string, secretKeyBase64?: string) {
    const adapter = new PrismaPg({ connectionString });
    this.client = new PrismaClient({ adapter });
    this.#secretKey = parseSecretKey(secretKeyBase64);
  }

  static fromEnvironment(): DatabaseService | null {
    const connectionString = process.env.DATABASE_URL;
    return connectionString
      ? new DatabaseService(connectionString, process.env.GRUBER_SECRET_KEY)
      : null;
  }

  async connect(): Promise<void> {
    await this.client.$connect();
  }

  async disconnect(): Promise<void> {
    await this.client.$disconnect();
  }

  async saveConfiguration(
    input: SaveBroadcastConfigurationRequest,
    probes: MediaProbe[],
  ): Promise<SavedBroadcastConfiguration> {
    const probeByPath = new Map(probes.map((probe) => [probe.filePath, probe]));
    const secret = endpointSecret(input.endpoint);
    const encryptedSecret = secret ? this.#encrypt(secret) : null;
    const endpointConfiguration = endpointWithoutSecret(input.endpoint);
    const profileSettings = jsonValue({
      video: input.video,
      audio: input.audio,
      logo: input.logo,
      repeatPlaylist: input.repeatPlaylist,
      scte35: input.scte35,
    });

    const configurationId = await this.client.$transaction(async (transaction) => {
      const existing = input.id
        ? await transaction.broadcastConfiguration.findUnique({ where: { id: input.id } })
        : await transaction.broadcastConfiguration.findUnique({ where: { name: input.name } });
      const profileName = `${input.name}::profile`;
      const endpointName = `${input.name}::endpoint`;
      let playlistId: string;
      let profileId: string;
      let endpointId: string;
      let savedConfigurationId: string;

      if (existing) {
        playlistId = existing.playlistId;
        profileId = existing.profileId;
        endpointId = existing.endpointId;
        await transaction.playlistItem.deleteMany({ where: { playlistId } });
        await transaction.playlist.update({
          data: { name: input.name },
          where: { id: playlistId },
        });
        await transaction.encodingProfile.update({
          data: { name: profileName, settings: profileSettings },
          where: { id: profileId },
        });
        await transaction.outputEndpoint.update({
          data: {
            name: endpointName,
            protocol: protocolEnum(input.endpoint),
            configuration: jsonValue(endpointConfiguration),
            encryptedSecret,
          },
          where: { id: endpointId },
        });
        await transaction.broadcastConfiguration.update({
          data: { name: input.name },
          where: { id: existing.id },
        });
        savedConfigurationId = existing.id;
      } else {
        const playlist = await transaction.playlist.create({ data: { name: input.name } });
        const profile = await transaction.encodingProfile.create({
          data: { name: profileName, settings: profileSettings },
        });
        const endpoint = await transaction.outputEndpoint.create({
          data: {
            name: endpointName,
            protocol: protocolEnum(input.endpoint),
            configuration: jsonValue(endpointConfiguration),
            encryptedSecret,
          },
        });
        const configuration = await transaction.broadcastConfiguration.create({
          data: {
            name: input.name,
            playlistId: playlist.id,
            profileId: profile.id,
            endpointId: endpoint.id,
          },
        });
        playlistId = playlist.id;
        profileId = profile.id;
        endpointId = endpoint.id;
        savedConfigurationId = configuration.id;
      }

      for (let position = 0; position < input.playlist.length; position += 1) {
        const item = input.playlist[position];
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
          },
        });
      }

      return savedConfigurationId;
    });

    return this.getConfiguration(configurationId);
  }

  async listConfigurations(): Promise<BroadcastConfigurationSummary[]> {
    const configurations = await this.client.broadcastConfiguration.findMany({
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

  async getConfiguration(id: string): Promise<SavedBroadcastConfiguration> {
    const configuration = await this.client.broadcastConfiguration.findUnique({
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
        ? this.#decrypt(configuration.endpoint.encryptedSecret)
        : "",
    );
    const request = startPlayoutRequestSchema.parse({
      playlist: configuration.playlist.items.map((item) => ({
        id: item.id,
        name: item.mediaAsset.name,
        filePath: item.mediaAsset.filePath,
        trimInSeconds: item.trimInSeconds,
        trimOutSeconds: item.trimOutSeconds,
        scte35Markers: item.scte35Markers,
      })),
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

  async deleteConfiguration(id: string): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      const configuration = await transaction.broadcastConfiguration.delete({
        where: { id },
      });
      await transaction.playlist.delete({ where: { id: configuration.playlistId } });
      await transaction.encodingProfile.delete({ where: { id: configuration.profileId } });
      await transaction.outputEndpoint.delete({ where: { id: configuration.endpointId } });
    });
  }

  async recordSessionStart(
    request: StartPlayoutRequest,
    status: PlayoutStatus,
  ): Promise<void> {
    if (!status.sessionId) return;
    await this.client.broadcastSession.create({
      data: {
        runtimeSessionId: status.sessionId,
        state: BroadcastSessionState.RUNNING,
        requestSnapshot: jsonValue(redactRequest(request)),
      },
    });
  }

  async syncSession(status: PlayoutStatus): Promise<void> {
    if (!status.sessionId || ["starting", "running", "stopping"].includes(status.state)) {
      return;
    }
    await this.client.broadcastSession.updateMany({
      data: {
        state: sessionState(status.state),
        error: status.error,
        stoppedAt: status.stoppedAt ? new Date(status.stoppedAt) : new Date(),
      },
      where: {
        runtimeSessionId: status.sessionId,
        stoppedAt: null,
      },
    });
  }

  #encrypt(value: string): string {
    if (!this.#secretKey) {
      throw new Error(
        "GRUBER_SECRET_KEY (32-byte base64) is required to store SRT/RTMP secrets",
      );
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#secretKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((part) => part.toString("base64")).join(".");
  }

  #decrypt(value: string): string {
    if (!this.#secretKey) {
      throw new Error("GRUBER_SECRET_KEY is required to read endpoint secrets");
    }
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) {
      throw new Error("Stored endpoint secret is invalid");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#secretKey,
      Buffer.from(ivValue, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}

function mediaAssetData(probe: MediaProbe) {
  return {
    filePath: probe.filePath,
    name: probe.name,
    durationSeconds: probe.durationSeconds,
    videoCodec: probe.videoCodec,
    videoProfile: probe.videoProfile,
    width: probe.width,
    height: probe.height,
    frameRate: probe.frameRate,
    bitrate: BigInt(Math.round(probe.bitrate)),
    sizeBytes: BigInt(Math.round(probe.sizeBytes)),
    pixelFormat: probe.pixelFormat,
    colorSpace: probe.colorSpace,
    hasAudio: probe.hasAudio,
    audioCodec: probe.audioCodec,
    audioSampleRate: probe.audioSampleRate,
    audioChannels: probe.audioChannels,
  };
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function protocolEnum(endpoint: PlayoutEndpoint): OutputProtocol {
  if (endpoint.protocol === "udp") return OutputProtocol.UDP;
  if (endpoint.protocol === "srt") return OutputProtocol.SRT;
  return OutputProtocol.RTMP;
}

function endpointSecret(endpoint: PlayoutEndpoint): string {
  if (endpoint.protocol === "srt") return endpoint.passphrase;
  if (endpoint.protocol === "rtmp") return endpoint.streamKey;
  return "";
}

function endpointWithoutSecret(endpoint: PlayoutEndpoint): Record<string, unknown> {
  if (endpoint.protocol === "srt") {
    const { passphrase: _passphrase, ...configuration } = endpoint;
    return configuration;
  }
  if (endpoint.protocol === "rtmp") {
    const { streamKey: _streamKey, ...configuration } = endpoint;
    return configuration;
  }
  return endpoint;
}

function restoreEndpoint(configuration: Prisma.JsonValue, secret: string): PlayoutEndpoint {
  const value = configuration as Record<string, unknown>;
  if (value.protocol === "srt") return { ...value, passphrase: secret } as PlayoutEndpoint;
  if (value.protocol === "rtmp") return { ...value, streamKey: secret } as PlayoutEndpoint;
  return value as PlayoutEndpoint;
}

function parseSecretKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("GRUBER_SECRET_KEY must decode to exactly 32 bytes");
  }
  return key;
}

function redactRequest(request: StartPlayoutRequest): StartPlayoutRequest {
  if (request.endpoint.protocol === "srt") {
    return { ...request, endpoint: { ...request.endpoint, passphrase: "***" } };
  }
  if (request.endpoint.protocol === "rtmp") {
    return { ...request, endpoint: { ...request.endpoint, streamKey: "***" } };
  }
  return request;
}

function sessionState(state: PlayoutStatus["state"]): BroadcastSessionState {
  if (state === "completed") return BroadcastSessionState.COMPLETED;
  if (state === "failed") return BroadcastSessionState.FAILED;
  return BroadcastSessionState.STOPPED;
}
