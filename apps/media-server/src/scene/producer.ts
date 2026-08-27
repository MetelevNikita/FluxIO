import { createCanvas } from "@napi-rs/canvas";
import {
  sceneShowRegion,
  sceneTiming,
  type SceneFormat,
  type SceneRegion,
  type SceneTemplate,
} from "@gruber/contracts";
import { measureSceneText, type SceneSurface } from "@gruber/scene-renderer";
import { SceneRenderer } from "./surface.js";

/* -------------------------------------------------------------------------- *
 * Выдача кадров сцены в эфирный конвейер.
 *
 * Кадры отдаются сырым RGBA — так же, как рендереры звуковых дорожек отдают
 * сырой PCM, — и FFmpeg берёт их обычным входом.
 *
 * Полотно фиксировано на весь показ. Область одного кадра меняется, а наложение
 * принимает одно смещение на вход: двигать его покадрово нечем. Поэтому размер
 * считается по объединению всех кадров, а смещение остаётся постоянным.
 * ------------------------------------------------------------------------- */

export interface SceneShowRequest {
  template: SceneTemplate;
  format: SceneFormat;
  /** Сколько длится показ. Режиссёр укладывает вход и выход внутрь этого числа. */
  durationSeconds: number;
  fields: Record<string, string>;
  /** Эфирное время первого кадра ролика — нужно часам. */
  airEpochSeconds: number;
  /** Сколько остаётся до конца ролика — нужно отсчёту «до конца». */
  clipRemainingSeconds: number;
}

export interface SceneShowPlan {
  region: SceneRegion;
  /** Сколько кадров обязан отдать процесс. Ни больше, ни меньше. */
  frameCount: number;
}

/**
 * Что и куда рисовать для одного показа.
 *
 * `null` — сцена невидима на всём показе: тогда и процесс поднимать незачем.
 */
export function planSceneShow(request: SceneShowRequest): SceneShowPlan | null {
  const timing = sceneTiming(request.template.director, request.durationSeconds);
  const ruler = createCanvas(1, 1).getContext("2d") as unknown as SceneSurface;
  const widths = measureSceneText(ruler, request.template, request.format, {
    frameWidth: request.format.width,
    frameHeight: request.format.height,
    originX: 0,
    originY: 0,
    timeSeconds: 0,
    fields: request.fields,
    images: {},
    airEpochSeconds: request.airEpochSeconds,
    clipRemainingSeconds: request.clipRemainingSeconds,
  });

  const region = sceneShowRegion(request.template, request.format, timing, widths);
  if (!region) return null;
  return {
    region,
    // Число кадров задаёт длительность показа, а не то, что успел нарисовать
    // процесс: FFmpeg ждёт ровно столько, и недостача остановит конвейер.
    frameCount: Math.max(1, Math.round(request.durationSeconds * request.format.drawRate)),
  };
}

export interface SceneFrameSink {
  write(chunk: Buffer): Promise<void>;
}

/**
 * Рисует показ целиком и отдаёт кадры приёмнику.
 *
 * Кадры, на которых сцена невидима, всё равно отдаются — прозрачными. Пропуск
 * кадра сдвинул бы всю дорожку: FFmpeg считает их по порядку, а не по времени.
 */
export async function produceSceneShow(
  request: SceneShowRequest,
  plan: SceneShowPlan,
  sink: SceneFrameSink,
): Promise<number> {
  const renderer = new SceneRenderer(request.template, request.format, request.durationSeconds);
  const { region } = plan;
  const stride = region.width * 4;
  const blank = Buffer.alloc(stride * region.height);
  const canvas = Buffer.alloc(stride * region.height);

  for (let frame = 0; frame < plan.frameCount; frame += 1) {
    const drawn = renderer.render(frame, {
      fields: request.fields,
      images: {},
      airEpochSeconds: request.airEpochSeconds,
      clipRemainingSeconds: Math.max(0, request.clipRemainingSeconds - frame / request.format.drawRate),
    });

    if (!drawn) {
      await sink.write(blank);
      continue;
    }

    // Кадр нарисован в своей области, а отдать надо в области показа: она
    // больше и не двигается. Копируем построчно со сдвигом.
    canvas.fill(0);
    const offsetX = (drawn.x - region.x) * 4;
    const offsetY = drawn.y - region.y;
    const rowBytes = Math.min(drawn.width * 4, stride - offsetX);
    if (rowBytes > 0) {
      for (let row = 0; row < drawn.height; row += 1) {
        const target = row + offsetY;
        if (target < 0 || target >= region.height) continue;
        drawn.pixels.copy(
          canvas,
          target * stride + offsetX,
          row * drawn.width * 4,
          row * drawn.width * 4 + rowBytes,
        );
      }
    }
    await sink.write(canvas);
  }

  return plan.frameCount;
}
