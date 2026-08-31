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
export const mpegTsPtsWrapMs = (2 ** 33) / 90;

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
  const expectedSubtitlePtsMs = videoPtsOriginMs +
    Math.round(firstCueStartSeconds * 1_000) + configuredOffsetMs;
  const clockErrorMs = wrappedPtsDeltaMs(subtitlePtsMs, expectedSubtitlePtsMs);
  return {
    clockErrorMs,
    expectedSubtitlePtsMs,
    synchronized: Math.abs(clockErrorMs) <= dvbSubtitleClockToleranceMs,
  };
}

function wrappedPtsDeltaMs(actualMs: number, expectedMs: number): number {
  let delta = actualMs - expectedMs;
  const halfWrap = mpegTsPtsWrapMs / 2;
  if (delta > halfWrap) delta -= mpegTsPtsWrapMs;
  if (delta < -halfWrap) delta += mpegTsPtsWrapMs;
  return Math.round(delta);
}
