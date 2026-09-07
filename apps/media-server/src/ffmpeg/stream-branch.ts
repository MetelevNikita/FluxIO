import {
  endpointMpegTsSettings,
  outputProtocolCapabilities,
  type AudioEncoding,
  type PlayoutEndpoint,
  type PlayoutStream,
  type StartPlayoutRequest,
  type VideoEncoding,
} from "@gruber/contracts";
import {
  audioEncoderArgs,
  formatHost,
  videoEncoderArgs,
} from "./command-builder.js";
import type { ResolvedVideoEncoder } from "./hardware-encoder.js";

/**
 * Выход программы как отдельная ветка эфирной цепочки.
 *
 * Программа в FluxIO одна: одно расписание, одна графика, один кодировщик,
 * один мультиплекс. Выходы ответвляются от готового мультиплекса, а не
 * пересобирают его каждый со своей стороны, и это решение о цене: расписание,
 * декодирование ролика и отрисовка титров стоят одинаково при одном выходе и
 * при трёх, а платить за них трижды пришлось бы, разведи мы выходы по
 * отдельным сессиям.
 *
 * Ветка берёт мультиплекс с локального зеркала (`-P ip` у транспортной стадии
 * программы). Зеркало отдаётся по UDP на петлю намеренно: труба в памяти
 * связала бы выходы между собой, и подвисший RTMP на площадке останавливал бы
 * основной эфир на головную станцию — приёмник, который не читает, тормозит
 * трубу, а UDP просто теряет пакеты у себя.
 *
 * Отсюда же три режима и их разная цена:
 * - `program` — единственный выход, транспортная стадия программы и есть его
 *   выход. Ровно то, чем FluxIO был до нескольких выходов;
 * - `relay` — готовый мультиплекс отдаётся на другой адрес. Доли процента ядра;
 * - `transcode` — своя ступень кодирования: ещё один кодировщик на машине.
 */

export type StreamBranchMode = "program" | "relay" | "transcode";

export interface StreamBranchPlan {
  stream: PlayoutStream;
  mode: StreamBranchMode;
  /** Локальный порт, с которого ветка читает мультиплекс программы. */
  mirrorPort: number;
  /** Порт между транскодером и транспортной стадией ветки; null — её нет. */
  handoffPort: number | null;
  /** Команда FFmpeg ветки. Пусто у `relay`. */
  encoderArgs: string[];
  /** Команда tsp ветки. Пусто у ветки, отдающей FLV напрямую. */
  transportArgs: string[];
  endpointLabel: string;
}

/**
 * Нужна ли ветке своя ступень кодирования.
 *
 * Профиль, заданный оператором, — это всегда перекодирование, даже если он
 * совпал с программным: совпадение сегодня не обещает совпадения завтра.
 * Без профиля перекодирование появляется только там, где контейнер не несёт
 * кодек программы: FLV не примет ни HEVC, ни MPEG-2, и оставить такую ветку
 * копией значит выпустить в эфир поток, который площадка отвергнет на
 * подключении.
 */
export function streamBranchMode(
  stream: PlayoutStream,
  program: Pick<StartPlayoutRequest, "video" | "audio">,
  onlyStream: boolean,
): StreamBranchMode {
  // Единственный выход перекодировать не из чего: настройки кодирования
  // программы и есть его профиль. Отдельная ступень здесь была бы вторым
  // кодированием того же материала — потерей качества за деньги оператора.
  if (onlyStream) return "program";
  if (stream.transcode) return "transcode";
  return carriesProgramCodecs(stream.endpoint, program) ? "relay" : "transcode";
}

export function carriesProgramCodecs(
  endpoint: PlayoutEndpoint,
  program: Pick<StartPlayoutRequest, "video" | "audio">,
): boolean {
  const capabilities = outputProtocolCapabilities(endpoint.protocol);
  return capabilities.videoCodecs.includes(program.video.codec) &&
    capabilities.audioCodecs.includes(program.audio.codec);
}

/**
 * Профиль перекодирования ветки.
 *
 * Ветка без своего профиля, которой перекодирование всё же нужно, получает
 * профиль программы с подменённым кодеком: раскладка, частота кадров и
 * скорость остаются станционными, меняется ровно то, чего контейнер не несёт.
 * Отказать здесь в старте значило бы уронить выход из-за настройки, которую
 * оператор не выбирал.
 */
export function resolveBranchProfile(
  stream: PlayoutStream,
  program: Pick<StartPlayoutRequest, "video" | "audio">,
): { video: VideoEncoding; audio: AudioEncoding } {
  if (stream.transcode) {
    return {
      ...stream.transcode,
      // Ускоритель принадлежит программе. Дополнительные ветки пока всегда
      // программные, иначе три auto-профиля спорили бы за одно устройство.
      video: { ...stream.transcode.video, hardware: "off" },
    };
  }
  const capabilities = outputProtocolCapabilities(stream.endpoint.protocol);
  return {
    video: {
      ...program.video,
      codec: capabilities.videoCodecs[0] ?? "h264",
      // Ускоритель у машины один, и он занят программой. Ветка кодирует
      // программно: отобрав ускоритель, она отобрала бы его у эфира.
      hardware: "off",
    },
    audio: { ...program.audio, codec: capabilities.audioCodecs[0] ?? "aac" },
  };
}

