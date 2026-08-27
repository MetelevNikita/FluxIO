import { createHash } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  graphicEffectAssetSchema,
  type GraphicEffectAsset,
} from "@gruber/contracts";
import { probeMedia } from "../ffmpeg/probe.js";

const staticExtensions = new Set([".png", ".webp"]);
const videoExtensions = new Set([".mov", ".mp4", ".m4v", ".webm"]);

export interface GraphicEffectAnalysisResult {
  items: GraphicEffectAsset[];
  issues: { filePath: string; message: string }[];
}

export async function analyzeGraphicEffectPaths(
  paths: string[],
  ffprobePath: string,
): Promise<GraphicEffectAsset[]> {
  const assets: GraphicEffectAsset[] = [];
  for (const filePath of paths) {
    assets.push(await analyzeGraphicEffect(filePath, ffprobePath));
  }
  return assets;
}

/**
 * Пакетный импорт с частичным успехом: один повреждённый файл не должен
 * выбрасывать уже разобранные эффекты из той же папки.
 */
export async function analyzeGraphicEffectPathsPartial(
  paths: string[],
  ffprobePath: string,
): Promise<GraphicEffectAnalysisResult> {
  const items: GraphicEffectAsset[] = [];
  const issues: GraphicEffectAnalysisResult["issues"] = [];
  for (const filePath of paths) {
    try {
      items.push(await analyzeGraphicEffect(filePath, ffprobePath));
    } catch (error) {
      issues.push({
        filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { issues, items };
}

export async function scanGraphicEffectDirectory(
  directoryPath: string,
  ffprobePath: string,
  maxFiles = 200,
): Promise<GraphicEffectAnalysisResult> {
  if (!path.isAbsolute(directoryPath)) {
    throw new Error(`Effects directory path must be absolute: ${directoryPath}`);
  }
  const root = await realpath(directoryPath);
  if (!(await stat(root)).isDirectory()) {
    throw new Error(`Effects path is not a directory: ${root}`);
  }
  const paths: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && isSupportedEffect(entry.name)) {
        paths.push(entryPath);
        if (paths.length > maxFiles) {
          throw new Error(`Effects directory contains more than ${maxFiles} supported files`);
        }
      }
    }
  }

  await visit(root);
  return analyzeGraphicEffectPathsPartial(
    paths.sort((left, right) => left.localeCompare(right)),
    ffprobePath,
  );
}

async function analyzeGraphicEffect(
  filePath: string,
  ffprobePath: string,
): Promise<GraphicEffectAsset> {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`Effect path must be absolute: ${filePath}`);
  }
  const resolvedPath = await realpath(filePath);
  const extension = path.extname(resolvedPath).toLowerCase();
  if (!staticExtensions.has(extension) && !videoExtensions.has(extension)) {
    throw new Error(`Unsupported effect format: ${path.basename(resolvedPath)}`);
  }
  const probe = await probeMedia(resolvedPath, ffprobePath);
  const kind = staticExtensions.has(extension) ? "static" as const : "video" as const;
  return graphicEffectAssetSchema.parse({
    id: `fx-${createHash("sha256").update(resolvedPath).digest("hex").slice(0, 16)}`,
    name: path.basename(resolvedPath),
    filePath: resolvedPath,
    kind,
    durationSeconds: kind === "static" ? 0 : probe.durationSeconds,
    width: probe.width,
    height: probe.height,
  });
}

function isSupportedEffect(fileName: string): boolean {
  const extension = path.extname(fileName).toLowerCase();
  return staticExtensions.has(extension) || videoExtensions.has(extension);
}
