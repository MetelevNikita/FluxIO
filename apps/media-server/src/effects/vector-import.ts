import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { vectorLayerImportSchema, type VectorLayerImport } from "@gruber/contracts";

const maximumDimension = 4_096;

/**
 * PDF layers are rendered independently because the scene already knows how
 * to transform and animate image nodes. Editable Bézier paths need a separate
 * scene node and renderer; pretending these PNGs are paths would corrupt the
 * editor's contract.
 */
export async function importVectorLayers(
  filePath: string,
  cacheRoot: string,
): Promise<VectorLayerImport> {
  const extension = extname(filePath).toLowerCase();
  if (extension !== ".pdf" && extension !== ".ai") {
    throw new Error("Choose a .pdf or PDF-compatible .ai file");
  }

  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("Vector source is not a file");
  const data = new Uint8Array(await readFile(filePath));
  const document = await getDocument({ data }).promise.catch((error: unknown) => {
    if (extension === ".ai") {
      throw new Error("This .ai file has no PDF-compatible data. Resave it with Create PDF Compatible File enabled.");
    }
    throw error;
  });

  try {
    const page = await document.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, maximumDimension / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale: Math.max(0.1, scale) });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
    const sourceName = basename(filePath, extension);
    const key = createHash("sha256")
      .update(filePath)
      .update(String(info.size))
      .update(String(info.mtimeMs))
      .digest("hex")
      .slice(0, 20);
    const directory = join(cacheRoot, "vector-layers", key);
    await mkdir(directory, { recursive: true });

    const optional = await document.getOptionalContentConfig({ intent: "display" });
    const groups = [...optional].map(([id, group]) => ({
      id: String(id),
      name: cleanName(String((group as { name?: unknown }).name ?? "")) || sourceName,
    })).slice(0, 200);
    const selected = groups.length > 0 ? groups : [{ id: null, name: sourceName }];
    const layers: VectorLayerImport["layers"] = [];

    for (const [index, layer] of selected.entries()) {
      const outputPath = join(directory, `${String(index + 1).padStart(3, "0")}-${fileName(layer.name)}.png`);
      const config = layer.id === null ? optional : await document.getOptionalContentConfig({ intent: "display" });
      if (layer.id !== null) {
        for (const [id] of config) config.setVisibility(id, String(id) === layer.id);
      }
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, width, height);
      await page.render({
        canvas: canvas as never,
        canvasContext: context as never,
        viewport,
        background: "rgba(0,0,0,0)",
        optionalContentConfigPromise: Promise.resolve(config),
      }).promise;
      await writeFile(outputPath, await canvas.encode("png"));
      layers.push({ name: layer.name, filePath: outputPath });
    }

    return vectorLayerImportSchema.parse({ width, height, layered: groups.length > 0, layers });
  } finally {
    await document.destroy();
  }
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 256);
}

function fileName(value: string): string {
  return cleanName(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 80) || "layer";
}
