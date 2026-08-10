import type { GraphicEffectAsset, LottieEditableProperty } from "@gruber/contracts";
import type { DotLottie as DotLottiePlayer } from "@lottiefiles/dotlottie-web";
import {
  CheckCircle2,
  FileJson2,
  FileVideo2,
  FolderOpen,
  Image,
  Layers3,
  Link2,
  Link2Off,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyLottiePropertyOverrides,
  updateLinkedScaleVector,
} from "../lottie-properties";
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
  onRenderLottie: (effect: GraphicEffectAsset) => Promise<GraphicEffectAsset>;
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
  const [previewEffect, setPreviewEffect] = useState<GraphicEffectAsset | null>(null);
  const [renderNotice, setRenderNotice] = useState<string | null>(null);
  const [targetClipId, setTargetClipId] = useState("");
  const renderNoticeTimer = useRef<number | null>(null);

  const selectedEffect = useMemo(
    () => effects.find((effect) => effect.id === selectedEffectId) ?? effects[0] ?? null,
    [effects, selectedEffectId],
  );

  useEffect(() => {
    if (!selectedEffect) {
      setSelectedEffectId("");
      setDraftEffect(null);
      setPreviewEffect(null);
      return;
    }
    if (selectedEffect.id !== selectedEffectId) setSelectedEffectId(selectedEffect.id);
    setDraftEffect(selectedEffect);
    setPreviewEffect(selectedEffect);
  }, [selectedEffect?.id, selectedEffect?.filePath]);

  useEffect(() => () => {
    if (renderNoticeTimer.current != null) window.clearTimeout(renderNoticeTimer.current);
  }, []);

  useEffect(() => {
    if (!targetClipId || !clips.some((clip) => clip.id === targetClipId)) {
      setTargetClipId(clips[0]?.id ?? "");
    }
  }, [clips, targetClipId]);

  const selectEffect = (effect: GraphicEffectAsset) => {
    setSelectedEffectId(effect.id);
    setDraftEffect(effect);
    setPreviewEffect(effect);
    setRenderNotice(null);
  };

  const renderDraft = async () => {
    if (!draftEffect?.lottie) return;
    try {
      const rendered = await onRenderLottie(draftEffect);
      setDraftEffect(rendered);
      setPreviewEffect(rendered);
      setRenderNotice(`${rendered.name} successfully rendered and added to the current project.`);
      if (renderNoticeTimer.current != null) window.clearTimeout(renderNoticeTimer.current);
      renderNoticeTimer.current = window.setTimeout(() => setRenderNotice(null), 5_000);
    } catch {
      // The parent publishes the actionable render error in the global error panel.
    }
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
              {renderNotice ? (
                <div className="effect-render-notice" role="status">
                  <CheckCircle2 size={17} />
                  <span>{renderNotice}</span>
                  <button aria-label="Close render notification" onClick={() => setRenderNotice(null)} type="button">
                    <X size={13} />
                  </button>
                </div>
              ) : null}
              <div className="effect-inspector-heading">
                <div>
                  <span className="eyebrow">Selected effect</span>
                  <strong title={draftEffect.name}>{draftEffect.name}</strong>
                </div>
                {busy ? <LoaderCircle className="spin" size={18} /> : null}
              </div>

              {draftEffect.lottie ? <LottiePreview effect={previewEffect ?? draftEffect} /> : (
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
                  onRender={() => void renderDraft()}
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
  const animationRef = useRef<DotLottiePlayer | null>(null);
  const playingRef = useRef(true);
  const [source, setSource] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [resolutionKey, setResolutionKey] = useState<PreviewResolutionKey>("1920x1080");
  const resolution = previewResolutions[resolutionKey];

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
        animationRef.current = animation;
        if (!playingRef.current) animation.pause();
        animation.addEventListener("loadError", (event) => setError(event.error.message));
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      if (animationRef.current === animation) animationRef.current = null;
      animation?.destroy();
    };
  }, [source, effect.lottie]);

  const togglePlayback = () => {
    const next = !playing;
    playingRef.current = next;
    setPlaying(next);
    if (next) animationRef.current?.play();
    else animationRef.current?.pause();
  };

  return (
    <div className="lottie-preview-shell">
      <div className="lottie-preview-toolbar">
        <label>
          <span>Preview format</span>
          <select onChange={(event) => setResolutionKey(event.target.value as PreviewResolutionKey)} value={resolutionKey}>
            {Object.entries(previewResolutions).map(([key, value]) => (
              <option key={key} value={key}>{value.label}</option>
            ))}
          </select>
        </label>
        <button className={playing ? "active" : ""} onClick={togglePlayback} type="button">
          {playing ? <Pause size={12} /> : <Play size={12} />}
          {playing ? "Stop animation" : "Start animation"}
        </button>
      </div>
      <div
        className="lottie-preview"
        style={{
          aspectRatio: `${resolution.width} / ${resolution.height}`,
          background: effect.lottie?.backgroundColor === "transparent" ? undefined : effect.lottie?.backgroundColor,
        }}
      >
        <canvas ref={canvasRef} />
        <span>{resolution.label} · RENDERED PREVIEW</span>
        {error ? <em>{error}</em> : null}
      </div>
    </div>
  );
}

