import type { GraphicEffectAsset, GraphicEffectLayer } from "@gruber/contracts";
import { matchingNamedAssetPath } from "./graphic-title-matching.js";
import type { MediaAsset } from "./types.js";

export type EffectLayerIdFactory = (assetId: string, effectId: string) => string;

export function appendLottieEffectInstances(
  current: GraphicEffectAsset[],
  incoming: GraphicEffectAsset[],
  createId: () => string = () => globalThis.crypto.randomUUID(),
): GraphicEffectAsset[] {
  const result = [...current];
  for (const effect of incoming) {
    const sourcePath = effect.lottie?.sourcePath;
    if (!sourcePath) continue;
    const copies = result.filter((candidate) => candidate.lottie?.sourcePath === sourcePath).length;
    result.push({
      ...effect,
      id: `${effect.id}-${createId()}`,
      name: copies === 0 ? effect.name : `${effect.name} (${copies + 1})`,
    });
  }
  return result;
}

/**
 * Убирает эффект и его графику, если на неё больше никто не ссылается.
 *
 * Графика перестала быть самостоятельным элементом списка, поэтому осиротевшая
 * запись оператору невидима — но остаётся в сессии и заново рендерится при
 * каждом её восстановлении, занимая однопоточную службу.
 *
 * Общий файл у нескольких эффектов остаётся: удаление одного из них не должно
 * гасить графику у соседей. Порядок остальных записей сохраняется — он задаёт
 * порядок наложения слоёв в кадре.
 */
export function removeEffectFromLibrary(
  effects: readonly GraphicEffectAsset[],
  effectId: string,
): GraphicEffectAsset[] {
  const removed = effects.find((entry) => entry.id === effectId);
  const rest = effects.filter((entry) => entry.id !== effectId);
  const presetId = removed?.broadcast?.presetEffectId ?? null;
  if (!presetId) return rest;
  const stillReferenced = rest.some((entry) => entry.broadcast?.presetEffectId === presetId);
  return stillReferenced ? rest : rest.filter((entry) => entry.id !== presetId);
}

export function lottieTextValues(effect: GraphicEffectAsset): string[] {
  return effect.lottie?.properties
    .filter((property) => property.type === "text")
    .map((property) => String(property.value)) ?? [];
}

export function assignEffectToAssets(
  items: MediaAsset[],
  effect: GraphicEffectAsset,
  targetIds?: Set<string>,
  createLayerId: EffectLayerIdFactory = defaultLayerId,
): { items: MediaAsset[]; added: number } {
  let added = 0;
  return {
    items: items.map((asset) => {
      if (targetIds && !targetIds.has(asset.id)) return asset;
      const clipDuration = Math.max(0.04, effectiveAssetDuration(asset));
      const endSeconds = Math.max(
        0.04,
        Math.min(
          clipDuration,
          effect.kind === "static" || effect.durationSeconds <= 0
            ? clipDuration
            : effect.durationSeconds,
        ),
      );
      const layer: GraphicEffectLayer = {
        backgroundPath: effect.filePath,
        blendMode: "alpha",
        effectId: effect.id,
        endSeconds,
        lumaThreshold: 0.08,
        sequenceFrameRate: null,
        sequenceStartNumber: null,
        // Эффект уровня 3 ложится туда, куда его поставил дизайнер; сдвиг
        // задаётся эффектом второго уровня.
        offsetXPercent: 0,
        offsetYPercent: 0,
        sourceInSeconds: 0,
        tier: 3,
        filePath: effect.filePath,
        id: createLayerId(asset.id, effect.id),
        kind: effect.kind,
        name: effect.name,
        sourceDurationSeconds: effect.durationSeconds,
        startSeconds: 0,
        titlePath: effect.titleDirectoryPath
          ? matchingNamedAssetPath(asset.name, effect.titlePaths)
          : null,
        titlePaths: lottieTextValues(effect),
      };
      added += 1;
      return { ...asset, effects: [...(asset.effects ?? []), layer] };
    }),
    added,
  };
}

function effectiveAssetDuration(asset: MediaAsset): number {
  return Math.max(
    0,
    Math.min(asset.declaredDurationSeconds ?? asset.durationSeconds, asset.durationSeconds),
  );
}

function defaultLayerId(assetId: string, effectId: string): string {
  return `layer-${assetId}-${effectId}-${globalThis.crypto.randomUUID()}`;
}
