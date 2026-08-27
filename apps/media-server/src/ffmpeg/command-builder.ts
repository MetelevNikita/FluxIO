import path from "node:path";
import type {
  AgeTitleOverlay,
  AudioTrack,
  ClipAudioOverlay,
  GraphicEffectLayer,
  ItemLogoOverlay,
  ProgramAudioTrack,
  SubtitleOverlay,
  MpegTsOutputSettings,
  PlayoutEndpoint,
  StartPlayoutRequest,
  VideoEncoding,
} from "@gruber/contracts";
import { defaultMpegTsOutputSettings, isBarsSource } from "@gruber/contracts";
import {
  ffmpegMpegTsMuxDelaySeconds,
  ffmpegMpegTsMuxPreloadSeconds,
  ffmpegMpegTsOutputOffsetSeconds,
} from "../transport-clock.js";
import {
  hardwareEncoderArgs,
  softwareEncoder,
  type ResolvedVideoEncoder,
} from "./hardware-encoder.js";

/**
 * Показ сцены, врезанный в ролик.
 *
 * Полотно фиксировано на весь показ: наложение принимает одно смещение на вход,
 * двигать его покадрово нечем. Кадры приходят сырым RGBA из отдельного
 * процесса — так же, как звук приходит сырым PCM.
 */
export interface PreparedSceneShow {
  /** Куда положить полотно и какого оно размера. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** С какой секунды ролика показывать. */
  startSeconds: number;
  frameCount: number;
  /** Описание показа для графического процесса — передаётся ему в stdin. */
  request: string;
}

export interface PreparedPlayoutItem {
  id: string;
  name: string;
  filePath: string;
  trimInSeconds: number;
  durationSeconds: number;
  hasAudio: boolean;
  ageTitle?: AgeTitleOverlay;
  itemLogo?: ItemLogoOverlay;
  effects?: GraphicEffectLayer[];
  audioOverlays?: ClipAudioOverlay[];
  subtitles?: SubtitleOverlay;
  audioTracks?: AudioTrack[];
  /** Сцены второго уровня; пусто — ничего не меняется в конвейере. */
  scenes?: PreparedSceneShow[];
  /**
   * UNIX-время первого кадра ролика в эфире. Заполняет supervisor в момент
   * запуска рендерера; нужно экранным часам, чтобы предзапущенный рендерер
   * рисовал эфирное, а не своё системное время.
   */
  airEpochSeconds?: number;
}

/** Источник звука для одного элементарного потока конкретного ролика. */
export interface ClipAudioSource {
  filePath: string | null;
  hasAudio: boolean;
  languageCode: string;
  label: string;
}

/**
 * Дорожки программы в порядке элементарных потоков. Пустой массив — многоязычный
 * звук выключен, работает прежняя одиночная дорожка без языковых дескрипторов.
 */
export function programAudioTracks(request: StartPlayoutRequest): ProgramAudioTrack[] {
  if (!request.audioProgram?.enabled) return [];
  return request.audioProgram.tracks;
}

/**
 * Что подать в рендерер дорожки `track` для ролика `item`: файл нужного языка,
 * сам ролик для оригинала или тишину, если перевода нет.
 */
export function clipAudioSource(
  item: PreparedPlayoutItem,
  track: ProgramAudioTrack,
): ClipAudioSource {
  const matched = item.audioTracks?.find((candidate) => candidate.languageCode === track.languageCode);
  if (matched) {
    return {
      filePath: matched.filePath,
      hasAudio: true,
      languageCode: track.languageCode,
      label: matched.label,
    };
  }

  if (track.original) {
    return {
      filePath: item.hasAudio ? item.filePath : null,
      hasAudio: item.hasAudio,
      languageCode: track.languageCode,
      label: track.label,
    };
  }

  // Перевода для этого ролика нет: PID остаётся в PMT и отдаёт тишину.
  return { filePath: null, hasAudio: false, languageCode: track.languageCode, label: track.label };
}

export interface FfmpegCommand {
  args: string[];
  endpointLabel: string;
  filterGraph: string;
  inputSourcesEmbedded: boolean;
  totalDurationSeconds: number;
}


export interface FfmpegCommandOptions {
  /**
   * Кодировщик, выбранный до сборки команды. Сборщик команд ничего не знает
   * про наличие ускорителя на машине — это выясняет preflight и передаёт
   * готовый ответ сюда.
   */
  videoEncoder?: ResolvedVideoEncoder;
  embedInputSourcesInFilterGraph?: boolean;
  filterComplexScriptPath?: string;
  forceKeyFramesSeconds?: number[];
  programEndpoint?: PlayoutEndpoint;
  transportMuxRateBps?: number;
}

/**
 * Номер файлового дескриптора, с которого начинаются трубы сцен.
 *
 * 0, 1 и 2 заняты стандартными потоками, поэтому первая сцена приходит на 3.
 */
export const firstSceneFileDescriptor = 3;

export function buildFfmpegClipVideoProducerCommand(
  request: StartPlayoutRequest,
  item: PreparedPlayoutItem,
  previewDirectory: string,
): FfmpegCommand {
  const base = buildFfmpegCommand(request, [item], previewDirectory);
  const firstMap = base.args.indexOf("-map");
  const args = base.args.slice(0, firstMap);
  const progressIndex = args.indexOf("-progress");
  if (progressIndex >= 0) args.splice(progressIndex, 2);

  // Сцены дописываются последними входами, чтобы не сдвинуть номера уже
  // посчитанных: логотип, возраст и FX-слои ссылаются на свои по порядку.
  const scenes = item.scenes ?? [];
  const sceneInputs: string[] = [];
  let inputIndex = args.reduce((count, value) => (value === "-i" ? count + 1 : count), 0);
  const sceneLabels: { label: string; scene: PreparedSceneShow }[] = [];
  for (const [order, scene] of scenes.entries()) {
    sceneInputs.push(
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", `${scene.width}x${scene.height}`,
      "-r", decimal(request.video.frameRate),
      "-i", `pipe:${firstSceneFileDescriptor + order}`,
    );
    sceneLabels.push({ label: `${inputIndex}:v:0`, scene });
    inputIndex += 1;
  }

  let filterGraph = `${buildFilterGraph(request, [item], false, false, false)};` +
    "[aprogram]anullsink";
  let source = "vprogram";
  for (const [order, entry] of sceneLabels.entries()) {
    const painted = `vscene${order}`;
    const shifted = `vscenein${order}`;
    // Показ начинается не с начала ролика: сдвигаем метки времени входа, иначе
    // сцена отыграет свой вход в первую секунду и застынет.
    filterGraph += `;[${entry.label}]format=yuva420p,` +
      `setpts=PTS-STARTPTS+${decimal(entry.scene.startSeconds)}/TB[${shifted}]`;
    filterGraph += `;[${source}][${shifted}]overlay=${Math.round(entry.scene.x)}:` +
      `${Math.round(entry.scene.y)}:eof_action=pass:format=auto[${painted}]`;
    source = painted;
  }
  if (sceneLabels.length > 0) filterGraph += `;[${source}]format=yuv420p[vout]`;

  const filterIndex = args.indexOf("-filter_complex");
  if (filterIndex >= 0) {
    args.splice(filterIndex, 0, ...sceneInputs);
    args[args.indexOf("-filter_complex") + 1] = filterGraph;
  }
  args.push(
    "-map", sceneLabels.length > 0 ? "[vout]" : "[vprogram]",
    "-pix_fmt", "yuv420p",
    "-f", "rawvideo",
    "pipe:1",
  );
  return { ...base, args, filterGraph };
}

