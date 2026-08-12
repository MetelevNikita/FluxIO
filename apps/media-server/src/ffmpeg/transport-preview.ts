import path from "node:path";

export interface TransportPreviewCommandOptions {
  inputPort: number;
  previewDirectory: string;
}

export const transportPreviewPlaylistName = "transport-index.m3u8";

export function buildTransportPreviewCommand({
  inputPort,
  previewDirectory,
}: TransportPreviewCommandOptions): string[] {
  const playlistPath = path.join(previewDirectory, transportPreviewPlaylistName);
  const segmentPath = path.join(previewDirectory, "transport-segment-%010d.ts");
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel",
    "warning",
    "-fflags",
    "+nobuffer+discardcorrupt",
    "-flags",
    "low_delay",
    "-analyzeduration",
    "1000000",
    "-probesize",
    "1000000",
    "-i",
    `udp://127.0.0.1:${inputPort}?fifo_size=1000000&overrun_nonfatal=1`,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    "scale=960:-2:force_original_aspect_ratio=decrease,setsar=1",
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
    "25",
    "-keyint_min",
    "25",
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
    segmentPath,
    playlistPath,
  ];
}
