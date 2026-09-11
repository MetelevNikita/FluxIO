const defaultRequestTimeoutMs = 10_000;
const analysisRequestTimeoutMs = 10 * 60_000;
const playoutPreparationTimeoutMs = 30 * 60_000;

const analysisPrefixes = [
  "/api/effects/analyze",
  "/api/effects/scan",
  "/api/media/probe",
  "/api/media/scan",
  "/api/schedule/parse",
];

export function mediaRequestTimeoutMs(path: string): number {
  // Горячая замена готовит изменённые ролики тем же путём, что и старт, а
  // правка логотипа меняет все ролики недели: десяти секунд не хватало, и
  // интерфейс сообщал об ошибке замены, которую служба на деле доводила.
  if (["/api/playout/start", "/api/playout/take", "/api/playout/playlist"].some((prefix) => path.startsWith(prefix))) {
    return playoutPreparationTimeoutMs;
  }
  if (analysisPrefixes.some((prefix) => path.startsWith(prefix))) {
    return analysisRequestTimeoutMs;
  }
  return defaultRequestTimeoutMs;
}