/**
 * Сколько сэмплов обязан отдать рендерер дорожки за ролик. Все дорожки программы
 * считают одно и то же число: encoder мультиплексирует их в один поток, и дорожка
 * короче остальных останавливает выдачу целиком.
 */
export function clipAudioSampleCount(durationSeconds: number, sampleRate: number): number {
  return Math.max(1, Math.round(durationSeconds * sampleRate));
}

/** Размер той же порции звука в байтах сырого s16le. */
export function clipAudioByteCount(
  durationSeconds: number,
  sampleRate: number,
  channels: number,
): number {
  return clipAudioSampleCount(durationSeconds, sampleRate) * channels * 2;
}

export function buildFfmpegClipAudioProducerCommand(
  request: StartPlayoutRequest,
  item: PreparedPlayoutItem,
  source?: ClipAudioSource,
): FfmpegCommand {
  const sampleRate = request.audio.sampleRate;
  const channelLayout = request.audio.channels === 1
    ? "mono"
    : request.audio.channels === 6
      ? "5.1"
      : "stereo";
  const start = decimal(item.trimInSeconds);
  const duration = decimal(item.durationSeconds);
  // Без явного источника дорожка берётся из самого ролика — прежнее поведение.
  const inputPath = source ? source.filePath : (item.hasAudio ? item.filePath : null);
  const hasAudio = source ? source.hasAudio && Boolean(source.filePath) : item.hasAudio;
  const sourceFilter = hasAudio
    ? `[0:a:0]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,` +
      `aresample=${sampleRate}:async=1:first_pts=0,` +
      `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:` +
      `channel_layouts=${channelLayout}`
    : `anullsrc=r=${sampleRate}:cl=${channelLayout},atrim=duration=${duration},` +
      "asetpts=PTS-STARTPTS";
  const loudness = request.audio.loudnessNormalization;
  const loudnessFilter = loudness.enabled
    ? `,loudnorm=I=${decimal(loudness.targetLufs)}:` +
      `TP=${decimal(loudness.truePeakDbtp)}:` +
      `LRA=${decimal(loudness.loudnessRangeLufs)}:` +
      `dual_mono=${request.audio.channels === 1 ? "true" : "false"},` +
      `aresample=${sampleRate},asetpts=PTS-STARTPTS`
    : "";
  // Хвост, который делает длину дорожки ровно равной длине ролика. Файл перевода
  // короче видео (или короче после loudnorm) иначе просто обрывает подачу в
  // encoder: тот ждёт отставший вход и эфир встаёт. `apad` дотягивает тишиной,
  // `atrim=end_sample` срезает длинный файл по сэмплу — одинаково для всех дорожек.
  const sampleCount = clipAudioSampleCount(item.durationSeconds, sampleRate);
  const lengthFilter = `,apad=whole_len=${sampleCount},atrim=end_sample=${sampleCount},` +
    "asetpts=PTS-STARTPTS";
  // Звуковые вставки (сейчас — стингер) подмешиваются ПОСЛЕ loudnorm и строго ДО
  // хвоста: loudnorm не должен трогать авторский уровень перехода, а число
  // сэмплов дорожки обязано остаться прежним. `normalize=0` не даёт amix
  // приглушить основную дорожку, `duration=first` — удлинить её.
  const overlays = (item.audioOverlays ?? []).filter(
    (overlay) => overlay.durationSeconds > 0 && overlay.startSeconds < item.durationSeconds,
  );
  const baseInputCount = hasAudio && inputPath ? 1 : 0;
  const overlayFilters = overlays.map((overlay, overlayIndex) => {
    const duration = Math.min(overlay.durationSeconds, item.durationSeconds - overlay.startSeconds);
    const delayMs = Math.round(overlay.startSeconds * 1_000);
    return `[${baseInputCount + overlayIndex}:a:0]` +
      `atrim=start=${decimal(overlay.sourceInSeconds)}:duration=${decimal(duration)},` +
      "asetpts=PTS-STARTPTS," +
      `aresample=${sampleRate}:async=1:first_pts=0,` +
      `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${channelLayout},` +
      `volume=${decimal(overlay.gainDb)}dB` +
      (delayMs > 0 ? `,adelay=${delayMs}:all=1` : "") +
      `[afx${overlayIndex}]`;
  });
  const mixFilter = overlays.length > 0
    ? `[abase]${overlays.map((_, mixIndex) => `[afx${mixIndex}]`).join("")}` +
      `amix=inputs=${overlays.length + 1}:duration=first:normalize=0,` +
      `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${channelLayout}`
    : "";
  const filterGraph = overlays.length > 0
    ? [
        `${sourceFilter}${loudnessFilter}[abase]`,
        ...overlayFilters,
        `${mixFilter}${lengthFilter}[aprogram]`,
      ].join(";")
    : `${sourceFilter}${loudnessFilter}${lengthFilter}[aprogram]`;
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel", "warning",
    ...(hasAudio && inputPath ? ["-i", inputPath] : []),
    ...overlays.flatMap((overlay) => ["-i", overlay.filePath]),
    "-filter_complex", filterGraph,
    "-map", "[aprogram]",
    "-c:a", "pcm_s16le",
    "-ar", String(sampleRate),
    "-ac", String(request.audio.channels),
    "-f", "s16le",
    "pipe:1",
  ];
  return {
    args,
    endpointLabel: "local PCM",
    filterGraph,
    inputSourcesEmbedded: false,
    totalDurationSeconds: item.durationSeconds,
  };
}

