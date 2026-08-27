import type { VideoEncoding, VideoHardware } from "@gruber/contracts";

/* -------------------------------------------------------------------------- *
 * Выбор кодировщика.
 *
 * Аппаратное кодирование здесь не оптимизация: на 2160 программный `libx264`
 * не укладывается в реальное время, и без ускорителя UHD-профиль недостижим.
 *
 * Всё в этом файле — чистые функции: ускорителя на машине разработчика может
 * не быть вовсе, и проверять выбор аргументов надо тестом, а не запуском.
 * ------------------------------------------------------------------------- */

/** Что в итоге поедет в `-c:v` и по каким правилам собирать остальное. */
export interface ResolvedVideoEncoder {
  /** Имя кодировщика для FFmpeg. */
  name: string;
  /** Кто его исполняет: от этого зависит весь набор параметров. */
  vendor: VideoHardware;
  /** VAAPI требует загрузки кадров в память ускорителя перед кодированием. */
  needsHardwareUpload: boolean;
}

/** Имена кодировщиков по вендору и кодеку. `null` — вендор такой кодек не умеет. */
const encoderNames: Record<Exclude<VideoHardware, "off" | "auto">, Record<string, string | null>> = {
  nvenc: { h264: "h264_nvenc", h265: "hevc_nvenc", mpeg2: null },
  qsv: { h264: "h264_qsv", h265: "hevc_qsv", mpeg2: "mpeg2_qsv" },
  vaapi: { h264: "h264_vaapi", h265: "hevc_vaapi", mpeg2: "mpeg2_vaapi" },
  videotoolbox: { h264: "h264_videotoolbox", h265: "hevc_videotoolbox", mpeg2: null },
  amf: { h264: "h264_amf", h265: "hevc_amf", mpeg2: null },
};

const softwareNames: Record<string, string> = {
  h264: "libx264",
  h265: "libx265",
  mpeg2: "mpeg2video",
};

/**
 * Порядок перебора при `auto`.
 *
 * NVENC первым намеренно: на вещательных машинах он встречается чаще всего и
 * единственный из списка даёт предсказуемый CBR своими средствами.
 */
const autoOrder: Exclude<VideoHardware, "off" | "auto">[] = [
  "nvenc",
  "qsv",
  "amf",
  "vaapi",
  "videotoolbox",
];

export class HardwareEncoderError extends Error {}

/**
 * Программный кодировщик для этого кодека.
 *
 * Нужен там, где ускоритель заведомо не к месту: предпросмотр кодируется
 * параллельно эфиру и, взяв тот же ускоритель, отбирал бы у него ресурс —
 * а ускоритель у машины, как правило, один.
 */
export function softwareEncoder(codec: VideoEncoding["codec"]): ResolvedVideoEncoder {
  return { name: softwareNames[codec] ?? "libx264", vendor: "off", needsHardwareUpload: false };
}

/**
 * Что именно запускать. `availableEncoders` — список из `ffmpeg -encoders`.
 *
 * Молча падать на программный кодировщик нельзя: оператор выбрал ускоритель,
 * потому что без него профиль не тянется, и подмена вылезла бы уже в эфире
 * пропущенными кадрами.
 */
export function resolveVideoEncoder(
  video: VideoEncoding,
  availableEncoders: readonly string[],
): ResolvedVideoEncoder {
  if (video.hardware === "off") return softwareEncoder(video.codec);

  const available = new Set(availableEncoders);

  if (video.hardware === "auto") {
    for (const vendor of autoOrder) {
      const name = encoderNames[vendor][video.codec];
      if (name && available.has(name)) {
        return { name, vendor, needsHardwareUpload: vendor === "vaapi" };
      }
    }
    // Явный отказ: «auto» значит «найди ускоритель», а не «как получится».
    throw new HardwareEncoderError(
      `No hardware encoder for ${video.codec} is available in this FFmpeg build. ` +
        "Install a build with NVENC, QSV, AMF, VAAPI or VideoToolbox support, " +
        "or set hardware encoding to Off.",
    );
  }

  const name = encoderNames[video.hardware][video.codec];
  if (!name) {
    throw new HardwareEncoderError(
      `${video.hardware} cannot encode ${video.codec}. Choose another codec or another accelerator.`,
    );
  }
  if (!available.has(name)) {
    throw new HardwareEncoderError(
      `This FFmpeg build has no '${name}' encoder. Install a build with ${video.hardware} support, ` +
        "or set hardware encoding to Off.",
    );
  }
  return { name, vendor: video.hardware, needsHardwareUpload: video.hardware === "vaapi" };
}

/**
 * Чересстрочное кодирование ускорителям почти не даётся.
 *
 * Отдать вместо 50i прогрессив — это не деградация качества, а несоответствие
 * профилю: головная станция ждёт поля. Ловим до старта.
 */
