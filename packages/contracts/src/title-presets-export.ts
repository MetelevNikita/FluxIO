import { builtInTitlePresets } from "./title-presets.js";
import { titleFileSchema, type TitleFile } from "./title-file.js";

/* -------------------------------------------------------------------------- *
 * Базовый набор в виде файлов `.fto`.
 *
 * Набор описан кодом — так его проверяет тест, — а поставляется файлами: в
 * папке титров он лежит рядом с тем, что оператор соберёт сам, и ничем от
 * него не отличается.
 * ------------------------------------------------------------------------- */

export interface TitlePresetFile {
  /** Имя файла с расширением. */
  fileName: string;
  file: TitleFile;
}

const descriptions: Record<string, string> = {
  "preset-logo-headline": "Логотип, город и заголовок в две строки",
  "preset-breaking-dark": "Тёмная плашка с красной отбивкой у текста",
  "preset-breaking-block": "Блок «Срочные новости» слева и строка «В эфире»",
  "preset-breaking-two-bars": "Заголовок на тёмной плашке, подпись на светлой",
  "preset-breaking-underline": "Заголовок с линией и подписью под ней",
  "preset-live-badge": "Угловая метка «В эфире» с городом",
};

/**
 * `savedAt` фиксирован намеренно: набор не должен меняться от того, когда его
 * собрали. Иначе каждая установка писала бы «новые» файлы поверх старых.
 */
const shippedAt = "2026-01-01T00:00:00.000Z";

export function builtInTitlePresetFiles(applicationVersion: string): TitlePresetFile[] {
  return builtInTitlePresets().map((template) => ({
    fileName: `${template.name}.fto`,
    file: titleFileSchema.parse({
      format: "fluxio-title",
      formatVersion: 1,
      applicationVersion,
      savedAt: shippedAt,
      author: "FluxIO",
      description: descriptions[template.id] ?? "",
      template,
    }),
  }));
}
