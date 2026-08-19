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
        // Эффект второго уровня оформлен пресетом и своего файла не имеет:
        // его потерю показывает пресет, а не сам слой.
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
