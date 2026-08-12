import type { GraphicEffectAsset, GraphicEffectLayer } from "@gruber/contracts";
import { matchingNamedAssetPath } from "./graphic-title-matching.js";
import type { MediaAsset } from "./types.js";

export type EffectLayerIdFactory = (assetId: string, effectId: string) => string;

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
        effectId: effect.id,
        endSeconds,
        filePath: effect.filePath,
        id: createLayerId(asset.id, effect.id),
        kind: effect.kind,
        name: effect.name,
        sourceDurationSeconds: effect.durationSeconds,
        startSeconds: 0,
        titlePath: effect.titleDirectoryPath
          ? matchingNamedAssetPath(asset.name, effect.titlePaths)
          : null,
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
