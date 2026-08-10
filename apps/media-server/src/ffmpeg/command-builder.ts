import path from "node:path";
import type {
  AgeTitleOverlay,
  GraphicEffectLayer,
  ItemLogoOverlay,
  SubtitleOverlay,
  MpegTsOutputSettings,
  PlayoutEndpoint,
  StartPlayoutRequest,
  VideoEncoding,
} from "@gruber/contracts";
import { defaultMpegTsOutputSettings } from "@gruber/contracts";

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
  subtitles?: SubtitleOverlay;
}

export interface FfmpegCommand {
  args: string[];
  endpointLabel: string;
  totalDurationSeconds: number;
}

export interface FfmpegCommandOptions {
  forceKeyFramesSeconds?: number[];
  programEndpoint?: PlayoutEndpoint;
  transportMuxRateBps?: number;
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

  for (const item of items) {
    args.push("-i", item.filePath);
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
      args.push(
        "-loop",
        "1",
        "-framerate",
        decimal(request.video.frameRate),
        "-i",
        item.itemLogo.filePath,
      );
    }
    for (const effect of item.effects ?? []) {
      for (const source of graphicEffectSources(effect)) {
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
    args.push(
      "-loop",
      "1",
      "-framerate",
      decimal(request.video.frameRate),
      "-i",
      request.logo.filePath,
    );
  }

  const filterGraph = buildFilterGraph(request, items);
  args.push("-filter_complex", filterGraph);

  args.push("-map", "[vprogram]", "-map", "[aprogram]");
  args.push(...videoEncoderArgs(request.video));
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
  );
  args.push(...endpoint.outputArgs);

  const previewPlaylistPath = path.join(previewDirectory, "index.m3u8");
  const previewSegmentPath = path.join(previewDirectory, "segment-%06d.ts");
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
    "-hls_flags",
    "delete_segments+append_list+omit_endlist+independent_segments+program_date_time",
    "-hls_segment_filename",
    previewSegmentPath,
    previewPlaylistPath,
  );

  return {
    args,
    endpointLabel: buildEndpoint(request.endpoint).label,
    totalDurationSeconds: items.reduce(
      (total, item) => total + item.durationSeconds,
      0,
    ),
  };
}