export function buildFfmpegProgramEncoderCommand(
  request: StartPlayoutRequest,
  templateItem: PreparedPlayoutItem,
  previewDirectory: string,
  totalDurationSeconds: number,
  options: FfmpegCommandOptions = {},
): FfmpegCommand {
  const base = buildFfmpegCommand(request, [templateItem], previewDirectory, options);
  const firstMap = base.args.indexOf("-map");
  const previewMap = base.args.findIndex(
    (value, index) => value === "-map" && base.args[index + 1] === "[vpreview]",
  );
  const finalTransportPreview = request.endpoint.protocol === "udp" ||
    request.endpoint.protocol === "srt";
  const programAudio =
    `asetpts=PTS-STARTPTS,aresample=${request.audio.sampleRate}:async=1:first_pts=0,` +
    "arealtime";
  // Каждая дорожка приходит отдельным raw PCM pipe: pipe:3, pipe:4, ... Первая
  // сохраняет метку [aprogram], чтобы одноязычный эфир собирался ровно как раньше.
  const audioPipeCount = Math.max(1, programAudioTracks(request).length);
  const audioFilters = Array.from({ length: audioPipeCount }, (_, index) =>
    `[${index + 1}:a]${programAudio}[${audioLabel(index)}]`);
  const filterGraph = finalTransportPreview
    ? [
        `[0:v]setpts=PTS-STARTPTS,realtime,` +
          `setfield=mode=${filterFieldOrder(request.video.fieldOrder)}[vprogram]`,
        ...audioFilters,
      ].join(";")
    : [
        `[0:v]setpts=PTS-STARTPTS,realtime,split=2[vprogrambase][vpreviewbase]`,
        `[vprogrambase]setfield=mode=${filterFieldOrder(request.video.fieldOrder)}[vprogram]`,
        `[1:a]${programAudio},asplit=2[aprogram][apreview]`,
        `[vpreviewbase]scale=960:-2:force_original_aspect_ratio=decrease,setsar=1[vpreview]`,
      ].join(";");
  const outputArgs = finalTransportPreview && previewMap > firstMap
    ? base.args.slice(firstMap, previewMap)
    : base.args.slice(firstMap);
  const audioInputs = Array.from({ length: audioPipeCount }, (_, index) => [
    "-thread_queue_size", "512",
    "-f", "s16le",
    "-ar", String(request.audio.sampleRate),
    "-ac", String(request.audio.channels),
    "-i", `pipe:${index + 3}`,
  ]).flat();
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel", "warning",
    "-nostats",
    "-progress", "pipe:1",
    "-thread_queue_size", "512",
    "-f", "rawvideo",
    "-pixel_format", "yuv420p",
    "-video_size", `${request.video.width}x${request.video.height}`,
    "-framerate", decimal(request.video.frameRate),
    "-i", "pipe:0",
    ...audioInputs,
    "-filter_complex", filterGraph,
    ...outputArgs,
  ];
  return { ...base, args, filterGraph, totalDurationSeconds };
}

/** Ширина, в которой считается предпросмотр ролика. */
export const compositePreviewWidth = 960;

/**
 * Кадр предпросмотра меньше эфирного.
 *
 * Вся графика ставится по процентам кадра — FX-слои растягиваются на кадр,
 * `drawtext` считает кегль и координаты от его высоты, — поэтому в уменьшенном
 * кадре картинка та же, а фильтров вчетверо меньше. Раньше весь монтаж
 * считался в эфирном разрешении (на UHD — вчетверо тяжелее), и только потом
 * ужимался до 960 ради плеера: оператор видел это как «плей грузит процессор».
 */
function previewSizedRequest(request: StartPlayoutRequest): StartPlayoutRequest {
  const width = Math.min(request.video.width, compositePreviewWidth);
  if (width >= request.video.width) return request;
  const height = Math.max(
    2,
    Math.round((request.video.height * width) / request.video.width / 2) * 2,
  );
  return { ...request, video: { ...request.video, width, height } };
}

/** Значение аргумента FFmpeg, если он вообще есть в команде. */
function replaceArgument(args: string[], name: string, value: string): void {
  const index = args.indexOf(name);
  if (index >= 0) args[index + 1] = value;
}

export function buildFfmpegCompositePreviewCommand(
  request: StartPlayoutRequest,
  item: PreparedPlayoutItem,
  previewDirectory: string,
): FfmpegCommand {
  // Предпросмотр кодируется параллельно эфиру. Ускоритель у машины обычно один,
  // и предпросмотр, взяв его, отбирал бы ресурс у эфира — поэтому здесь всегда
  // программный кодировщик, независимо от настроек.
  const base = buildFfmpegCommand(previewSizedRequest(request), [item], previewDirectory, {
    videoEncoder: softwareEncoder(request.video.codec),
  });
  const firstMap = base.args.indexOf("-map");
  const previewMap = base.args.findIndex(
    (value, index) => value === "-map" && base.args[index + 1] === "[vpreview]",
  );
  if (firstMap < 0 || previewMap < 0) throw new Error("FFmpeg preview outputs are unavailable");
  const args = [...base.args.slice(0, firstMap), ...base.args.slice(previewMap)];
  const filterGraph = `${base.filterGraph};[vprogram]nullsink;[aprogram]anullsink`;
  const filterIndex = args.indexOf("-filter_complex");
  if (filterIndex >= 0) args[filterIndex + 1] = filterGraph;
  replaceArgument(args, "-hls_start_number_source", "generic");
  replaceArgument(args, "-hls_segment_filename", path.join(previewDirectory, "segment-%06d.ts"));
  // Эфирный предпросмотр — «живое окно»: старые сегменты удаляются, и назад
  // мотать физически нечего. Предпросмотр ролика, наоборот, копится целиком,
  // поэтому плеер перематывает по уже посчитанному куску без перезапуска
  // FFmpeg. `event` — та же растущая плейлиста, только объявленная явно.
  replaceArgument(args, "-hls_list_size", "0");
  replaceArgument(args, "-hls_flags", "independent_segments+append_list+temp_file");
  const deleteThreshold = args.indexOf("-hls_delete_threshold");
  if (deleteThreshold >= 0) args.splice(deleteThreshold, 2);
  args.splice(args.length - 1, 0, "-hls_playlist_type", "event");
  return {
    ...base,
    args,
    filterGraph,
  };
}

