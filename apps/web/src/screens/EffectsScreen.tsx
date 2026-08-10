import type { GraphicEffectAsset, LottieEditableProperty } from "@gruber/contracts";
import type { DotLottie as DotLottiePlayer } from "@lottiefiles/dotlottie-web";
import {
  FileJson2,
  FileVideo2,
  FolderOpen,
  Image,
  Layers3,
  LoaderCircle,
  Plus,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyLottiePropertyOverrides } from "../lottie-properties";
import { getLottieSource, lottieWasmUrl } from "../media-api";

export interface EffectTargetClip {
  id: string;
  name: string;
  schedule: "Current" | "Future";
}

interface EffectsScreenProps {
  effects: GraphicEffectAsset[];
  clips: EffectTargetClip[];
  busy: boolean;
  message: string | null;
  onSelectFiles?: () => Promise<void>;
  onSelectDirectory?: () => Promise<void>;
  onSelectTitleDirectory?: (effectId: string) => Promise<void>;
  onClearTitleDirectory: (effectId: string) => void;
  onRemove: (effectId: string) => void;
  onRenderLottie: (effect: GraphicEffectAsset) => Promise<void>;
  onAddToEntireProject: (effectId: string) => void;
  onAddToClip: (effectId: string, clipId: string) => void;
}

