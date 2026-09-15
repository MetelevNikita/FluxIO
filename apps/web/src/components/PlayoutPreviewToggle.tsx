import { useState } from "react";
import { setPlayoutPreview } from "../media-api";
import { usePlayoutStatus } from "../playout-status";

export function PlayoutPreviewToggle() {
  const status = usePlayoutStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = status?.state === "starting" || status?.state === "running";
  const enabled = Boolean(status?.previewPath);

  if (status?.previewPath && !status.previewPath.includes("transport-index.m3u8")) return null;

  return <>
    <button disabled={!running || busy} onClick={() => {
      setBusy(true);
      setError(null);
      void setPlayoutPreview(!enabled)
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
        .finally(() => setBusy(false));
    }} type="button">
      {busy ? "Переключение…" : enabled ? "Отключить эфирное превью" : "Включить эфирное превью"}
    </button>
    {error ? <span role="alert">{error}</span> : null}
  </>;
}
