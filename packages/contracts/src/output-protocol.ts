/**
 * Что несёт контейнер каждого протокола выдачи.
 *
 * Матрица одна на интерфейс и на службу намеренно. Пока её не было, инженер
 * узнавал о невозможности из отказа на старте (DVB-субтитры и многоязычный звук
 * по RTMP) или не узнавал вовсе: планировщик SCTE-35 при RTMP спокойно
 * раскладывал метки, которые FLV не переносит, и снаружи это выглядело как
 * «метки не дошли до головной станции».
 *
 * Значения проверены муксерами, а не взяты из спецификаций: `mpeg2video` и
 * `mp2` муксер FLV отвергает при записи заголовка, `h265` и `ac3` принимает
 * (enhanced RTMP). Приёмная сторона может быть строже — это уже её дело, а не
 * ограничение FluxIO.
 */

export const videoCodecs = ["h264", "h265", "mpeg2"] as const;
export const audioCodecs = ["aac", "mp2", "ac3"] as const;

export type VideoCodec = (typeof videoCodecs)[number];
export type AudioCodec = (typeof audioCodecs)[number];

export const outputProtocols = ["udp", "srt", "rtmp"] as const;

export type OutputProtocol = (typeof outputProtocols)[number];

/** Возможность выдачи, которую интерфейс включает, гасит или запирает. */
export type OutputProtocolFeature =
  | "scte35"
  | "dvbSubtitles"
  | "multipleAudioTracks"
  | "mpegTsService"
  | "transportBitrate";

export interface OutputProtocolCapabilities {
  /** MPEG-TS: PID, PMT, PSI/SI и стаффинг до постоянной скорости. */
  readonly mpegTs: boolean;
  /** Отдельный PID с метками SCTE-35. */
  readonly scte35: boolean;
  /** Отдельный PID с растровыми субтитрами DVB. */
  readonly dvbSubtitles: boolean;
  /** Несколько звуковых дорожек в PMT; FLV несёт ровно одну. */
  readonly multipleAudioTracks: boolean;
  /** Настройки службы MPEG-TS: имя, номер, PID, интервал PCR. */
  readonly mpegTsService: boolean;
  /** Постоянная транспортная скорость всего мультиплекса. */
  readonly transportBitrate: boolean;
  readonly videoCodecs: readonly VideoCodec[];
  readonly audioCodecs: readonly AudioCodec[];
}

const mpegTsTransport: OutputProtocolCapabilities = {
  mpegTs: true,
  scte35: true,
  dvbSubtitles: true,
  multipleAudioTracks: true,
  mpegTsService: true,
  transportBitrate: true,
  videoCodecs: videoCodecs,
  audioCodecs: audioCodecs,
};

const flvTransport: OutputProtocolCapabilities = {
  mpegTs: false,
  scte35: false,
  dvbSubtitles: false,
  multipleAudioTracks: false,
  mpegTsService: false,
  transportBitrate: false,
  // Муксер FLV принимает и HEVC, и AC-3 (enhanced RTMP) — проверено записью
  // заголовка. Приёмные площадки такой поток отвергают на подключении, и
  // выяснялось бы это уже в эфире, поэтому RTMP держится классической пары.
  // MPEG-2 и MP2 муксер отвергает сам.
  videoCodecs: ["h264"],
  audioCodecs: ["aac"],
};

export function outputProtocolCapabilities(
  protocol: OutputProtocol,
): OutputProtocolCapabilities {
  return protocol === "rtmp" ? flvTransport : mpegTsTransport;
}

/** Возможности, которые протокол не несёт. Пустой список — ограничений нет. */
export function unsupportedOutputFeatures(
  protocol: OutputProtocol,
): OutputProtocolFeature[] {
  const capabilities = outputProtocolCapabilities(protocol);
  const features: OutputProtocolFeature[] = [
    "scte35",
    "dvbSubtitles",
    "multipleAudioTracks",
    "mpegTsService",
    "transportBitrate",
  ];
  return features.filter((feature) => !capabilities[feature]);
}

export function supportsVideoCodec(protocol: OutputProtocol, codec: VideoCodec): boolean {
  return outputProtocolCapabilities(protocol).videoCodecs.includes(codec);
}

export function supportsAudioCodec(protocol: OutputProtocol, codec: AudioCodec): boolean {
  return outputProtocolCapabilities(protocol).audioCodecs.includes(codec);
}

/**
 * Ближайший поддерживаемый кодек. Выбор запирается на нём, а не отвергается:
 * инженер сменил протокол выдачи, а не отказался от эфира.
 */
export function nearestVideoCodec(protocol: OutputProtocol, codec: VideoCodec): VideoCodec {
  if (supportsVideoCodec(protocol, codec)) return codec;
  return outputProtocolCapabilities(protocol).videoCodecs[0] ?? "h264";
}

export function nearestAudioCodec(protocol: OutputProtocol, codec: AudioCodec): AudioCodec {
  if (supportsAudioCodec(protocol, codec)) return codec;
  return outputProtocolCapabilities(protocol).audioCodecs[0] ?? "aac";
}
