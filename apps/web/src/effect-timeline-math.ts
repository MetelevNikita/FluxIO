export function moveEffectLayerWindow({
  deltaSeconds,
  durationSeconds,
  endSeconds,
  startSeconds,
}: {
  deltaSeconds: number;
  durationSeconds: number;
  endSeconds: number;
  startSeconds: number;
}): { startSeconds: number; endSeconds: number } {
  const duration = Math.max(0.04, durationSeconds);
  const safeStart = Math.min(duration - 0.04, Math.max(0, startSeconds));
  const safeEnd = Math.min(duration, Math.max(safeStart + 0.04, endSeconds));
  const layerDuration = safeEnd - safeStart;
  const nextStart = Math.min(
    duration - layerDuration,
    Math.max(0, safeStart + deltaSeconds),
  );
  return {
    startSeconds: nextStart,
    endSeconds: nextStart + layerDuration,
  };
}