/**
 * Вход одного ролика.
 *
 * У заглушки файла нет — цветные полосы рисует сам FFmpeg, поэтому вместо
 * `-i путь` подставляется генератор `smptehdbars`. Размер и частота кадров
 * берутся из настроек эфира: заглушка обязана попасть в ту же сетку, что и
 * обычные ролики, иначе program encoder получит поток другого формата.
 */
export function clipInputArgs(item: PreparedPlayoutItem, video: VideoEncoding): string[] {
  if (!isBarsSource(item.filePath)) return ["-i", item.filePath];
  return [
    "-f",
    "lavfi",
    "-i",
    `smptehdbars=size=${video.width}x${video.height}:rate=${decimal(video.frameRate)}`,
  ];
}

export function buildFfmpegCommand(
  request: StartPlayoutRequest,
  items: PreparedPlayoutItem[],
  previewDirectory: string,
  options: FfmpegCommandOptions = {},
): FfmpegCommand {
  if (items.length === 0) {
    throw new Error("Playlist is empty");
  }
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel",
    "warning",
    "-nostats",
    "-progress",
    "pipe:1",
  ];

  const inputSourcesEmbedded = options.embedInputSourcesInFilterGraph === true;
  if (!inputSourcesEmbedded) {
    for (const item of items) {
      args.push(...clipInputArgs(item, request.video));
    }
    for (const item of items) {
      if (item.ageTitle?.enabled && item.ageTitle.filePath) {
        args.push(
          "-loop",
          "1",
          "-framerate",
          decimal(request.video.frameRate),
          "-i",
          item.ageTitle.filePath,
        );
      }
      if (item.itemLogo?.enabled) {
        args.push(...logoInputArgs(item.itemLogo, request.video.frameRate));
      }
      for (const effect of item.effects ?? []) {
        for (const source of graphicEffectSources(effect)) {
          if (source.sequence) {
            // Частоты кадров в .png нет — её задаёт оператор, иначе FFmpeg
            // возьмёт своё умолчание и переход поедет по длительности.
            args.push("-framerate", decimal(effect.sequenceFrameRate ?? request.video.frameRate));
            if (effect.sequenceStartNumber != null) {
              args.push("-start_number", String(effect.sequenceStartNumber));
            }
            args.push("-i", source.filePath);
            continue;
          }
          if (source.kind === "static") {
            args.push(
              "-loop",
              "1",
              "-framerate",
              decimal(request.video.frameRate),
              "-i",
              source.filePath,
            );
          } else {
            args.push("-i", source.filePath);
          }
        }
      }
    }
    if (request.logo) {
      args.push(...logoInputArgs(request.logo, request.video.frameRate));
    }
  }

  // VAAPI кодирует кадры в памяти ускорителя, поэтому перед кодировщиком их
  // надо туда загрузить. Ступень дописывается **в тот же граф**: второй
  // `-filter_complex` в команде FFmpeg не принимает — он молча заменяет первый.
  const uploadsToHardware = options.videoEncoder?.needsHardwareUpload === true;
  const videoLabel = uploadsToHardware ? "[vhw]" : "[vprogram]";
  const filterGraph = buildFilterGraph(request, items, inputSourcesEmbedded) +
    (uploadsToHardware ? ";[vprogram]format=nv12,hwupload[vhw]" : "");
  if (uploadsToHardware) {
    args.push("-vaapi_device", request.video.vaapiDevice);
  }
  if (options.filterComplexScriptPath) {
    args.push("-filter_complex_script", options.filterComplexScriptPath);
  } else {
    args.push("-filter_complex", filterGraph);
  }

  const audioTracks = programAudioTracks(request);
  args.push("-map", videoLabel, "-map", "[aprogram]");
  for (let index = 1; index < audioTracks.length; index += 1) {
    args.push("-map", `[${audioLabel(index)}]`);
  }
  audioTracks.forEach((track, index) => {
    args.push(`-metadata:s:a:${index}`, `language=${track.languageCode}`);
    args.push(`-metadata:s:a:${index}`, `title=${track.label}`);
  });
  args.push(...videoEncoderArgs(request.video, options.videoEncoder));
  if (options.forceKeyFramesSeconds?.length) {
    args.push(
      "-force_key_frames",
      options.forceKeyFramesSeconds.map(decimal).join(","),
    );
  }
  args.push(...audioEncoderArgs(request.audio.codec, request.audio.bitrateKbps));
  args.push("-ar", String(request.audio.sampleRate), "-ac", String(request.audio.channels));
  const endpoint = buildEndpoint(
    options.programEndpoint ?? request.endpoint,
    options.transportMuxRateBps,
    audioTracks,
  );
  args.push(...endpoint.outputArgs);

  const previewPlaylistPath = path.join(previewDirectory, "index.m3u8");
  const previewSegmentPath = path.join(previewDirectory, "segment-%010d.ts");
  const previewGop = Math.max(12, Math.round(request.video.frameRate));
  args.push(
    "-map",
    "[vpreview]",
    "-map",
    "[apreview]",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-profile:v",
    "main",
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(previewGop),
    "-keyint_min",
    String(previewGop),
    "-sc_threshold",
    "0",
    "-b:v",
    "1400k",
    "-maxrate",
    "1600k",
    "-bufsize",
    "2800k",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "hls",
    "-hls_time",
    "1",
    "-hls_list_size",
    "6",
    "-hls_delete_threshold",
    "3",
    "-hls_start_number_source",
    "epoch",
    "-hls_flags",
    "delete_segments+omit_endlist+independent_segments+program_date_time+temp_file",
    "-hls_segment_filename",
    previewSegmentPath,
    previewPlaylistPath,
  );

  return {
    args,
    endpointLabel: buildEndpoint(request.endpoint).label,
    filterGraph,
    inputSourcesEmbedded,
    totalDurationSeconds: items.reduce(
      (total, item) => total + item.durationSeconds,
      0,
    ),
  };
}