export interface StreamTranscoderOptions {
  mirrorPort: number;
  /** Куда отдать результат: FLV прямо в сеть или MPEG-TS транспортной стадии. */
  handoffPort: number | null;
  profile: { video: VideoEncoding; audio: AudioEncoding };
  program: Pick<StartPlayoutRequest, "video" | "audio">;
  stream: PlayoutStream;
  videoEncoder?: ResolvedVideoEncoder;
}

/**
 * FFmpeg ветки: читает мультиплекс программы и кодирует под свой выход.
 *
 * Вход берётся с запасом по очереди: зеркало идёт по UDP, и ветка, отставшая
 * на переключении ролика, обязана догнать, а не рассыпать поток. Чересстрочный
 * мультиплекс перед прогрессивным выходом разбирается `yadif` — площадки
 * поля не принимают, и без этого «работает, но рвётся» выяснялось бы у
 * зрителя.
 */
export function buildStreamTranscoderCommand(options: StreamTranscoderOptions): string[] {
  const { handoffPort, mirrorPort, profile, program, stream } = options;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostats",
    "-fflags",
    "+genpts",
    "-thread_queue_size",
    "4096",
    "-i",
    `udp://127.0.0.1:${mirrorPort}?fifo_size=1000000&overrun_nonfatal=1&buffer_size=4194304`,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
  ];

  const filters = transcoderFilters(profile.video, program.video);
  if (filters.length > 0) args.push("-vf", filters.join(","));

  args.push(...videoEncoderArgs(profile.video, options.videoEncoder));
  args.push(...audioEncoderArgs(profile.audio.codec, profile.audio.bitrateKbps));
  args.push("-ar", String(profile.audio.sampleRate), "-ac", String(profile.audio.channels));
  args.push(...branchOutputArgs(stream.endpoint, handoffPort));
  return args;
}

/**
 * Ветка без перекодирования, которой всё же нужен FFmpeg: FLV из готового
 * мультиплекса программы собирается перекладыванием пакетов, без кодирования.
 */
export function buildStreamRemuxCommand(
  stream: PlayoutStream,
  mirrorPort: number,
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostats",
    "-fflags",
    "+genpts",
    "-thread_queue_size",
    "4096",
    "-i",
    `udp://127.0.0.1:${mirrorPort}?fifo_size=1000000&overrun_nonfatal=1&buffer_size=4194304`,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-c",
    "copy",
    ...branchOutputArgs(stream.endpoint, null),
  ];
}

/** Меняет параметры MPEG-TS без потери качества: пакеты копируются, не кодируются. */
export function buildStreamMpegTsRemuxCommand(
  stream: PlayoutStream,
  mirrorPort: number,
  handoffPort: number,
): string[] {
  return [
    "-hide_banner", "-loglevel", "error", "-nostats", "-fflags", "+genpts",
    "-thread_queue_size", "4096",
    "-i", `udp://127.0.0.1:${mirrorPort}?fifo_size=1000000&overrun_nonfatal=1&buffer_size=4194304`,
    "-map", "0", "-c", "copy",
    ...branchOutputArgs(stream.endpoint, handoffPort),
  ];
}

function branchOutputArgs(endpoint: PlayoutEndpoint, handoffPort: number | null): string[] {
  if (endpoint.protocol === "rtmp") {
    const server = endpoint.serverUrl.replace(/\/+$/, "");
    const key = endpoint.streamKey.replace(/^\/+/, "");
    return ["-flvflags", "no_duration_filesize", "-f", "flv", `${server}/${key}`];
  }
  if (handoffPort == null) {
    throw new Error("An MPEG-TS branch needs a transport stage port");
  }
  const mpegTs = endpointMpegTsSettings(endpoint);
  return [
    "-streamid",
    `0:${mpegTs.videoPid}`,
    "-streamid",
    `1:${mpegTs.audioPid}`,
    "-mpegts_service_id",
    String(mpegTs.serviceId),
    "-mpegts_service_type",
    mpegTs.serviceType,
    "-metadata",
    `service_name=${mpegTs.serviceName}`,
    "-metadata",
    `service_provider=${mpegTs.providerName}`,
    "-pcr_period",
    String(mpegTs.pcrPeriodMs),
    "-f",
    "mpegts",
    `udp://127.0.0.1:${handoffPort}?pkt_size=1316&ttl=1&buffer_size=4194304`,
  ];
}

function transcoderFilters(target: VideoEncoding, program: VideoEncoding): string[] {
  const filters: string[] = [];
  const programInterlaced = program.fieldOrder !== "progressive";
  if (programInterlaced && target.fieldOrder === "progressive") {
    filters.push("yadif=mode=0");
  }
  if (target.width !== program.width || target.height !== program.height) {
    filters.push(`scale=${target.width}:${target.height}:flags=bicubic`);
  }
  if (Math.abs(target.frameRate - program.frameRate) > 0.001) {
    filters.push(`fps=${target.frameRate}`);
  }
  return filters;
}

/** Метка выхода для журнала и интерфейса. Ключ потока в неё не попадает. */
export function streamEndpointLabel(endpoint: PlayoutEndpoint): string {
  if (endpoint.protocol === "udp") {
    return `UDP ${formatHost(endpoint.host)}:${endpoint.port}`;
  }
  if (endpoint.protocol === "srt") {
    return `SRT ${endpoint.mode} ${formatHost(endpoint.host)}:${endpoint.port}`;
  }
  return `RTMP ${endpoint.serverUrl.replace(/\/+$/, "")}/***`;
}