export function hardwareSupportsInterlace(vendor: VideoHardware): boolean {
  return vendor === "off" || vendor === "qsv";
}

/**
 * Аргументы кодировщика под конкретный ускоритель.
 *
 * Общие для всех `-g`, `-bf`, `-pix_fmt` добавляет вызывающий: у ускорителей
 * они те же, различается только собственно управление скоростью и пресеты.
 */
export function hardwareEncoderArgs(
  video: VideoEncoding,
  resolved: ResolvedVideoEncoder,
): string[] {
  const bitrate = `${video.targetBitrateKbps}k`;
  const maxrate = `${Math.max(video.targetBitrateKbps, video.maxBitrateKbps)}k`;
  const bufsize = `${video.bufferSizeKbps}k`;
  const cbr = video.rateControl === "cbr";

  if (resolved.vendor === "nvenc") {
    // p1 — самый быстрый, p7 — самый медленный. Пресеты x264 сюда не годятся.
    const preset = nvencPreset(video.preset);
    const args = [
      "-c:v", resolved.name,
      "-preset", preset,
      "-tune", "ll",
      "-rc", cbr ? "cbr" : "vbr",
      "-b:v", bitrate,
      "-maxrate", maxrate,
      "-bufsize", bufsize,
      // Ключевой кадр обязан стоять там, где его ждёт GOP: иначе врезка SCTE-35
      // не находит рядом IDR.
      "-forced-idr", "1",
      "-no-scenecut", "1",
    ];
    if (video.codec === "h264") {
      args.push("-profile:v", h264Profile(video.profile), "-level", video.level);
    } else {
      args.push("-profile:v", video.profile.toLowerCase().includes("10") ? "main10" : "main");
    }
    return args;
  }

  if (resolved.vendor === "qsv") {
    const args = [
      "-c:v", resolved.name,
      "-preset", qsvPreset(video.preset),
      "-b:v", bitrate,
      "-maxrate", maxrate,
      "-bufsize", bufsize,
    ];
    if (cbr) args.push("-rc_mode", "CBR");
    // Просмотр вперёд копит задержку — для эфира это лишнее.
    if (video.codec === "h264") args.push("-look_ahead", "0", "-profile:v", h264Profile(video.profile));
    return args;
  }

  if (resolved.vendor === "amf") {
    const args = [
      "-c:v", resolved.name,
      "-quality", video.preset === "ultrafast" || video.preset === "superfast" ? "speed" : "balanced",
      "-rc", cbr ? "cbr" : "vbr_peak",
      "-b:v", bitrate,
      "-maxrate", maxrate,
      "-bufsize", bufsize,
    ];
    if (video.codec === "h264") args.push("-profile:v", h264Profile(video.profile), "-level", video.level);
    if (cbr) args.push("-filler_data", "1");
    return args;
  }

  if (resolved.vendor === "vaapi") {
    const args = [
      "-c:v", resolved.name,
      "-b:v", bitrate,
      "-maxrate", maxrate,
      "-bufsize", bufsize,
      "-rc_mode", cbr ? "CBR" : "VBR",
    ];
    if (video.codec === "h264") args.push("-profile:v", h264Profile(video.profile), "-level", video.level);
    return args;
  }

  // VideoToolbox. Собственного CBR у него нет: скорость держится приблизительно,
  // а окончательное выравнивание всё равно делает TSDuck на транспорте.
  const args = [
    "-c:v", resolved.name,
    "-b:v", bitrate,
    "-maxrate", maxrate,
    "-bufsize", bufsize,
    "-realtime", "1",
    // Без запасного программного пути кодирование падает, когда ускоритель
    // занят другим процессом.
    "-allow_sw", "1",
  ];
  if (video.codec === "h264") args.push("-profile:v", h264Profile(video.profile));
  if (cbr) args.push("-constant_bit_rate", "1");
  return args;
}

function h264Profile(profile: string): string {
  const value = profile.toLowerCase();
  return ["baseline", "main", "high"].includes(value) ? value : "high";
}

/** Пресеты x264 в шкалу NVENC p1..p7. */
function nvencPreset(preset: VideoEncoding["preset"]): string {
  const map: Record<string, string> = {
    ultrafast: "p1", superfast: "p1", veryfast: "p2", faster: "p3",
    fast: "p4", medium: "p4", slow: "p5", slower: "p6", veryslow: "p7",
  };
  return map[preset] ?? "p4";
}

/** У QSV своя шкала, но названия частично совпадают с x264. */
function qsvPreset(preset: VideoEncoding["preset"]): string {
  const map: Record<string, string> = {
    ultrafast: "veryfast", superfast: "veryfast", veryfast: "veryfast",
    faster: "faster", fast: "fast", medium: "medium",
    slow: "slow", slower: "slower", veryslow: "veryslow",
  };
  return map[preset] ?? "medium";
}
