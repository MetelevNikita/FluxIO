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
    // Деблокинг на мониторе не виден, а при разборе программы в полном
    // разрешении это заметная доля процессора — того, что нужен выдаче.
    "-skip_loop_filter",
    "all",
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
    // Это монитор, а не второй выход: 640 точек, половина частоты кадров и
    // два потока кодировщика. Превью делит машину с эфиром, у процессов эфира
    // приоритет выше, и отстающий кодировщик превью замирает первым.
    "-vf",
    "fps=12.5,scale=640:-2:flags=fast_bilinear,setsar=1",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-threads",
    "2",
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
    "500k",
    "-maxrate",
    "600k",
    "-bufsize",
    "1200k",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "hls",
    // Сегмент в две секунды совпадает с GOP (25 кадров при 12,5 к/с): плееру
    // остаётся запас, и короткая заминка машины не опустошает его буфер.
    "-hls_time",
    "2",
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
