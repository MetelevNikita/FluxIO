import { useEffect, useState } from "react";
import { Folder, Film, ArrowUp } from "lucide-react";
import type { ScheduleSlot } from "../types";

export const mediaBrowserDragType = "application/x-fluxio-media-path";

type BrowserListing = Awaited<ReturnType<NonNullable<Window["gruberDesktop"]>["browseMedia"]>>;

export function MediaFileBrowser({ onAdd }: {
  onAdd: (paths: string[], slot: ScheduleSlot, insertBeforeId?: string | null) => void;
}) {
  const [listing, setListing] = useState<BrowserListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(directoryPath: string | null) {
    const bridge = window.gruberDesktop;
    if (!bridge) return;
    setBusy(true);
    setError(null);
    void bridge.browseMedia(directoryPath)
      .then(setListing)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  }

  useEffect(() => { open(null); }, []);

  return <section className="media-file-browser" aria-label="Медиафайлы на дисках">
    <div className="media-file-browser-heading">
      <button disabled={busy || !listing?.directoryPath} onClick={() => open(listing?.parentPath ?? null)} type="button"><ArrowUp size={14} /> Назад</button>
      <strong title={listing?.directoryPath ?? "Диски"}>{listing?.directoryPath ?? "Диски"}</strong>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {busy ? <p>Чтение папки…</p> : null}
    <div className="media-file-browser-entries">
      {listing?.entries.map((entry) => <div className="media-file-browser-entry" key={entry.path}
        draggable={!entry.directory}
        onDragStart={(event) => {
          if (entry.directory) return;
          event.dataTransfer.setData(mediaBrowserDragType, entry.path);
          event.dataTransfer.effectAllowed = "copy";
        }}>
        <button onClick={() => entry.directory ? open(entry.path) : onAdd([entry.path], "current")}
          title={entry.directory ? `Открыть ${entry.name}` : `Добавить ${entry.name} в Current`}
          type="button">
          {entry.directory ? <Folder size={14} /> : <Film size={14} />}
          <span>{entry.name}</span>
        </button>
        {!entry.directory ? <button onClick={() => onAdd([entry.path], "future")} title="Добавить в Future" type="button">→ Future</button> : null}
      </div>)}
    </div>
    {listing?.truncated ? <small>Показаны первые 2000 элементов. Откройте вложенную папку.</small> : null}
    <small>Перетащите файл в Current или Future либо нажмите на него.</small>
  </section>;
}
