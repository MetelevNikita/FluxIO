import type { GraphicEffectAsset } from "@gruber/contracts";
import type { MediaAsset } from "./types.js";

/**
 * Поиск потерянной графики.
 *
 * Расписание хранит абсолютные пути к файлам, а не сами файлы. Поэтому после
 * перезапуска приложения — и тем более при переносе расписания на другую
 * машину — ролик может ссылаться на графику, которой на диске уже нет или
 * которой нет в библиотеке эффектов проекта. Эфир в этом случае падает уже на
 * старте, поэтому оператору нужно показать список пропаж и дать выбрать замену
 * до того, как он нажмёт Start.
 *
 * Функции чистые: сам факт наличия файла проверяет media-service, сюда приходит
 * готовый список отсутствующих путей.
 */

export interface MissingGraphic {
  /** Ключ замены: путь к файлу, каким он записан в расписании. */
  filePath: string;
  /** Как эффект назван в расписании — по нему оператор его и узнаёт. */
  name: string;
  /** Сколько роликов на него ссылается, включая оба расписания. */
  usageCount: number;
  /** Есть ли эффект в библиотеке проекта или потерян и он тоже. */
  inLibrary: boolean;
  reason: "file-missing" | "not-in-library";
}

export function collectMissingGraphics(
  playlists: readonly (readonly MediaAsset[])[],
  effectLibrary: readonly GraphicEffectAsset[],
  missingPaths: ReadonlySet<string>,
): MissingGraphic[] {
  const byPath = new Map<string, MissingGraphic>();
  const libraryPaths = new Set(effectLibrary.map((effect) => normalizePath(effect.filePath)));
  const libraryIds = new Set(effectLibrary.map((effect) => effect.id));

  for (const playlist of playlists) {
    for (const asset of playlist) {
      for (const layer of asset.effects ?? []) {
        // Слой второго уровня приходит из библиотеки, и его файл проверяется
        // отдельно — по самому эффекту. Здесь его пропускаем, чтобы одна
        // пропажа не показалась оператору дважды.
        if (layer.tier === 2) continue;
        const fileMissing = missingPaths.has(layer.filePath);
        const notInLibrary = !libraryIds.has(layer.effectId) &&
          !libraryPaths.has(normalizePath(layer.filePath));
        if (!fileMissing && !notInLibrary) continue;
        const existing = byPath.get(layer.filePath);
        if (existing) {
          existing.usageCount += 1;
          continue;
        }
        byPath.set(layer.filePath, {
          filePath: layer.filePath,
          inLibrary: !notInLibrary,
          name: layer.name,
          reason: fileMissing ? "file-missing" : "not-in-library",
          usageCount: 1,
        });
      }
    }
  }
  return [...byPath.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Все пути графики расписания — их и проверяет сервер на наличие. */
export function graphicPathsOf(playlists: readonly (readonly MediaAsset[])[]): string[] {
  const paths = new Set<string>();
  for (const playlist of playlists) {
    for (const asset of playlist) {
      for (const layer of asset.effects ?? []) {
        paths.add(layer.filePath);
        if (layer.backgroundPath) paths.add(layer.backgroundPath);
        if (layer.titlePath) paths.add(layer.titlePath);
      }
    }
  }
  return [...paths];
}

/**
 * Подставляет выбранные оператором файлы вместо потерянных. Слой сохраняет своё
 * место и границы на таймлайне — меняется только источник картинки.
 */
export function applyGraphicReplacements(
  assets: readonly MediaAsset[],
  replacements: ReadonlyMap<string, GraphicEffectAsset>,
): { items: MediaAsset[]; replaced: number } {
  if (replacements.size === 0) return { items: [...assets], replaced: 0 };
  let replaced = 0;
  const items = assets.map((asset) => {
    if (!asset.effects?.some((layer) => replacements.has(layer.filePath))) return asset;
    return {
      ...asset,
      effects: asset.effects.map((layer) => {
        const replacement = replacements.get(layer.filePath);
        if (!replacement) return layer;
        replaced += 1;
        return {
          ...layer,
          backgroundPath: replacement.filePath,
          effectId: replacement.id,
          filePath: replacement.filePath,
          kind: replacement.kind,
          name: replacement.name,
          sourceDurationSeconds: replacement.durationSeconds,
        };
      }),
    };
  });
  return { items, replaced };
}

/** Снимает потерянные слои с роликов — когда замену оператор не нашёл. */
export function dropMissingGraphics(
  assets: readonly MediaAsset[],
  filePaths: ReadonlySet<string>,
): MediaAsset[] {
  return assets.map((asset) => (
    asset.effects?.some((layer) => filePaths.has(layer.filePath))
      ? { ...asset, effects: asset.effects.filter((layer) => !filePaths.has(layer.filePath)) }
      : asset
  ));
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").toLocaleLowerCase();
}


/* -------------------------------------------------------------------------- *
 * Файлы библиотеки эффектов.
 *
 * Расписание хранит абсолютные пути, а не файлы, и это верно не только для
 * FX-слоёв. У эффекта второго уровня свои файлы: оформление Animation in/out,
 * файл перехода стингера и подложки узлов сцены. После переноса проекта или
 * переустановки их может не быть, и раньше это всплывало отказом на Start.
 * ------------------------------------------------------------------------- */

/** Что за файл потерян и у какого эффекта. */
export interface MissingEffectFile {
  filePath: string;
  effectId: string;
  effectName: string;
  /** Чем этот файл был для эффекта — по этому оператор его и узнаёт. */
  role: "decoration" | "stinger" | "scene-media";
  /** Имя узла сцены, если пропала подложка. */
  nodeName?: string;
}

/** Все пути, которые библиотека держит на диске: их и проверяет сервер. */
export function effectLibraryPaths(
  effectLibrary: readonly GraphicEffectAsset[],
): string[] {
  const paths = new Set<string>();
  for (const { filePath } of describeEffectFiles(effectLibrary)) paths.add(filePath);
  return [...paths];
}

/** Потерянные файлы библиотеки — по списку отсутствующих путей от сервера. */
export function collectMissingEffectFiles(
  effectLibrary: readonly GraphicEffectAsset[],
  missingPaths: ReadonlySet<string>,
): MissingEffectFile[] {
  return describeEffectFiles(effectLibrary)
    .filter((entry) => missingPaths.has(entry.filePath))
    .sort((left, right) => left.effectName.localeCompare(right.effectName));
}

function describeEffectFiles(
  effectLibrary: readonly GraphicEffectAsset[],
): MissingEffectFile[] {
  const found: MissingEffectFile[] = [];
  for (const effect of effectLibrary) {
    const definition = effect.broadcast;
    if (!definition) continue;
    const base = { effectId: effect.id, effectName: effect.name };

    if (definition.decorationFilePath) {
      found.push({ ...base, filePath: definition.decorationFilePath, role: "decoration" });
    }
    const stinger = definition.settings.stingerTransition.assetPath;
    // Последовательность записана шаблоном нумерации: проверять её как файл
    // бессмысленно, такого пути на диске нет.
    if (stinger && definition.settings.stingerTransition.sourceKind !== "sequence") {
      found.push({ ...base, filePath: stinger, role: "stinger" });
    }
    for (const node of definition.scene?.nodes ?? []) {
      const filePath = node.media.filePath;
      if (!filePath || node.media.sequenceFrameRate != null) continue;
      found.push({ ...base, filePath, role: "scene-media", nodeName: node.name });
    }
  }
  return found;
}

/** Подставляет найденный файл вместо потерянного во всех его местах. */
export function applyEffectFileReplacement(
  effectLibrary: readonly GraphicEffectAsset[],
  fromPath: string,
  toPath: string,
): GraphicEffectAsset[] {
  return effectLibrary.map((effect) => {
    const definition = effect.broadcast;
    if (!definition) return effect;
    const settings = definition.settings.stingerTransition.assetPath === fromPath
      ? {
          ...definition.settings,
          stingerTransition: { ...definition.settings.stingerTransition, assetPath: toPath },
        }
      : definition.settings;
    const scene = definition.scene
      ? {
          ...definition.scene,
          nodes: definition.scene.nodes.map((node) => (node.media.filePath === fromPath
            ? { ...node, media: { ...node.media, filePath: toPath } }
            : node)),
        }
      : definition.scene;
    return {
      ...effect,
      broadcast: {
        ...definition,
        decorationFilePath: definition.decorationFilePath === fromPath
          ? toPath
          : definition.decorationFilePath,
        settings,
        scene,
      },
    };
  });
}
