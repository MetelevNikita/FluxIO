import type { GraphicEffectAsset } from "@gruber/contracts";
import {
  FileVideo2,
  FolderOpen,
  Image,
  Layers3,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";

interface EffectsScreenProps {
  effects: GraphicEffectAsset[];
  busy: boolean;
  message: string | null;
  onSelectFiles?: () => Promise<void>;
  onSelectDirectory?: () => Promise<void>;
  onSelectTitleDirectory?: (effectId: string) => Promise<void>;
  onClearTitleDirectory: (effectId: string) => void;
  onRemove: (effectId: string) => void;
}

export function EffectsScreen({
  effects,
  busy,
  message,
  onSelectFiles,
  onSelectDirectory,
  onSelectTitleDirectory,
  onClearTitleDirectory,
  onRemove,
}: EffectsScreenProps) {
  return (
    <main className="effects-screen">
      <section className="effects-library-header">
        <div>
          <span className="eyebrow">Project graphics</span>
          <h1>Effects library</h1>
          <p>Use one shared BG and an optional folder of per-clip alpha titles matched by filename.</p>
        </div>
        <div className="effects-import-actions">
          <button disabled={busy || !onSelectFiles} onClick={() => void onSelectFiles?.()} type="button">
            <Plus size={14} /> Add effects
          </button>
          <button disabled={busy || !onSelectDirectory} onClick={() => void onSelectDirectory?.()} type="button">
            <FolderOpen size={14} /> Add folder
          </button>
        </div>
      </section>

      {message ? <div className="effects-message">{message}</div> : null}
      {busy ? (
        <div className="effects-empty"><LoaderCircle className="spin" size={24} /> Analyzing effects…</div>
      ) : effects.length === 0 ? (
        <div className="effects-empty">
          <Layers3 size={30} />
          <strong>No project effects yet</strong>
          <span>Add full-frame alpha graphics or animated overlays.</span>
        </div>
      ) : (
        <section className="effects-grid">
          {effects.map((effect) => (
            <article className="effect-card" key={effect.id}>
              <div className={`effect-kind-icon ${effect.kind}`}>
                {effect.kind === "video" ? <FileVideo2 size={22} /> : <Image size={22} />}
              </div>
              <div className="effect-card-summary">
                <strong title={effect.name}>{effect.name}</strong>
                <span>BG · {effect.width}×{effect.height}</span>
                <small>{effect.kind === "video" ? formatDuration(effect.durationSeconds) : "Full clip · static"}</small>
              </div>
              <div className="effect-title-source">
                <span>Per-clip alpha titles</span>
                <strong title={effect.titleDirectoryPath ?? undefined}>
                  {effect.titleDirectoryPath
                    ? `${shortPath(effect.titleDirectoryPath)} · ${effect.titlePaths.length} files`
                    : "Not assigned"}
                </strong>
                <div>
                  <button disabled={busy || !onSelectTitleDirectory} onClick={() => void onSelectTitleDirectory?.(effect.id)} type="button">
                    <FolderOpen size={12} /> {effect.titleDirectoryPath ? "Change" : "Select folder"}
                  </button>
                  {effect.titleDirectoryPath ? (
                    <button onClick={() => onClearTitleDirectory(effect.id)} type="button">Clear</button>
                  ) : null}
                </div>
              </div>
              <button className="effect-remove-button" aria-label={`Remove ${effect.name}`} onClick={() => onRemove(effect.id)} title="Remove from project" type="button">
                <Trash2 size={14} />
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function shortPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length <= 2 ? value : `…/${parts.slice(-2).join("/")}`;
}

function formatDuration(seconds: number): string {
  const totalFrames = Math.round(seconds * 25);
  const hours = Math.floor(totalFrames / 90_000);
  const minutes = Math.floor((totalFrames % 90_000) / 1_500);
  const secs = Math.floor((totalFrames % 1_500) / 25);
  const frames = totalFrames % 25;
  return [hours, minutes, secs, frames]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
