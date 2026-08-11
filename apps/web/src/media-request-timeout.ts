const defaultRequestTimeoutMs = 10_000;
const analysisRequestTimeoutMs = 10 * 60_000;
const playoutPreparationTimeoutMs = 30 * 60_000;

const analysisPrefixes = [
  "/api/effects/analyze",
  "/api/effects/scan",
  "/api/effects/lottie/render",
  "/api/media/probe",
  "/api/media/scan",
  "/api/schedule/parse",
];

export function mediaRequestTimeoutMs(path: string): number {
  if (path.startsWith("/api/playout/start") || path.startsWith("/api/playout/take")) {
    return playoutPreparationTimeoutMs;
  }
  if (analysisPrefixes.some((prefix) => path.startsWith(prefix))) {
    return analysisRequestTimeoutMs;
  }
  return defaultRequestTimeoutMs;
}