function buildFilterGraph(
  request: StartPlayoutRequest,
  items: PreparedPlayoutItem[],
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
    const start = decimal(item.trimInSeconds);
    const duration = decimal(item.durationSeconds);
    const requiresItemOverlay = Boolean(
      item.ageTitle?.enabled ||
      item.itemLogo?.enabled ||
      (item.effects?.length ?? 0) > 0 ||
      item.subtitles?.enabled,
    );
    const normalizedLabel = requiresItemOverlay ? `vbase${index}` : `v${index}`;
    const subtitleFilter = item.subtitles?.enabled && item.subtitles.filePath
      ? `subtitles=filename='${escapeFilterPath(item.subtitles.filePath)}',`
      : "";
    filters.push(
      `[${index}:v:0]${subtitleFilter}trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS${deinterlace},` +
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
        const ageInputIndex = nextOverlayInput;
        nextOverlayInput += 1;
        filters.push(
          `[${ageInputIndex}:v:0]format=rgba,` +
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
      const logoInputIndex = nextOverlayInput;
      nextOverlayInput += 1;
      const logoWidth = Math.max(
        2,
        Math.round(request.video.width * (item.itemLogo.widthPercent / 100)),
      );
      const [x, y] = logoPosition(item.itemLogo.position, item.itemLogo.margin);
      const logoOutputLabel = (item.effects?.length ?? 0) > 0
        ? `vlogo${index}`
        : `v${index}`;
      filters.push(
        `[${logoInputIndex}:v:0]format=rgba,` +
          `colorchannelmixer=aa=${decimal(item.itemLogo.opacity)},scale=${logoWidth}:-1[itemlogo${index}]`,
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
        const effectInputIndex = nextOverlayInput;
        nextOverlayInput += 1;
        const effectLabel = `fxasset${index}_${effectIndex}_${sourceIndex}`;
        const isLastSource = sourceIndex === sources.length - 1;
        const outputLabel = effectIndex === effects.length - 1 && isLastSource
          ? `v${index}`
          : `vfx${index}_${effectIndex}_${sourceIndex}`;
        const sourceDuration = source.role === "background"
          ? Math.min(effectDuration, effect.sourceDurationSeconds || effectDuration)
          : effectDuration;
        const sourceTrim = source.kind === "video"
          ? `trim=start=0:duration=${decimal(sourceDuration)},`
          : `trim=duration=${decimal(effectDuration)},`;
        filters.push(
          `[${effectInputIndex}:v:0]${sourceTrim}setpts=PTS-STARTPTS+${decimal(effectStart)}/TB,` +
            `format=rgba,scale=${request.video.width}:${request.video.height}:` +
            `force_original_aspect_ratio=decrease:flags=lanczos,` +
            `pad=${request.video.width}:${request.video.height}:(ow-iw)/2:(oh-ih)/2:color=black@0[${effectLabel}]`,
          `[${itemVideoSource}][${effectLabel}]overlay=x=0:y=0:eof_action=pass:format=auto:` +
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
        `[${index}:a:0]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,` +
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
  let videoSource = "vconcat";
  if (request.logo) {
    const logoInputIndex = nextOverlayInput;
    const logoWidth = Math.max(
      2,
      Math.round(request.video.width * (request.logo.widthPercent / 100)),
    );
    const [x, y] = logoPosition(request.logo.position, request.logo.margin);
    filters.push(
      `[${logoInputIndex}:v:0]format=rgba,colorchannelmixer=aa=${decimal(request.logo.opacity)},` +
        `scale=${logoWidth}:-1[logo]`,
      `[vconcat][logo]overlay=x=${x}:y=${y}:shortest=1:format=auto[vbranded]`,
    );
    videoSource = "vbranded";
  }
  filters.push(
    `[${videoSource}]realtime[vrealtime]`,
    "[aconcat]arealtime[arealtime]",
    "[vrealtime]split=2[vprogrambase][vpreviewbase]",
    `[vprogrambase]setfield=mode=${filterFieldOrder(request.video.fieldOrder)}[vprogram]`,
    "[arealtime]asplit=2[aprogram][apreview]",
    "[vpreviewbase]scale=960:-2:force_original_aspect_ratio=decrease,setsar=1[vpreview]",
  );

  return filters.join(";");
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

function videoEncoderArgs(video: VideoEncoding): string[] {
  const gop = video.gopSize;
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

function buildEndpoint(endpoint: PlayoutEndpoint, transportMuxRateBps?: number): {
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
    if (transportMuxRateBps) {
      params.set("bitrate", String(transportMuxRateBps));
      params.set("burst_bits", String(endpoint.packetSize * 8));
    }
    const target = `udp://${formatHost(endpoint.host)}:${endpoint.port}?${params}`;
    return {
      outputArgs: mpegTsOutputArgs(target, endpoint.mpegTs, transportMuxRateBps),
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
): string[] {
  const args = [
    "-metadata",
    `service_name=${settings.serviceName}`,
    "-metadata",
    `service_provider=${settings.providerName}`,
    "-streamid",
    `0:${settings.videoPid}`,
    "-streamid",
    `1:${settings.audioPid}`,
    "-muxdelay",
    "0.7",
    "-muxpreload",
    "0.5",
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

function graphicEffectSources(effect: GraphicEffectLayer): Array<{
  filePath: string;
  kind: "static" | "video";
  role: "background" | "title";
}> {
  const backgroundPath = effect.backgroundPath ?? effect.filePath;
  const sources: Array<{
    filePath: string;
    kind: "static" | "video";
    role: "background" | "title";
  }> = [{
    filePath: backgroundPath,
    kind: graphicSourceKind(backgroundPath),
    role: "background",
  }];
  if (effect.titlePath && effect.titlePath !== backgroundPath) {
    sources.push({
      filePath: effect.titlePath,
      kind: graphicSourceKind(effect.titlePath),
      role: "title",
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