const previewResolutions = {
  "720x576": { height: 576, label: "SD · 720×576", width: 720 },
  "1920x1080": { height: 1_080, label: "FHD · 1920×1080", width: 1_920 },
  "3840x2160": { height: 2_160, label: "UHD · 3840×2160", width: 3_840 },
} as const;

type PreviewResolutionKey = keyof typeof previewResolutions;

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
  const textProperties = effect.lottie.properties.filter((property) => property.type === "text");
  const groups = groupProperties(effect.lottie.properties.filter((property) => property.type !== "text"));
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
          ? {
              ...property,
              value: structuredClone(property.originalValue ?? property.value),
              overridden: false,
            }
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
      <section className="lottie-text-editor">
        <div>
          <strong>Editable text</strong>
          <span>{textProperties.length} text field{textProperties.length === 1 ? "" : "s"}</span>
        </div>
        {textProperties.length > 0 ? textProperties.map((property) => (
          <LottiePropertyRow
            key={property.id}
            onChange={(value) => changeProperty(property.id, value)}
            onReset={() => resetProperty(property.id)}
            property={property}
          />
        )) : (
          <p>
            No editable Text Layers or Essential Graphics text slots were found. In After Effects,
            keep the title as a Text Layer and do not convert it to shapes/outlines before Bodymovin export.
          </p>
        )}
      </section>
      <div className="lottie-property-groups">
        {[...groups.entries()].map(([group, properties]) => (
          <details key={group} open={groups.size <= 4}>
            <summary>{group}<span>{properties.length}</span></summary>
            {properties.map((property) => (
              <LottiePropertyRow
                key={property.id}
                onChange={(value) => changeProperty(property.id, value)}
                onReset={() => resetProperty(property.id)}
                property={property}
              />
            ))}
          </details>
        ))}
      </div>
    </section>
  );
}

function LottiePropertyRow({
  onChange,
  onReset,
  property,
}: {
  onChange: (value: LottieEditableProperty["value"]) => void;
  onReset: () => void;
  property: LottieEditableProperty;
}) {
  return (
    <div className={`lottie-property-row ${property.overridden ? "overridden" : ""}`}>
      <label>
        <span title={property.group}>
          {property.type === "text" ? property.group : property.label}
          {property.animated ? <i>ANIMATED</i> : null}
        </span>
        <PropertyInput property={property} onChange={onChange} />
      </label>
      <button disabled={!property.overridden} onClick={onReset} title="Use original JSON value" type="button">
        <RotateCcw size={12} />
      </button>
    </div>
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
    if (property.label.toLowerCase() === "scale") {
      return <ScalePropertyInput property={property} onChange={onChange} />;
    }
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
  if (property.type === "text") {
    return (
      <textarea
        onChange={(event) => onChange(event.target.value.replaceAll("\n", "\r"))}
        rows={2}
        value={String(property.value).replaceAll("\r", "\n")}
      />
    );
  }
  return <input onChange={(event) => onChange(event.target.value)} type="text" value={String(property.value)} />;
}

function ScalePropertyInput({ property, onChange }: {
  property: LottieEditableProperty;
  onChange: (value: LottieEditableProperty["value"]) => void;
}) {
  const values = Array.isArray(property.value) ? property.value : [100, 100];
  const [linked, setLinked] = useState(() => Math.abs((values[0] ?? 100) - (values[1] ?? 100)) < 0.001);
  const maximum = Math.max(400, Math.ceil(Math.max(...values) / 100) * 100);
  const update = (axis: number, rawValue: number) => {
    const value = Number.isFinite(rawValue) ? Math.max(0, Math.min(2_000, rawValue)) : 0;
    onChange(updateLinkedScaleVector(values, axis, value, linked));
  };
  return (
    <span className="lottie-scale-input">
      <button
        className={linked ? "linked" : ""}
        onClick={() => setLinked((current) => !current)}
        title={linked ? "Unlock X/Y scale" : "Link X/Y scale"}
        type="button"
      >
        {linked ? <Link2 size={12} /> : <Link2Off size={12} />}
      </button>
      {[0, 1].map((axis) => (
        <label key={axis}>
          <span>{axis === 0 ? "X" : "Y"}</span>
          <input
            aria-label={`Scale ${axis === 0 ? "X" : "Y"} slider`}
            max={maximum}
            min={0}
            onChange={(event) => update(axis, Number(event.target.value))}
            step="0.1"
            type="range"
            value={values[axis] ?? 100}
          />
          <input
            aria-label={`Scale ${axis === 0 ? "X" : "Y"} percent`}
            max={2_000}
            min={0}
            onChange={(event) => update(axis, Number(event.target.value))}
            step="0.1"
            type="number"
            value={values[axis] ?? 100}
          />
        </label>
      ))}
    </span>
  );
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
