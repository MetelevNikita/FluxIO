export const mpegTsClockOriginSeconds = 3_600;

// FFmpeg's MPEG-TS muxer starts this pipeline at approximately 2 * muxdelay.
// Keep the existing mux timing, then offset only the program MPEG-TS output so
// its first video PTS shares GStreamer's one-hour MPEG-TS clock origin.
export const ffmpegMpegTsMuxDelaySeconds = 0.7;
export const ffmpegMpegTsMuxPreloadSeconds = 0.5;
export const ffmpegMpegTsOutputOffsetSeconds =
  mpegTsClockOriginSeconds - 2 * ffmpegMpegTsMuxDelaySeconds;

export const dvbSubtitleClockToleranceMs = 250;
export const dvbSubtitlePreRollMs = 2_000;
/**
 * Период переполнения PTS: поле 33-битное на частоте 90 кГц, то есть ~26.5 ч.
 *
 * Недельное расписание длиннее в разы, поэтому программное время и настоящий
 * PTS расходятся на целое число периодов, и сравнивать их можно только по
 * модулю.
 */
export const mpegTsPtsWrapMs = (2 ** 33) / 90;

/**
 * Насколько ниже опоры считается переупорядочиванием кадров, а не
 * переполнением счётчика.
 */
export const videoPtsOriginReorderWindowMs = 2_000;

/** Приводит время программной шкалы к настоящему PTS. */
export function wrapPtsMs(ptsMs: number): number {
  const wrapped = ptsMs % mpegTsPtsWrapMs;
  return wrapped < 0 ? wrapped + mpegTsPtsWrapMs : wrapped;
}

/**
 * Опора видео-часов: наименьший PTS, с которого пошёл эфир.
 *
 * Значение ниже опоры принимается только рядом с ней — на величину
 * переупорядочивания кадров. Меньше на часы — это не начало эфира, а
 * переполнение PTS: приняв его за опору, проверка сравнивала бы субтитры с
 * началом новой эпохи и объявляла бы рассинхрон ровно через 26.5 часов работы.
 */
export function resolveVideoPtsOrigin(
  currentMs: number | null,
  observedMs: number,
  reorderWindowMs = videoPtsOriginReorderWindowMs,
): number {
  if (currentMs == null) return observedMs;
  if (observedMs >= currentMs) return currentMs;
  return currentMs - observedMs <= reorderWindowMs ? observedMs : currentMs;
}

export interface DvbSubtitleClockResult {
  clockErrorMs: number;
  expectedSubtitlePtsMs: number;
  synchronized: boolean;
}

export function evaluateDvbSubtitleClock({
  videoPtsOriginMs,
  subtitlePtsMs,
  firstCueStartSeconds,
  configuredOffsetMs,
}: {
  videoPtsOriginMs: number;
  subtitlePtsMs: number;
  firstCueStartSeconds: number;
  configuredOffsetMs: number;
}): DvbSubtitleClockResult {
  // Ожидание живёт на программной шкале и за неделю эфира уходит далеко за
  // ёмкость поля PTS. В транспорте оно приходит уже свёрнутым, поэтому и
  // сравнивать надо свёрнутое: иначе расписание длиннее 26.5 часов само по
  // себе выглядит как сбитые часы.
  const expectedSubtitlePtsMs = wrapPtsMs(
    videoPtsOriginMs + Math.round(firstCueStartSeconds * 1_000) + configuredOffsetMs,
  );
  const clockErrorMs = wrappedPtsDeltaMs(subtitlePtsMs, expectedSubtitlePtsMs);
  return {
    clockErrorMs,
    expectedSubtitlePtsMs,
    synchronized: Math.abs(clockErrorMs) <= dvbSubtitleClockToleranceMs,
  };
}

/**
 * Расхождение двух PTS с учётом переполнения.
 *
 * Остаток берётся по модулю периода, а не одной поправкой: разойтись значения
 * могут на несколько периодов сразу, и одна поправка оставляла от них ровно
 * период — «ошибка -95443717 мс» при часах, сбитых на миллисекунду.
 */
function wrappedPtsDeltaMs(actualMs: number, expectedMs: number): number {
  let delta = (actualMs - expectedMs) % mpegTsPtsWrapMs;
  const halfWrap = mpegTsPtsWrapMs / 2;
  if (delta > halfWrap) delta -= mpegTsPtsWrapMs;
  if (delta < -halfWrap) delta += mpegTsPtsWrapMs;
  return Math.round(delta);
}
