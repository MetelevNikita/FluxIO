
import {
  sceneFormatSchema,
  sceneTemplateSchema,
  type SceneFormat,
  type SceneTemplate,
} from "@gruber/contracts";
import { planSceneShow, produceSceneShow, type SceneShowRequest } from "./producer.js";

/* -------------------------------------------------------------------------- *
 * Графический процесс.
 *
 * Отдельный процесс, а не работа внутри службы: рисование покадрово — это
 * непрерывная нагрузка, а media-service однопоточный, и всё время рисования он
 * не отвечал бы ни на один маршрут.
 *
 * Запуск: node process-entry.js <путь к запросу .json>
 * Кадры уходят в stdout сырым RGBA, отчёт — в stderr.
 * ------------------------------------------------------------------------- */

interface RawRequest {
  template: unknown;
  format: unknown;
  durationSeconds: number;
  fields?: Record<string, string>;
  airEpochSeconds?: number;
  clipRemainingSeconds?: number;
}

function parseRequest(raw: RawRequest): SceneShowRequest {
  const template: SceneTemplate = sceneTemplateSchema.parse(raw.template);
  const format: SceneFormat = sceneFormatSchema.parse(raw.format);
  return {
    template,
    format,
    durationSeconds: raw.durationSeconds,
    fields: raw.fields ?? {},
    airEpochSeconds: raw.airEpochSeconds ?? 0,
    clipRemainingSeconds: raw.clipRemainingSeconds ?? raw.durationSeconds,
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const payload = await readStdin();
  if (!payload.trim()) throw new Error("Описание показа не передано");
  const request = parseRequest(JSON.parse(payload) as RawRequest);
  const plan = planSceneShow(request);

  if (!plan) {
    // Рисовать нечего — сообщаем размер нулём и уходим. Поднимать вход FFmpeg
    // под пустую сцену незачем.
    process.stderr.write("scene: nothing to draw\n");
    return;
  }

  // Первой строкой — что именно будет в трубе. Вызывающий обязан узнать размер
  // полотна до того, как соберёт команду FFmpeg.
  process.stderr.write(
    `scene: ${plan.region.width}x${plan.region.height}+${plan.region.x}+${plan.region.y} ` +
    `frames=${plan.frameCount}\n`,
  );

  const write = (chunk: Buffer) => new Promise<void>((resolve, reject) => {
    process.stdout.write(chunk, (error) => (error ? reject(error) : resolve()));
  });

  const started = process.hrtime.bigint();
  await produceSceneShow(request, plan, { write });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  process.stderr.write(
    `scene: done in ${elapsedMs.toFixed(0)} ms ` +
    `(${(elapsedMs / plan.frameCount).toFixed(2)} ms/кадр)\n`,
  );
}

main().then(
  () => { process.exitCode = 0; },
  (error: unknown) => {
    // Падение графики не имеет права уронить эфир: сообщаем и уходим, а
    // вызывающий продолжает без титра.
    process.stderr.write(`scene: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
