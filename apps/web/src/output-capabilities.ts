import {
  nearestAudioCodec,
  nearestVideoCodec,
  outputProtocolCapabilities,
  type AudioCodec,
  type FfmpegCapabilities,
  type OutputProtocol,
  type OutputProtocolCapabilities,
  type StartPlayoutRequest,
  type VideoCodec,
  type VideoHardware,
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

export function audioCodecOptionsFor(
  protocol: string,
  capabilities?: FfmpegCapabilities | null,
): string[] {
  const carried = outputCapabilitiesOf(protocol).audioCodecs;
  const available = capabilities
    ? carried.filter((codec) => capabilities.audioEncoders.includes(codec))
    : carried;
  return (available.length ? available : carried.slice(0, 1)).map((codec) => audioCodecLabels[codec]);
}

const hardwareEncoderNames: Record<Exclude<VideoHardware, "off" | "auto">, Record<VideoCodec, string | null>> = {
  nvenc: { h264: "h264_nvenc", h265: "hevc_nvenc", mpeg2: null },
  qsv: { h264: "h264_qsv", h265: "hevc_qsv", mpeg2: "mpeg2_qsv" },
  amf: { h264: "h264_amf", h265: "hevc_amf", mpeg2: null },
  vaapi: { h264: "h264_vaapi", h265: "hevc_vaapi", mpeg2: "mpeg2_vaapi" },
  videotoolbox: { h264: "h264_videotoolbox", h265: "hevc_videotoolbox", mpeg2: null },
};

const hardwareLabels: Record<Exclude<VideoHardware, "off" | "auto">, string> = {
  nvenc: "NVIDIA NVENC",
  qsv: "Intel Quick Sync",
  amf: "AMD AMF",
  vaapi: "VAAPI",
  videotoolbox: "Apple VideoToolbox",
};

export function hardwareOptionsFor(
  capabilities: FfmpegCapabilities | null,
  codecLabel: string,
  fieldOrder: string,
): { value: VideoHardware; label: string }[] {
  const options: { value: VideoHardware; label: string }[] = [
    { value: "off", label: "Программное" },
  ];
  if (!capabilities) return options;
  const codec = videoCodecFromLabel(codecLabel);
  const available = new Set(capabilities.videoEncoders);
  for (const vendor of ["nvenc", "qsv", "amf", "vaapi", "videotoolbox"] as const) {
    const encoder = hardwareEncoderNames[vendor][codec];
    if (encoder && available.has(encoder) && (fieldOrder === "progressive" || vendor === "qsv")) {
      options.push({ value: vendor, label: hardwareLabels[vendor] });
    }
  }
  if (options.length > 1) options.splice(1, 0, { value: "auto", label: "Авто" });
  return options;
}

export function videoProfileOptions(codecLabel: string, hardware: VideoHardware): string[] {
  if (codecLabel === "H.265") {
    return hardware === "off" ? ["Main Profile", "Main 10"] : ["Main Profile"];
  }
  if (codecLabel === "MPEG-2 Video") return ["Main Profile"];
  return ["Main Profile", "High Profile"];
}

export function nearestVideoProfile(
  codecLabel: string,
  hardware: VideoHardware,
  profile: string,
): string {
  const options = videoProfileOptions(codecLabel, hardware);
  return options.includes(profile) ? profile : options[0]!;
}

export function softwareVideoCodecOptionsFor(
  protocol: string,
  capabilities: FfmpegCapabilities | null,
): string[] {
  const names: Record<VideoCodec, string> = { h264: "libx264", h265: "libx265", mpeg2: "mpeg2video" };
  const carried = outputCapabilitiesOf(protocol).videoCodecs;
  const available = capabilities
    ? carried.filter((codec) => capabilities.videoEncoders.includes(names[codec]))
    : carried;
  return (available.length ? available : carried.slice(0, 1)).map((codec) => videoCodecLabels[codec]);
}

export function presetFromSlider(value: number): StartPlayoutRequest["video"]["preset"] {
  if (value < 12) return "ultrafast";
  if (value < 24) return "veryfast";
  if (value < 40) return "fast";
  if (value < 58) return "medium";
  if (value < 76) return "slow";
  if (value < 90) return "slower";
  return "veryslow";
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
