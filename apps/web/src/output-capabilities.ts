import {
  nearestAudioCodec,
  nearestVideoCodec,
  outputProtocolCapabilities,
  type AudioCodec,
  type OutputProtocol,
  type OutputProtocolCapabilities,
  type VideoCodec,
} from "@gruber/contracts";
import { initialBroadcastSettings } from "./default-broadcast-settings.js";
import type { BroadcastSettings } from "./types.js";

/**
 * Возможности выбранного выхода на языке интерфейса.
 *
 * Матрица живёт в контрактах — одна на службу и на экран. Здесь только перевод
 * подписей интерфейса («RTMPS», «AAC-LC») в опознаватели контракта и приведение
 * настроек к тому, что транспорт действительно несёт.
 */

export const videoCodecLabels: Record<VideoCodec, string> = {
  h264: "H.264",
  h265: "H.265",
  mpeg2: "MPEG-2 Video",
};

export const audioCodecLabels: Record<AudioCodec, string> = {
  aac: "AAC-LC",
  mp2: "MP2",
  ac3: "AC-3",
};

/** RTMPS — тот же FLV поверх TLS: возможности у него ровно те же, что у RTMP. */
export function outputProtocolOf(protocol: string): OutputProtocol {
  if (protocol === "UDP") return "udp";
  if (protocol.startsWith("RTMP")) return "rtmp";
  return "srt";
}

export function outputCapabilitiesOf(protocol: string): OutputProtocolCapabilities {
  return outputProtocolCapabilities(outputProtocolOf(protocol));
}

export function videoCodecFromLabel(label: string): VideoCodec {
  if (label === "MPEG-2 Video") return "mpeg2";
  if (label === "H.265") return "h265";
  return "h264";
}

export function audioCodecFromLabel(label: string): AudioCodec {
  if (label === "MP2") return "mp2";
  if (label === "AC-3") return "ac3";
  return "aac";
}

export function videoCodecOptionsFor(protocol: string): string[] {
  return outputCapabilitiesOf(protocol).videoCodecs.map((codec) => videoCodecLabels[codec]);
}

export function audioCodecOptionsFor(protocol: string): string[] {
  return outputCapabilitiesOf(protocol).audioCodecs.map((codec) => audioCodecLabels[codec]);
}

/**
 * Приводит настройки к возможностям протокола.
 *
 * Гасятся только переключатели: включённый планировщик SCTE-35 при RTMP
 * раскладывал метки, которых FLV не несёт, и снаружи это выглядело как «метки
 * не дошли до головной станции». Именованные поля и PID при этом сохраняются:
 * инженер уходит на RTMP и возвращается, и потерять из-за этого настройку
 * службы MPEG-TS он не должен — на экране её просто нет, пока выбран FLV.
 */
export function settingsForOutputProtocol(
  settings: BroadcastSettings,
  protocol: string,
): BroadcastSettings {
  const id = outputProtocolOf(protocol);
  const effectiveProtocol = id !== "rtmp" || settings.outputStreams.some(
    (stream) => stream.endpoint.protocol !== "rtmp",
  ) ? "srt" : "rtmp";
  const capabilities = outputProtocolCapabilities(effectiveProtocol);
  const next: BroadcastSettings = { ...settings, protocol };

  next.videoCodec = videoCodecLabels[
    nearestVideoCodec(effectiveProtocol, videoCodecFromLabel(settings.videoCodec))
  ];
  next.audioCodec = audioCodecLabels[
    nearestAudioCodec(effectiveProtocol, audioCodecFromLabel(settings.audioCodec))
  ];
  if (!capabilities.scte35) {
    next.scte35PlanningEnabled = initialBroadcastSettings.scte35PlanningEnabled;
  }
  if (!capabilities.dvbSubtitles) {
    next.subtitleOutputMode = initialBroadcastSettings.subtitleOutputMode;
  }
  if (!capabilities.multipleAudioTracks) {
    next.audioTracksEnabled = initialBroadcastSettings.audioTracksEnabled;
  }
  if (!capabilities.transportBitrate) {
    next.udpTransportBitrate = initialBroadcastSettings.udpTransportBitrate;
  }

  return next;
}
