import { z } from "zod";
import { sceneTemplateSchema } from "./scene.js";

/* -------------------------------------------------------------------------- *
 * Файл титра `.fto` — FluxIO Title Object.
 *
 * Своё расширение взято намеренно. Титр — это JSON, и с расширением `.json`
 * его нельзя отличить от файла задания, профиля настроек или чего угодно
 * ещё: оператор выбирает файл в диалоге и узнаёт об ошибке уже при разборе.
 * С `.fto` диалог фильтрует сам, а метка внутри страхует от подмены.
 *
 * Метка и версия обязательны по той же причине, что у профиля кодирования:
 * чужой или будущий файл обязан отклоняться внятно, а не разбираться наполовину.
 * ------------------------------------------------------------------------- */

/** Расширение файла титра, без точки. */
export const titleFileExtension = "fto";

export const titleFileSchema = z.object({
  format: z.literal("fluxio-title"),
  /** Версия формата файла, а не приложения. Растёт при несовместимой правке. */
  formatVersion: z.literal(1),
  /** Чем сохранён — нужно, чтобы объяснить отказ на старой сборке. */
  applicationVersion: z.string().min(1).max(64),
  savedAt: z.iso.datetime(),
  /** Подпись автора; пусто — не заполнено. */
  author: z.string().max(200).default(""),
  /** Короткое описание для окна выбора. */
  description: z.string().max(500).default(""),
  template: sceneTemplateSchema,
}).strict();

export type TitleFile = z.infer<typeof titleFileSchema>;

/**
 * Что окно выбора показывает про файл, не разбирая его целиком.
 *
 * Читается из уже разобранного файла: каталог титров может быть большим, и
 * держать в памяти все шаблоны ради списка незачем.
 */
export const titleFileSummarySchema = z.object({
  filePath: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(500).default(""),
  author: z.string().max(200).default(""),
  savedAt: z.iso.datetime(),
  /** Раскладки, под которые шаблон заявлен. */
  targets: z.array(z.string().min(1)).max(4).default([]),
  nodeCount: z.number().int().nonnegative(),
  fieldKeys: z.array(z.string().min(1)).max(64).default([]),
});

export type TitleFileSummary = z.infer<typeof titleFileSummarySchema>;

export const titleFileListSchema = z.object({
  directoryPath: z.string(),
  items: z.array(titleFileSummarySchema).max(500),
  /** Файлы, которые не разобрались: их надо показать, а не проглотить. */
  issues: z.array(z.object({
    filePath: z.string().min(1),
    message: z.string().min(1).max(500),
  })).max(200).default([]),
});

export type TitleFileList = z.infer<typeof titleFileListSchema>;
