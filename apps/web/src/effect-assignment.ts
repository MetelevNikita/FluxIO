import type { GraphicEffectAsset } from "@gruber/contracts";

/**
 * Убирает эффект из библиотеки.
 *
 * Оформление принадлежит самому эффекту — сцена или путь к файлу лежат внутри
 * него, — поэтому отдельной графики, которую надо было бы подчищать следом,
 * больше не существует.
 *
 * Порядок остальных записей сохраняется: он задаёт порядок наложения слоёв.
 */
export function removeEffectFromLibrary(
  effects: readonly GraphicEffectAsset[],
  effectId: string,
): GraphicEffectAsset[] {
  return effects.filter((entry) => entry.id !== effectId);
}
