import type {
  MediaProbe,
  PlayoutEndpoint,
  PlayoutStatus,
  StartPlayoutRequest,
} from "@gruber/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import {
  BroadcastSessionState,
  OutputProtocol,
} from "../generated/prisma/enums.js";

export function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function mediaAssetData(probe: MediaProbe) {
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

//
// Endpoint: секрет хранится отдельно от остальной конфигурации
//

export function protocolEnum(endpoint: PlayoutEndpoint): OutputProtocol {
  if (endpoint.protocol === "udp") return OutputProtocol.UDP;
  if (endpoint.protocol === "srt") return OutputProtocol.SRT;
  return OutputProtocol.RTMP;
}

export function endpointSecret(endpoint: PlayoutEndpoint): string {
  if (endpoint.protocol === "srt") return endpoint.passphrase;
  if (endpoint.protocol === "rtmp") return endpoint.streamKey;
  return "";
}

export function endpointWithoutSecret(endpoint: PlayoutEndpoint): Record<string, unknown> {
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

export function restoreEndpoint(
  configuration: Prisma.JsonValue,
  secret: string,
): PlayoutEndpoint {
  const value = configuration as Record<string, unknown>;
  if (value.protocol === "srt") return { ...value, passphrase: secret } as PlayoutEndpoint;
  if (value.protocol === "rtmp") return { ...value, streamKey: secret } as PlayoutEndpoint;
  return value as PlayoutEndpoint;
}

export function redactRequest(request: StartPlayoutRequest): StartPlayoutRequest {
  if (request.endpoint.protocol === "srt") {
    return { ...request, endpoint: { ...request.endpoint, passphrase: "***" } };
  }
  if (request.endpoint.protocol === "rtmp") {
    return { ...request, endpoint: { ...request.endpoint, streamKey: "***" } };
  }
  return request;
}

export function sessionState(state: PlayoutStatus["state"]): BroadcastSessionState {
  if (state === "completed") return BroadcastSessionState.COMPLETED;
  if (state === "failed") return BroadcastSessionState.FAILED;
  return BroadcastSessionState.STOPPED;
}