function buildFilterGraph(
  request: StartPlayoutRequest,
  items: PreparedPlayoutItem[],
  inputSourcesEmbedded: boolean,
  includePreview = true,
  includeLoudnessNormalization = true,
): string {
  const filters: string[] = [];
  const sampleRate = request.audio.sampleRate;
  const channelLayout = request.audio.channels === 1
    ? "mono"
    : request.audio.channels === 6
      ? "5.1"
      : "stereo";
  const deinterlace = request.video.deinterlace ? ",yadif=0:-1:0" : "";
  let nextOverlayInput = items.length;

  items.forEach((item, index) => {
    const videoInput = inputSourcesEmbedded ? `inputv${index}` : `${index}:v:0`;
    const audioInput = inputSourcesEmbedded ? `inputa${index}` : `${index}:a:0`;
    if (inputSourcesEmbedded) {
      const streams = item.hasAudio ? "v+a" : "v";
      filters.push(
        `movie=filename='${escapeFilterPath(item.filePath)}':streams=${streams}` +
          `[${videoInput}]${item.hasAudio ? `[${audioInput}]` : ""}`,
      );
    }
    const start = decimal(item.trimInSeconds);
    const duration = decimal(item.durationSeconds);
    const burnSubtitles = request.subtitleOutput.mode === "burn-in" &&
      item.subtitles?.enabled && Boolean(item.subtitles.filePath);
    const requiresItemOverlay = Boolean(
      item.ageTitle?.enabled ||
      item.itemLogo?.enabled ||
      (item.effects?.length ?? 0) > 0 ||
      burnSubtitles,
    );
    const normalizedLabel = requiresItemOverlay ? `vbase${index}` : `v${index}`;
    const subtitleFilter = burnSubtitles && item.subtitles?.filePath
      ? `subtitles=filename='${escapeFilterPath(item.subtitles.filePath)}',`
      : "";
    filters.push(
      `[${videoInput}]${subtitleFilter}trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS${deinterlace},` +
        `scale=${request.video.width}:${request.video.height}:force_original_aspect_ratio=decrease,` +
        `pad=${request.video.width}:${request.video.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
        `fps=${decimal(request.video.frameRate)},format=yuv420p[${normalizedLabel}]`,
    );

    let itemVideoSource = normalizedLabel;
    if (item.ageTitle?.enabled) {
      const ageLabel = item.itemLogo?.enabled || (item.effects?.length ?? 0) > 0
        ? `vage${index}`
        : `v${index}`;
      const displayDuration = Math.min(item.durationSeconds, item.ageTitle.durationSeconds);
      if (item.ageTitle.filePath) {
        const ageInput = inputSourcesEmbedded
          ? addMovieVideoSource(
              filters,
              item.ageTitle.filePath,
              `ageinput${index}`,
              item.durationSeconds,
            )
          : `${nextOverlayInput++}:v:0`;
        filters.push(
          `[${ageInput}]format=rgba,` +
            `scale=${request.video.width}:${request.video.height}:flags=lanczos[ageasset${index}]`,
          `[${itemVideoSource}][ageasset${index}]overlay=x=0:y=0:` +
            `shortest=1:eof_action=pass:format=auto:` +
            `enable='between(t,0,${decimal(displayDuration)})',format=yuv420p[${ageLabel}]`,
        );
      } else {
        filters.push(
          `[${itemVideoSource}]drawtext=text='${escapeDrawtext(item.ageTitle.text)}':` +
            "x=48:y=48:fontsize=h*0.065:fontcolor=white:" +
            "box=1:boxcolor=black@0.68:boxborderw=18:" +
            `enable='between(t,0,${decimal(displayDuration)})'[${ageLabel}]`,
        );
      }
      itemVideoSource = ageLabel;
    }
    if (item.itemLogo?.enabled) {
      const logoInput = inputSourcesEmbedded
        ? addMovieVideoSource(
            filters,
            item.itemLogo.filePath,
            `itemlogoinput${index}`,
            item.durationSeconds,
            item.itemLogo.loop && logoSourceKind(item.itemLogo.filePath) !== "image",
          )
        : `${nextOverlayInput++}:v:0`;
      const logoWidth = Math.max(
        2,
        Math.round(request.video.width * (item.itemLogo.widthPercent / 100)),
      );
      const [x, y] = logoPosition(item.itemLogo.position, item.itemLogo.margin);
      const logoOutputLabel = (item.effects?.length ?? 0) > 0
        ? `vlogo${index}`
        : `v${index}`;
      filters.push(
        `[${logoInput}]` +
          `${logoFilterChain(item.itemLogo, logoWidth, request.video.frameRate)}` +
          `[itemlogo${index}]`,
        `[${itemVideoSource}][itemlogo${index}]overlay=x=${x}:y=${y}:` +
          `shortest=1:eof_action=pass:format=auto,format=yuv420p[${logoOutputLabel}]`,
      );
      itemVideoSource = logoOutputLabel;
    }
    const effects = item.effects ?? [];
    effects.forEach((effect, effectIndex) => {
      const effectStart = Math.min(item.durationSeconds - 0.04, Math.max(0, effect.startSeconds));
      const effectEnd = Math.min(item.durationSeconds, Math.max(effectStart + 0.04, effect.endSeconds));
      const effectDuration = Math.max(0.04, effectEnd - effectStart);
      const sources = graphicEffectSources(effect);
      sources.forEach((source, sourceIndex) => {
        const effectInput = inputSourcesEmbedded
          ? addMovieVideoSource(
              filters,
              source.filePath,
              `fxinput${index}_${effectIndex}_${sourceIndex}`,
              source.kind === "static" ? effectDuration : null,
            )
          : `${nextOverlayInput++}:v:0`;
        const effectLabel = `fxasset${index}_${effectIndex}_${sourceIndex}`;
        const isLastSource = sourceIndex === sources.length - 1;
        const outputLabel = effectIndex === effects.length - 1 && isLastSource
          ? `v${index}`
          : `vfx${index}_${effectIndex}_${sourceIndex}`;
        // Стингер берёт вторую половину перехода из середины файла, поэтому
        // `sourceInSeconds` может быть больше нуля; остаток файла ограничивает
        // длину, которую вообще имеет смысл запрашивать.
        const sourceIn = Math.max(0, effect.sourceInSeconds);
        const remainingSource = effect.sourceDurationSeconds > 0
          ? Math.max(0.04, effect.sourceDurationSeconds - sourceIn)
          : effectDuration;
        const sourceDuration = source.role === "background"
          ? Math.min(effectDuration, remainingSource)
          : effectDuration;
        const sourceTrim = source.kind === "video"
          ? `trim=start=${decimal(sourceIn)}:duration=${decimal(sourceDuration)},`
          : `trim=duration=${decimal(effectDuration)},`;
        // Переход без альфа-канала: чёрный фон вырезается по яркости уже после
        // перевода в rgba, иначе прозрачности просто негде появиться.
        const keyFilter = effect.blendMode === "luma"
          ? `,lumakey=threshold=${decimal(effect.lumaThreshold)}:tolerance=0.05:softness=0.02`
          : "";
        // Слой рисуется во весь кадр, поэтому «подвинуть плашку» — это сдвинуть
        // сам слой: в готовом файле положение задано внутри него, и
        // в After Effects руками его не поправишь.
        const offsetX = Math.round((request.video.width * effect.offsetXPercent) / 100);
        const offsetY = Math.round((request.video.height * effect.offsetYPercent) / 100);
        filters.push(
          `[${effectInput}]${sourceTrim}setpts=PTS-STARTPTS+${decimal(effectStart)}/TB,` +
            `format=rgba${keyFilter},scale=${request.video.width}:${request.video.height}:` +
            `force_original_aspect_ratio=decrease:flags=lanczos,` +
            `pad=${request.video.width}:${request.video.height}:(ow-iw)/2:(oh-ih)/2:color=black@0[${effectLabel}]`,
          `[${itemVideoSource}][${effectLabel}]overlay=x=${offsetX}:y=${offsetY}:` +
            `eof_action=pass:format=auto:` +
            `enable='between(t,${decimal(effectStart)},${decimal(effectEnd)})',format=yuv420p[${outputLabel}]`,
        );
        itemVideoSource = outputLabel;
      });
    });
    if (itemVideoSource !== `v${index}`) {
      filters.push(`[${itemVideoSource}]null[v${index}]`);
    }

    if (item.hasAudio) {
      filters.push(
        `[${audioInput}]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,` +
          `aresample=${sampleRate}:async=1:first_pts=0,` +
          `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${channelLayout}[a${index}]`,
      );
    } else {
      filters.push(
        `anullsrc=r=${sampleRate}:cl=${channelLayout},atrim=duration=${duration},` +
          `asetpts=PTS-STARTPTS[a${index}]`,
      );
    }
  });

  const concatInputs = items.map((_, index) => `[v${index}][a${index}]`).join("");
  filters.push(`${concatInputs}concat=n=${items.length}:v=1:a=1[vconcat][aconcat]`);
  let audioSource = "aconcat";
  if (includeLoudnessNormalization && request.audio.loudnessNormalization.enabled) {
    const loudness = request.audio.loudnessNormalization;
    filters.push(
      `[aconcat]loudnorm=I=${decimal(loudness.targetLufs)}:` +
        `TP=${decimal(loudness.truePeakDbtp)}:` +
        `LRA=${decimal(loudness.loudnessRangeLufs)}:` +
        `dual_mono=${request.audio.channels === 1 ? "true" : "false"}[anormalized]`,
    );
    audioSource = "anormalized";
  }
  let videoSource = "vconcat";
  if (request.logo) {
    const logoInput = inputSourcesEmbedded
      ? addMovieVideoSource(
          filters,
          request.logo.filePath,
          "globallogoinput",
          items.reduce((total, item) => total + item.durationSeconds, 0),
          request.logo.loop && logoSourceKind(request.logo.filePath) !== "image",
        )
      : `${nextOverlayInput}:v:0`;
    const logoWidth = Math.max(
      2,
      Math.round(request.video.width * (request.logo.widthPercent / 100)),
    );
    const [x, y] = logoPosition(request.logo.position, request.logo.margin);
    filters.push(
      `[${logoInput}]${logoFilterChain(request.logo, logoWidth, request.video.frameRate)}[logo]`,
      `[vconcat][logo]overlay=x=${x}:y=${y}:shortest=1:format=auto[vbranded]`,
    );
    videoSource = "vbranded";
  }
  if (includePreview) {
    filters.push(
      `[${videoSource}]realtime[vrealtime]`,
      `[${audioSource}]arealtime[arealtime]`,
      "[vrealtime]split=2[vprogrambase][vpreviewbase]",
      `[vprogrambase]setfield=mode=${filterFieldOrder(request.video.fieldOrder)}[vprogram]`,
      "[arealtime]asplit=2[aprogram][apreview]",
      "[vpreviewbase]scale=960:-2:force_original_aspect_ratio=decrease,setsar=1[vpreview]",
    );
  } else {
    filters.push(
      `[${videoSource}]setfield=mode=${filterFieldOrder(request.video.fieldOrder)}[vprogram]`,
      `[${audioSource}]anull[aprogram]`,
    );
  }

  return filters.join(";");
}

/* -------------------------------------------------------------------------- *
 * Логотип канала: картинка или анимация
 * -------------------------------------------------------------------------- */

const logoImageExtensions = new Set([".png", ".webp", ".jpg", ".jpeg"]);
const animatedLogoExtensions = new Set([".mov", ".mp4", ".m4v", ".webm", ".mkv", ".avi", ".mxf"]);

/** Форматы, которые FFmpeg получает напрямую. */
export function isSupportedLogoPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return logoImageExtensions.has(extension) || extension === ".gif" || animatedLogoExtensions.has(extension);
}

export type LogoSourceKind = "image" | "gif" | "video";

export function logoSourceKind(filePath: string): LogoSourceKind {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".gif") return "gif";
  return animatedLogoExtensions.has(extension) ? "video" : "image";
}

/**
 * Аргументы входа под логотип.
 *
 * Неподвижная картинка разворачивается в бесконечный поток одним кадром
 * (`-loop 1`), у анимации повторять надо сам файл: gif умеет это своим
 * внутренним циклом, остальные форматы — `-stream_loop`. Без повтора вход
 * кончается вместе с анимацией, и дальше логотип держит `tpad` в графе.
 */
export function logoInputArgs(
  logo: { filePath: string; loop: boolean },
  frameRate: number,
): string[] {
  const kind = logoSourceKind(logo.filePath);
  if (kind === "image") {
    return ["-loop", "1", "-framerate", decimal(frameRate), "-i", logo.filePath];
  }
  if (!logo.loop) return ["-i", logo.filePath];
  return kind === "gif"
    ? ["-ignore_loop", "0", "-i", logo.filePath]
    : ["-stream_loop", "-1", "-i", logo.filePath];
}

/**
 * Цепочка фильтров логотипа.
 *
 * `overlay` собран с `shortest=1`, поэтому вход логотипа обязан быть длиннее
 * ролика: иначе закончившаяся анимация обрежет сам эфир. Однократный показ
 * держится последним кадром (`tpad`), зацикленный повторяется входом.
 */
export function logoFilterChain(
  logo: { filePath: string; loop: boolean; opacity: number },
  widthPixels: number,
  frameRate: number,
): string {
  const animated = logoSourceKind(logo.filePath) !== "image";
  return [
    ...(animated ? [`fps=${decimal(frameRate)}`] : []),
    "format=rgba",
    `colorchannelmixer=aa=${decimal(logo.opacity)}`,
    `scale=${widthPixels}:-1`,
    ...(animated && !logo.loop ? ["tpad=stop=-1:stop_mode=clone"] : []),
  ].join(",");
}

function addMovieVideoSource(
  filters: string[],
  filePath: string,
  label: string,
  repeatDurationSeconds: number | null,
  /** Бесконечный повтор самого файла — для зацикленной анимации. */
  loop = false,
): string {
  const sourceLabel = repeatDurationSeconds === null ? label : `${label}raw`;
  filters.push(
    `movie=filename='${escapeFilterPath(filePath)}':streams=v${loop ? ":loop=0" : ""}` +
      `[${sourceLabel}]`,
  );
  if (repeatDurationSeconds !== null) {
    filters.push(
      `[${sourceLabel}]tpad=stop_mode=clone:stop_duration=${decimal(repeatDurationSeconds)},` +
        `trim=duration=${decimal(repeatDurationSeconds)},setpts=PTS-STARTPTS[${label}]`,
    );
  }
  return label;
}

function escapeDrawtext(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'")
    .replaceAll("%", "\\%");
}

function escapeFilterPath(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'")
    .replaceAll(",", "\\,")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function videoEncoderArgs(video: VideoEncoding, chosen?: ResolvedVideoEncoder): string[] {
  const gop = video.gopSize;
  // Ускоритель выбирается заранее: сборщик команд не умеет спрашивать FFmpeg,
  // что есть на машине, и не должен уметь. Без переданного выбора собираем
  // программный — это единственный вариант, который заведомо есть везде.
  const encoder = chosen ?? softwareEncoder(video.codec);
  const sceneChangeThreshold = video.codec === "mpeg2" && video.closedGop
    ? "1000000000"
    : "0";
  const common = [
    "-pix_fmt",
    "yuv420p",
    "-field_order",
    ffmpegFieldOrder(video.fieldOrder),
    "-g",
    String(gop),
    "-keyint_min",
    String(gop),
    "-sc_threshold",
    sceneChangeThreshold,
    "-bf",
    String(video.bFrames),
  ];
  let codecArgs: string[];

  if (encoder.vendor !== "off") {
    // У ускорителей своё управление скоростью и свои пресеты: параметры x264
    // они не понимают, а `-sc_threshold` из общего набора игнорируют.
    return [
      ...hardwareEncoderArgs(video, encoder),
      "-g", String(gop),
      "-keyint_min", String(gop),
      "-bf", String(video.bFrames),
    ];
  }

  if (video.codec === "h264") {
    const profile = ["baseline", "main", "high"].includes(video.profile.toLowerCase())
      ? video.profile.toLowerCase()
      : "high";
    codecArgs = [
      "-c:v",
      "libx264",
      "-preset",
      video.preset,
      "-profile:v",
      profile,
      "-level:v",
      video.level,
    ];
    if (video.bFrames === 0) {
      codecArgs.splice(4, 0, "-tune", "zerolatency");
    }
    const x264Params: string[] = [
      `keyint=${gop}`,
      `min-keyint=${gop}`,
      "scenecut=0",
      `open-gop=${video.closedGop ? 0 : 1}`,
      `bframes=${video.bFrames}`,
      "b-adapt=0",
      "b-pyramid=none",
    ];
    if (video.fieldOrder !== "progressive") {
      x264Params.push(`${video.fieldOrder === "upper" ? "tff" : "bff"}=1`);
    }
    if (video.rateControl === "cbr") {
      x264Params.push(
        `vbv-maxrate=${video.targetBitrateKbps}`,
        `vbv-bufsize=${video.bufferSizeKbps}`,
        "nal-hrd=cbr",
        "filler=1",
        "force-cfr=1",
      );
    }
    if (x264Params.length > 0) {
      codecArgs.push("-x264-params", x264Params.join(":"));
    }
  } else if (video.codec === "h265") {
    const profile = video.profile.toLowerCase().includes("10") ? "main10" : "main";
    codecArgs = [
      "-c:v",
      "libx265",
      "-preset",
      video.preset,
      "-profile:v",
      profile,
      "-level:v",
      video.level,
      "-x265-params",
      `keyint=${gop}:min-keyint=${gop}:scenecut=0:repeat-headers=1` +
        `:open-gop=${video.closedGop ? 0 : 1}:bframes=${video.bFrames}:b-adapt=0:b-pyramid=0` +
        (video.fieldOrder === "progressive"
          ? ""
          : `:interlace=${video.fieldOrder === "upper" ? "tff" : "bff"}`) +
        (video.rateControl === "cbr"
          ? `:vbv-maxrate=${video.targetBitrateKbps}:vbv-bufsize=${video.bufferSizeKbps}` +
            ":strict-cbr=1:hrd=1:filler=1"
          : ""),
    ];
  } else {
    codecArgs = ["-c:v", "mpeg2video"];
    const mpeg2Flags = video.closedGop ? ["cgop"] : [];
    if (video.fieldOrder !== "progressive") {
      mpeg2Flags.push("ilme", "ildct");
      codecArgs.push("-top:v", video.fieldOrder === "upper" ? "1" : "0");
    }
    if (mpeg2Flags.length > 0) {
      codecArgs.push("-flags:v", `+${mpeg2Flags.join("+")}`);
    }
  }

  const rateArgs = rateControlArgs(video);
  return [...codecArgs, ...common, ...rateArgs];
}

function rateControlArgs(video: VideoEncoding): string[] {
  if (video.rateControl === "crf" && video.codec !== "mpeg2") {
    return ["-crf", String(video.crf)];
  }
  if (video.rateControl === "crf") {
    const quantizer = Math.max(2, Math.min(31, Math.round(video.crf / 1.7)));
    return ["-q:v", String(quantizer)];
  }
  const target = `${video.targetBitrateKbps}k`;
  const maximum = `${
    video.rateControl === "cbr"
      ? video.targetBitrateKbps
      : video.maxBitrateKbps
  }k`;
  const args = [
    "-b:v",
    target,
    "-maxrate",
    maximum,
    "-bufsize",
    `${video.bufferSizeKbps}k`,
  ];
  if (video.rateControl === "cbr") {
    args.push("-minrate", target);
  }
  return args;
}

function audioEncoderArgs(codec: "aac" | "mp2" | "ac3", bitrateKbps: number) {
  return ["-c:a", codec, "-b:a", `${bitrateKbps}k`];
}

/** Первая дорожка сохраняет историческую метку [aprogram]; далее [aprogram1], [aprogram2]… */
export function audioLabel(index: number): string {
  return index === 0 ? "aprogram" : `aprogram${index}`;
}

function buildEndpoint(
  endpoint: PlayoutEndpoint,
  transportMuxRateBps?: number,
  audioTracks: ProgramAudioTrack[] = [],
): {
  outputArgs: string[];
  label: string;
} {
  if (endpoint.protocol === "udp") {
    const params = new URLSearchParams({
      pkt_size: String(endpoint.packetSize),
      ttl: String(endpoint.ttl),
      buffer_size: String(4 * 1_024 * 1_024),
    });
    if (endpoint.localAddress) {
      params.set("localaddr", endpoint.localAddress);
    }
    // Keep the FFmpeg UDP hop unpaced. On macOS, FFmpeg 9 can exhaust its
    // paced UDP queue and fail with ENOMEM after a few seconds. MPEG-TS still
    // gets its fixed muxrate below; final real-time pacing and packet bursts
    // are enforced by TSDuck's regulate processor and IP output plugin.
    const target = `udp://${formatHost(endpoint.host)}:${endpoint.port}?${params}`;
    return {
      outputArgs: mpegTsOutputArgs(target, endpoint.mpegTs, transportMuxRateBps, audioTracks),
      label: `UDP ${endpoint.host}:${endpoint.port}`,
    };
  }

  if (endpoint.protocol === "srt") {
    const params = new URLSearchParams({
      mode: endpoint.mode,
      latency: String(endpoint.latencyMs * 1_000),
      transtype: "live",
    });
    if (endpoint.passphrase) {
      params.set("passphrase", endpoint.passphrase);
      params.set("pbkeylen", "16");
    }
    if (endpoint.streamId) {
      params.set("streamid", endpoint.streamId);
    }
    const target = `srt://${formatHost(endpoint.host)}:${endpoint.port}?${params}`;
    return {
      outputArgs: mpegTsOutputArgs(
        target,
        defaultMpegTsOutputSettings,
        transportMuxRateBps,
        audioTracks,
      ),
      label: `SRT ${endpoint.mode} ${endpoint.host}:${endpoint.port}`,
    };
  }

  const server = endpoint.serverUrl.replace(/\/+$/, "");
  const key = endpoint.streamKey.replace(/^\/+/, "");
  return {
    outputArgs: ["-flvflags", "no_duration_filesize", "-f", "flv", `${server}/${key}`],
    label: `RTMP ${server}/***`,
  };
}

function mpegTsOutputArgs(
  target: string,
  settings: MpegTsOutputSettings,
  transportMuxRateBps?: number,
  audioTracks: ProgramAudioTrack[] = [],
): string[] {
  // Каждая дорожка получает собственный PID: головная станция отбирает их по
  // отдельности. Без многоязычного звука раскладка прежняя — video/audio.
  const audioStreamIds = audioTracks.length > 0
    ? audioTracks.flatMap((track, index) => ["-streamid", `${index + 1}:${track.pid}`])
    : ["-streamid", `1:${settings.audioPid}`];
  const args = [
    "-metadata",
    `service_name=${settings.serviceName}`,
    "-metadata",
    `service_provider=${settings.providerName}`,
    "-streamid",
    `0:${settings.videoPid}`,
    ...audioStreamIds,
    "-output_ts_offset",
    decimal(ffmpegMpegTsOutputOffsetSeconds),
    "-muxdelay",
    decimal(ffmpegMpegTsMuxDelaySeconds),
    "-muxpreload",
    decimal(ffmpegMpegTsMuxPreloadSeconds),
    "-mpegts_service_id",
    String(settings.serviceId),
    "-mpegts_service_type",
    settings.serviceType,
    "-mpegts_transport_stream_id",
    "1",
    "-mpegts_original_network_id",
    "1",
    "-mpegts_flags",
    "+resend_headers",
    "-pcr_period",
    String(settings.pcrPeriodMs),
  ];
  if (transportMuxRateBps) {
    args.push("-muxrate", String(transportMuxRateBps));
  }
  args.push("-f", "mpegts", target);
  return args;
}

function filterFieldOrder(fieldOrder: VideoEncoding["fieldOrder"]): string {
  if (fieldOrder === "upper") return "tff";
  if (fieldOrder === "lower") return "bff";
  return "prog";
}

function ffmpegFieldOrder(fieldOrder: VideoEncoding["fieldOrder"]): string {
  if (fieldOrder === "upper") return "tt";
  if (fieldOrder === "lower") return "bb";
  return "progressive";
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

interface GraphicEffectSource {
  filePath: string;
  kind: "static" | "video";
  role: "background" | "title";
  /**
   * Источник собран из пронумерованных кадров: `filePath` — printf-шаблон.
   * Для фильтров это обычное видео (у него есть таймлайн, и `sourceInSeconds`
   * обязан работать), отличается только сборка входа.
   */
  sequence: boolean;
}

function graphicEffectSources(effect: GraphicEffectLayer): GraphicEffectSource[] {
  const backgroundPath = effect.backgroundPath ?? effect.filePath;
  const isSequence = effect.sequenceFrameRate != null;
  const sources: GraphicEffectSource[] = [{
    filePath: backgroundPath,
    // Шаблон заканчивается на .png, но статичной картинкой не является:
    // без этой поправки к нему приклеился бы `-loop 1`, а вторая половина
    // перехода взяла бы те же кадры, что и первая.
    kind: isSequence ? "video" : graphicSourceKind(backgroundPath),
    role: "background",
    sequence: isSequence,
  }];
  if (effect.titlePath && effect.titlePath !== backgroundPath) {
    sources.push({
      filePath: effect.titlePath,
      kind: graphicSourceKind(effect.titlePath),
      role: "title",
      sequence: false,
    });
  }
  return sources;
}

function graphicSourceKind(filePath: string): "static" | "video" {
  return new Set([".png", ".webp"]).has(path.extname(filePath).toLowerCase())
    ? "static"
    : "video";
}

function logoPosition(
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center",
  margin: number,
): [string, string] {
  if (position === "top-left") return [String(margin), String(margin)];
  if (position === "top-right") {
    return [`main_w-overlay_w-${margin}`, String(margin)];
  }
  if (position === "bottom-left") {
    return [String(margin), `main_h-overlay_h-${margin}`];
  }
  if (position === "center") {
    return ["(main_w-overlay_w)/2", "(main_h-overlay_h)/2"];
  }
  return [`main_w-overlay_w-${margin}`, `main_h-overlay_h-${margin}`];
}

function decimal(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}
