/* -------------------------------------------------------------------------- *
 * Что выбрасывается из `node_modules` комплекта.
 *
 * Комплект едет флешкой на машину без интернета, и каждый мегабайт — это время
 * копирования и место на диске эфирной машины. Внутри пакетов лежит много того,
 * что нашей службе не нужно никогда: компиляторы запросов для чужих СУБД,
 * карты исходников, сборки для браузера.
 *
 * Правила намеренно узкие и с причиной у каждого. Обрезка «всё, что похоже на
 * лишнее» рано или поздно вырежет нужный файл, и выяснится это на эфирной
 * машине, где чинить нечем.
 * ------------------------------------------------------------------------- */

/**
 * Единственная СУБД, с которой работает FluxIO. Компиляторы запросов для
 * остальных Prisma кладёт рядом — по 4.5 МБ на движок в двух вариантах и двух
 * форматах модулей.
 */
const usedDatabaseEngine = "postgresql";

const otherEngines = ["cockroachdb", "mysql", "sqlite", "sqlserver"];

export function pruneRules() {
  return [
    {
      id: "prisma-engines",
      reason: `компиляторы запросов для чужих СУБД (нужен только ${usedDatabaseEngine})`,
      test: (relativePath) =>
        relativePath.startsWith("@prisma/client/runtime/") &&
        otherEngines.some((engine) => relativePath.includes(`_bg.${engine}.`)),
    },
    {
      id: "source-maps",
      reason: "карты исходников: отладчик на эфирной машине никто не открывает",
      test: (relativePath) =>
        (relativePath.startsWith("@prisma/client/") || relativePath.startsWith("pdfjs-dist/")) &&
        relativePath.endsWith(".map"),
    },
    {
      // Служба разбирает PDF через `pdfjs-dist/legacy/build/pdf.mjs`; просмотрщик
      // и его локали — это интерфейс для браузера, которого здесь нет.
      id: "pdfjs-viewer",
      reason: "просмотрщик PDF: служба использует только разбор документа",
      test: (relativePath) => relativePath.startsWith("pdfjs-dist/web/"),
    },
  ];
}

/** Причина, по которой файл не едет, или `null`. */
export function pruneReason(relativePath, rules = pruneRules()) {
  const normalized = relativePath.replaceAll("\\", "/");
  return rules.find((rule) => rule.test(normalized))?.reason ?? null;
}
