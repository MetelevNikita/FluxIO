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
  status?: string;
}): number {
  // Файла на диске нет — эфирного времени такой ролик не занимает. Строку в
  // расписании он сохраняет (сетку собирал оператор, и выбрасывать её нельзя),
  // но держать за собой минуты, которых в эфире не будет, не имеет права:
  // иначе расписание показывает время выхода, до которого никто не доживёт, а
  // недобор недели прячется за длительностью пропавших роликов.
  if (asset.status === "error") return 0;
  const source = asset.durationSeconds > 0 ? asset.durationSeconds : null;
  const declared = asset.declaredDurationSeconds && asset.declaredDurationSeconds > 0
    ? asset.declaredDurationSeconds
    : null;
  if (source != null && declared != null) return Math.min(source, declared);
  return declared ?? source ?? 0;
}
