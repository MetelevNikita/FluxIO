/**
 * Длительность ролика в эфире.
 *
 * У ролика два источника длительности: разобранный файл (`durationSeconds`) и
 * объявленная расписанием (`declaredDurationSeconds`). В эфир идёт меньшая —
 * расписание подрезает файл.
 *
 * Тонкость, которая раньше ломала эффекты: у ролика из импортированного
 * расписания файл может быть ещё не разобран, и тогда `durationSeconds` равен
 * нулю. Прямой `Math.min` давал ноль даже при известной длительности из
 * расписания, а всё, что отсчитывается **от конца** ролика — плашка
 * «Смотрите далее», выходная анимация, стингер, — упиралось в начало.
 * Нулевой источник поэтому не участвует в сравнении.
 */
export function airDurationSeconds(asset: {
  durationSeconds: number;
  declaredDurationSeconds?: number | null;
}): number {
  const source = asset.durationSeconds > 0 ? asset.durationSeconds : null;
  const declared = asset.declaredDurationSeconds && asset.declaredDurationSeconds > 0
    ? asset.declaredDurationSeconds
    : null;
  if (source != null && declared != null) return Math.min(source, declared);
  return declared ?? source ?? 0;
}
