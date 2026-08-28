import type { SceneLayoutTarget } from "@gruber/contracts";

/* -------------------------------------------------------------------------- *
 * Кадр раскладочной цели.
 *
 * Таблица общая для редактора титров и предпросмотра в библиотеке эффектов:
 * две копии разошлись бы по пиксельному отношению, и SD 4:3 в одном месте
 * выглядел бы растянутым, а в другом нет.
 * ------------------------------------------------------------------------- */

export interface SceneLayoutFormat {
  width: number;
  height: number;
  pixelAspect: number;
  drawRate: number;
  scan: "progressive" | "interlaced";
}

/** Частота у чересстрочных задана **в полях**: 50i рисует 50 раз в секунду. */
export const layoutFormats: Record<SceneLayoutTarget, SceneLayoutFormat> = {
  "sd-4x3": { width: 720, height: 576, pixelAspect: 1.4587, drawRate: 50, scan: "interlaced" },
  "sd-16x9": { width: 720, height: 576, pixelAspect: 1.9457, drawRate: 50, scan: "interlaced" },
  hd: { width: 1_920, height: 1_080, pixelAspect: 1, drawRate: 25, scan: "progressive" },
  uhd: { width: 3_840, height: 2_160, pixelAspect: 1, drawRate: 25, scan: "progressive" },
};

export const layoutTitles: Record<SceneLayoutTarget, string> = {
  "sd-4x3": "SD 4:3",
  "sd-16x9": "SD 16:9",
  hd: "HD",
  uhd: "UHD",
};
