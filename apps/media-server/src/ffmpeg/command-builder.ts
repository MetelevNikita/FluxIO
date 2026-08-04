import path from "node:path";
import type {
  PlayoutEndpoint,
  StartPlayoutRequest,
  VideoEncoding,
} from "@gruber/contracts";

export interface PreparedPlayoutItem {
  id: string;
  name: string;
  filePath: string;
  trimInSeconds: number;
  durationSeconds: number;
  hasAudio: boolean;
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
  args.push(
    "-metadata",
    "service_name=FluxIO",
    "-metadata",
    "service_provider=FluxIO",
  );
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

  items.forEach((item, index) => {
    const start = decimal(item.trimInSeconds);
    const duration = decimal(item.durationSeconds);
    filters.push(
      `[${index}:v:0]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS${deinterlace},` +
        `scale=${request.video.width}:${request.video.height}:force_original_aspect_ratio=decrease,` +
        `pad=${request.video.width}:${request.video.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
        `fps=${decimal(request.video.frameRate)},format=yuv420p[v${index}]`,
    );

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
    const logoInputIndex = items.length;
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
    "[vrealtime]split=2[vprogram][vpreviewbase]",
    "[arealtime]asplit=2[aprogram][apreview]",
    "[vpreviewbase]scale=960:-2:force_original_aspect_ratio=decrease,setsar=1[vpreview]",
  );

  return filters.join(";");
}

function videoEncoderArgs(video: VideoEncoding): string[] {
  const gop = Math.max(12, Math.round(video.frameRate * 2));
  const common = [
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(gop),
    "-keyint_min",
    String(gop),
    "-sc_threshold",
    "0",
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
      "-tune",
      "zerolatency",
      "-profile:v",
      profile,
      "-level:v",
      video.level,
    ];
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
      `keyint=${gop}:min-keyint=${gop}:scenecut=0:repeat-headers=1`,
    ];
  } else {
    codecArgs = ["-c:v", "mpeg2video"];
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
    });
    if (endpoint.localAddress) {
      params.set("localaddr", endpoint.localAddress);
    }
    const target = `udp://${formatHost(endpoint.host)}:${endpoint.port}?${params}`;
    return {
      outputArgs: mpegTsOutputArgs(target, transportMuxRateBps),
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
      outputArgs: mpegTsOutputArgs(target, transportMuxRateBps),
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

function mpegTsOutputArgs(target: string, transportMuxRateBps?: number): string[] {
  const args = [
    "-muxdelay",
    "0.7",
    "-muxpreload",
    "0.5",
    "-mpegts_service_id",
    "1",
    "-mpegts_transport_stream_id",
    "1",
    "-mpegts_original_network_id",
    "1",
    "-mpegts_flags",
    "+resend_headers",
  ];
  if (transportMuxRateBps) {
    args.push("-muxrate", String(transportMuxRateBps));
  }
  args.push("-f", "mpegts", target);
  return args;
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
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
