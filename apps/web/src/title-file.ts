import {
  titleFileSchema,
  titleFileSummarySchema,
  type SceneTemplate,
  type TitleFile,
  type TitleFileSummary,
} from "@gruber/contracts";

/* -------------------------------------------------------------------------- *
 * Чтение и запись файла титра `.fto`.
 *
 * Чистые функции: разбор проверяется тестом, а не выбором файла в диалоге.
 * ------------------------------------------------------------------------- */

/** Готовит содержимое файла. Имя файла берётся из имени шаблона отдельно. */
export function packTitleFile(
  template: SceneTemplate,
  applicationVersion: string,
  extra: { author?: string; description?: string } = {},
): TitleFile {
  return titleFileSchema.parse({
    format: "fluxio-title",
    formatVersion: 1,
    applicationVersion,
    savedAt: new Date().toISOString(),
    author: extra.author ?? "",
    description: extra.description ?? "",
    template,
  });
}

export class TitleFileError extends Error {}

/**
 * Разбирает содержимое файла.
 *
 * Отказ обязан называть причину: оператор выбрал файл из каталога и без
 * объяснения будет думать, что сломалось приложение, а не что файл чужой.
 */
export function parseTitleFile(content: string): TitleFile {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new TitleFileError("Файл не читается как JSON — возможно, это не титр FluxIO");
  }
  const marked = raw as { format?: unknown; formatVersion?: unknown };
  if (marked?.format !== "fluxio-title") {
    throw new TitleFileError(
      "Это не файл титра FluxIO: внутри нет метки формата. " +
        "Шаблоны сохраняются кнопкой «Сохранить как» в редакторе титров.",
    );
  }
  if (marked.formatVersion !== 1) {
    throw new TitleFileError(
      `Файл сохранён в формате версии ${String(marked.formatVersion)}, ` +
        "а эта сборка понимает только версию 1. Обновите FluxIO.",
    );
  }
  const parsed = titleFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new TitleFileError(
      `Файл титра повреждён: ${first?.path.join(".") || "корень"} — ${first?.message ?? "неизвестная ошибка"}`,
    );
  }
  return parsed.data;
}

/** Строка для окна выбора: то, по чему оператор узнаёт титр, не открывая его. */
export function summarizeTitleFile(filePath: string, file: TitleFile): TitleFileSummary {
  return titleFileSummarySchema.parse({
    filePath,
    name: file.template.name,
    description: file.description,
    author: file.author,
    savedAt: file.savedAt,
    targets: file.template.targets,
    nodeCount: file.template.nodes.length,
    fieldKeys: file.template.fields.map((field) => field.key),
  });
}

/**
 * Имя файла из имени шаблона.
 *
 * Кириллицу оставляем: оператор ищет файл глазами в проводнике, и `plashka_1`
 * вместо «Нижняя треть» ему ничего не скажет. Убираем только то, чем файловая
 * система давится.
 */
export function titleFileName(templateName: string): string {
  const base = templateName
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Титр";
  return `${base}.fto`;
}

/**
 * Шаблон из файла с новым опознавателем.
 *
 * Загружать шаблон под его прежним id нельзя: два эффекта с одним id — это
 * потерянная привязка плашки к тексту, и заметно это только в эфире.
 */
export function adoptTitleTemplate(
  template: SceneTemplate,
  createId: () => string,
): SceneTemplate {
  const remap = new Map<string, string>();
  for (const node of template.nodes) remap.set(node.id, `${node.kind}-${createId()}`);
  return {
    ...template,
    id: `scene-${createId()}`,
    nodes: template.nodes.map((node) => ({
      ...node,
      id: remap.get(node.id) ?? node.id,
      parentId: node.parentId ? remap.get(node.parentId) ?? null : null,
      fitToText: node.fitToText
        ? { ...node.fitToText, nodeId: remap.get(node.fitToText.nodeId) ?? node.fitToText.nodeId }
        : null,
    })),
  };
}