export function EffectsScreen({
  effects,
  clips,
  busy,
  message,
  onSelectFiles,
  onSelectDirectory,
  onSelectTitleDirectory,
  onClearTitleDirectory,
  onRemove,
  onRenderLottie,
  onAddToEntireProject,
  onAddToClip,
}: EffectsScreenProps) {
  const [selectedEffectId, setSelectedEffectId] = useState("");
  const [draftEffect, setDraftEffect] = useState<GraphicEffectAsset | null>(null);
  const [targetClipId, setTargetClipId] = useState("");

  const selectedEffect = useMemo(
    () => effects.find((effect) => effect.id === selectedEffectId) ?? effects[0] ?? null,
    [effects, selectedEffectId],
  );

  useEffect(() => {
    if (!selectedEffect) {
      setSelectedEffectId("");
      setDraftEffect(null);
      return;
    }
    if (selectedEffect.id !== selectedEffectId) setSelectedEffectId(selectedEffect.id);
    setDraftEffect(selectedEffect);
  }, [selectedEffect?.id, selectedEffect?.filePath]);

  useEffect(() => {
    if (!targetClipId || !clips.some((clip) => clip.id === targetClipId)) {
      setTargetClipId(clips[0]?.id ?? "");
    }
  }, [clips, targetClipId]);

  const selectEffect = (effect: GraphicEffectAsset) => {
    setSelectedEffectId(effect.id);
    setDraftEffect(effect);
  };

  return (
    <main className="effects-screen">
      <section className="effects-library-header">
        <div>
          <span className="eyebrow">Universal graphics project</span>
          <h1>Effects library</h1>
          <p>Import After Effects Lottie JSON, edit operator-safe properties, then assign it to the project or a clip.</p>
        </div>
        <div className="effects-import-actions">
          <button disabled={busy || !onSelectFiles} onClick={() => void onSelectFiles?.()} type="button">
            <Plus size={14} /> Import Lottie / media
          </button>
          <button disabled={busy || !onSelectDirectory} onClick={() => void onSelectDirectory?.()} type="button">
            <FolderOpen size={14} /> Add folder
          </button>
        </div>
      </section>

      {message ? <div className="effects-message">{message}</div> : null}
      {busy && effects.length === 0 ? (
        <div className="effects-empty"><LoaderCircle className="spin" size={24} /> Analyzing and rendering effects…</div>
      ) : effects.length === 0 ? (
        <div className="effects-empty">
          <Layers3 size={30} />
          <strong>No project effects yet</strong>
          <span>Import a Bodymovin/Lottie `.json`, alpha image or alpha video.</span>
        </div>
      ) : (
        <div className="effects-workspace">
          <section className="effects-grid" aria-label="Project effects">
            {effects.map((effect) => (
              <article
                className={`effect-card ${selectedEffect?.id === effect.id ? "selected" : ""}`}
                key={effect.id}
                onClick={() => selectEffect(effect)}
              >
                <div className={`effect-kind-icon ${effect.lottie ? "lottie" : effect.kind}`}>
                  {effect.lottie ? <FileJson2 size={22} /> : effect.kind === "video" ? <FileVideo2 size={22} /> : <Image size={22} />}
                </div>
                <div className="effect-card-summary">
                  <strong title={effect.name}>{effect.name}</strong>
                  <span>{effect.lottie ? "LOTTIE" : effect.kind.toUpperCase()} · {effect.width}×{effect.height}</span>
                  <small>{effect.kind === "video" ? formatDuration(effect.durationSeconds) : "Full clip · static"}</small>
                </div>
                {!effect.lottie ? (
                  <div className="effect-title-source">
                    <span>Per-clip alpha titles</span>
                    <strong title={effect.titleDirectoryPath ?? undefined}>
                      {effect.titleDirectoryPath
                        ? `${shortPath(effect.titleDirectoryPath)} · ${effect.titlePaths.length} files`
                        : "Not assigned"}
                    </strong>
                    <div>
                      <button disabled={busy || !onSelectTitleDirectory} onClick={(event) => {
                        event.stopPropagation();
                        void onSelectTitleDirectory?.(effect.id);
                      }} type="button">
                        <FolderOpen size={12} /> {effect.titleDirectoryPath ? "Change" : "Select folder"}
                      </button>
                      {effect.titleDirectoryPath ? (
                        <button onClick={(event) => {
                          event.stopPropagation();
                          onClearTitleDirectory(effect.id);
                        }} type="button">Clear</button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="effect-lottie-summary">
                    <span>{effect.lottie.properties.length} properties</span>
                    <strong>{effect.lottie.frameRate} fps · v{effect.lottie.version}</strong>
                  </div>
                )}
                <button className="effect-remove-button" aria-label={`Remove ${effect.name}`} onClick={(event) => {
                  event.stopPropagation();
                  onRemove(effect.id);
                }} title="Remove from project" type="button">
                  <Trash2 size={14} />
                </button>
              </article>
            ))}
          </section>

          {draftEffect ? (
            <aside className="effect-inspector">
              <div className="effect-inspector-heading">
                <div>
                  <span className="eyebrow">Selected effect</span>
                  <strong title={draftEffect.name}>{draftEffect.name}</strong>
                </div>
                {busy ? <LoaderCircle className="spin" size={18} /> : null}
              </div>

              {draftEffect.lottie ? <LottiePreview effect={draftEffect} /> : (
                <div className="effect-raster-preview">
                  {draftEffect.kind === "static" ? <Image size={36} /> : <FileVideo2 size={36} />}
                  <span>Existing alpha media uses the standard FX pipeline.</span>
                </div>
              )}

              <section className="effect-assignment-panel">
                <strong>Assignment</strong>
                <button disabled={clips.length === 0} onClick={() => onAddToEntireProject(draftEffect.id)} type="button">
                  <Layers3 size={13} /> Add to entire project
                </button>
                <div>
                  <select aria-label="Target clip" onChange={(event) => setTargetClipId(event.target.value)} value={targetClipId}>
                    {clips.map((clip) => <option key={clip.id} value={clip.id}>{clip.schedule} · {clip.name}</option>)}
                  </select>
                  <button disabled={!targetClipId} onClick={() => onAddToClip(draftEffect.id, targetClipId)} type="button">
                    <Send size={13} /> Add to clip
                  </button>
                </div>
                <small>After assignment, set the exact IN/OUT range in Playlist → Timeline Trimming.</small>
              </section>

              {draftEffect.lottie ? (
                <LottieProperties
                  disabled={busy}
                  effect={draftEffect}
                  onChange={setDraftEffect}
                  onRender={() => void onRenderLottie(draftEffect)}
                />
              ) : null}
            </aside>
          ) : null}
        </div>
      )}
    </main>
  );
}

function LottiePreview({ effect }: { effect: GraphicEffectAsset }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!effect.lottie) return;
    let cancelled = false;
    setError(null);
    void getLottieSource(effect.lottie.sourcePath)
      .then((document) => { if (!cancelled) setSource(document); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [effect.lottie?.sourcePath]);

  useEffect(() => {
    if (!effect.lottie || !source || !canvasRef.current) return;
    let cancelled = false;
    let animation: DotLottiePlayer | null = null;
    const canvas = canvasRef.current;
    void import("@lottiefiles/dotlottie-web")
      .then(({ DotLottie }) => {
        if (cancelled) return;
        DotLottie.setWasmUrl(lottieWasmUrl());
        animation = new DotLottie({
          canvas,
          data: applyLottiePropertyOverrides(source, effect.lottie!.properties),
          autoplay: true,
          backgroundColor: effect.lottie!.backgroundColor,
          layout: { fit: "contain", align: [0.5, 0.5] },
          loop: true,
          renderConfig: { autoResize: true, devicePixelRatio: Math.min(window.devicePixelRatio, 2) },
        });
        animation.addEventListener("loadError", (event) => setError(event.error.message));
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, [source, effect.lottie]);

  return (
    <div className="lottie-preview" style={{ background: effect.lottie?.backgroundColor === "transparent" ? undefined : effect.lottie?.backgroundColor }}>
      <canvas ref={canvasRef} />
      <span>LIVE LOTTIE PREVIEW</span>
      {error ? <em>{error}</em> : null}
    </div>
  );
}

function LottieProperties({
  disabled,
  effect,
  onChange,
  onRender,
}: {
  disabled: boolean;
  effect: GraphicEffectAsset;
  onChange: (effect: GraphicEffectAsset) => void;
  onRender: () => void;
}) {
  if (!effect.lottie) return null;
  const groups = groupProperties(effect.lottie.properties);
  const changeProperty = (propertyId: string, value: LottieEditableProperty["value"]) => {
    if (!effect.lottie) return;
    onChange({
      ...effect,
      lottie: {
        ...effect.lottie,
        properties: effect.lottie.properties.map((property) => property.id === propertyId
          ? { ...property, value, overridden: true }
          : property),
      },
    });
  };
  const resetProperty = (propertyId: string) => {
    if (!effect.lottie) return;
    onChange({
      ...effect,
      lottie: {
        ...effect.lottie,
        properties: effect.lottie.properties.map((property) => property.id === propertyId
          ? { ...property, overridden: false }
          : property),
      },
    });
  };

  return (
    <section className="lottie-properties">
      <div className="lottie-properties-heading">
        <div>
          <strong>Properties</strong>
          <span>{effect.lottie.properties.filter((property) => property.overridden).length} overrides</span>
        </div>
        <button disabled={disabled} onClick={onRender} type="button">Render changes</button>
      </div>
      <div className="lottie-composition-properties">
        <label>
          <span>Transparent background</span>
          <input
            checked={effect.lottie.backgroundColor === "transparent"}
            onChange={(event) => onChange({
              ...effect,
              lottie: effect.lottie ? {
                ...effect.lottie,
                backgroundColor: event.target.checked ? "transparent" : "#000000",
              } : null,
            })}
            type="checkbox"
          />
        </label>
        <label>
          <span>Background</span>
          <input
            disabled={effect.lottie.backgroundColor === "transparent"}
            onChange={(event) => onChange({
              ...effect,
              lottie: effect.lottie ? { ...effect.lottie, backgroundColor: event.target.value } : null,
            })}
            type="color"
            value={effect.lottie.backgroundColor === "transparent" ? "#000000" : effect.lottie.backgroundColor}
          />
        </label>
        <span>{effect.width}×{effect.height} · {effect.lottie.frameRate} fps · {formatDuration(effect.durationSeconds)}</span>
      </div>
      {effect.lottie.warnings.map((warning) => <p className="lottie-warning" key={warning}>{warning}</p>)}
      <div className="lottie-property-groups">
        {[...groups.entries()].map(([group, properties]) => (
          <details key={group} open={groups.size <= 4}>
            <summary>{group}<span>{properties.length}</span></summary>
            {properties.map((property) => (
              <div className={`lottie-property-row ${property.overridden ? "overridden" : ""}`} key={property.id}>
                <label>
                  <span>{property.label}{property.animated ? <i>ANIMATED</i> : null}</span>
                  <PropertyInput property={property} onChange={(value) => changeProperty(property.id, value)} />
                </label>
                <button disabled={!property.overridden} onClick={() => resetProperty(property.id)} title="Use original JSON value" type="button">
                  <RotateCcw size={12} />
                </button>
              </div>
            ))}
          </details>
        ))}
      </div>
    </section>
  );
}

function PropertyInput({ property, onChange }: {
  property: LottieEditableProperty;
  onChange: (value: LottieEditableProperty["value"]) => void;
}) {
  if (property.type === "boolean") {
    return <input checked={Boolean(property.value)} onChange={(event) => onChange(event.target.checked)} type="checkbox" />;
  }
  if (property.type === "color") {
    return <input onChange={(event) => onChange(event.target.value.toUpperCase())} type="color" value={String(property.value)} />;
  }
  if (property.type === "number") {
    return (
      <input
        max={property.max}
        min={property.min}
        onChange={(event) => onChange(Number(event.target.value))}
        step="0.1"
        type="number"
        value={Number(property.value)}
      />
    );
  }
  if (property.type === "vector" && Array.isArray(property.value)) {
    return (
      <span className="lottie-vector-input">
        {property.value.map((value, index) => (
          <input key={index} onChange={(event) => {
            const next = [...property.value as number[]];
            next[index] = Number(event.target.value);
            onChange(next);
          }} step="0.1" type="number" value={value} />
        ))}
      </span>
    );
  }
  return <input onChange={(event) => onChange(event.target.value)} type="text" value={String(property.value)} />;
}

function groupProperties(properties: LottieEditableProperty[]): Map<string, LottieEditableProperty[]> {
  const groups = new Map<string, LottieEditableProperty[]>();
  for (const property of properties) groups.set(property.group, [...(groups.get(property.group) ?? []), property]);
  return groups;
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
