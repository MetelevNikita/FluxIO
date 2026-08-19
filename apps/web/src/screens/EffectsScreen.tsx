import type {
  BroadcastEffectKind,
  GraphicEffectAsset,
  LottieEditableProperty,
  SystemFont,
} from "@gruber/contracts";
import type { DotLottie as DotLottiePlayer } from "@lottiefiles/dotlottie-web";
import {
  CheckCircle2,
  FileJson2,
  FileVideo2,
  FolderOpen,
  Image,
  Layers3,
  Radio,
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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyLottiePropertyOverrides,
  updateLinkedScaleVector,
} from "../lottie-properties";
import { getLottieSource, listSystemFonts, lottieWasmUrl } from "../media-api";
import {
  BroadcastEffectInspector,
  broadcastEffectCatalog,
  broadcastEffectTitle,
  type BroadcastTaskSummary,
} from "./BroadcastEffectInspector";

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
  broadcastTaskSummaries: Record<string, BroadcastTaskSummary>;
  onCreateBroadcastEffect: (kind: BroadcastEffectKind) => void;
  onChangeBroadcastEffect: (effect: GraphicEffectAsset) => void;
  onSelectBroadcastTaskFile: (effectId: string) => Promise<void>;
  onSelectTickerSourceFile: (effectId: string) => Promise<void>;
  onSelectStingerFile: (effectId: string) => Promise<void>;
  onLoadTickerFeed: (effectId: string) => Promise<void>;
  /** Перенести правки в уже назначенные ролики. */
  onApplyBroadcastChanges: (effectId: string) => Promise<void>;
  /** Подгрузить Lottie и сразу назначить его пресетом этого эффекта. */
  onImportBroadcastPreset: (effectId: string) => Promise<void>;
  /** Сколько роликов несёт каждый эффект — по его id. */
  assignedClipCounts: Record<string, number>;
  /** Перестановка эффекта в списке: порядок задаёт оператор. */
  onReorder: (movedEffectId: string, beforeEffectId: string | null) => void;
  /** Идёт эфир: тяжёлый WASM-предпросмотр в это время не крутим. */
  playoutActive: boolean;
}

/**
 * Экран обёрнут в `memo`: опрос статуса эфира раз в секунду перерисовывает всё
 * дерево приложения, и без этого вкладка перестраивалась под руками оператора.
 * Все обработчики приходят стабильными (`useStableCallback` в App.tsx), поэтому
 * сравнение пропсов реально срабатывает.
 */
export const EffectsScreen = memo(function EffectsScreen({
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
  broadcastTaskSummaries,
  onCreateBroadcastEffect,
  onChangeBroadcastEffect,
  onSelectBroadcastTaskFile,
  onSelectTickerSourceFile,
  onSelectStingerFile,
  onLoadTickerFeed,
  onApplyBroadcastChanges,
  onImportBroadcastPreset,
  assignedClipCounts,
  onReorder,
  playoutActive,
}: EffectsScreenProps) {
  const [draggedEffectId, setDraggedEffectId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Системные шрифты запрашиваются один раз за сессию: список большой, а
  // меняется он только при установке шрифтов в систему.
  const [fonts, setFonts] = useState<SystemFont[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listSystemFonts()
      .then((items) => { if (!cancelled) setFonts(items); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
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

  // Пресетом эффекта второго уровня может быть только эффект уровня 3.
  const presets = useMemo(
    () => effects.filter((effect) => !effect.broadcast),
    [effects],
  );
  const previewSource = useMemo(() => {
    const source = previewEffect ?? draftEffect;
    if (!source) return null;
    if (!source.broadcast) return source;
    return effects.find((candidate) => candidate.id === source.broadcast?.presetEffectId) ?? null;
  }, [effects, draftEffect, previewEffect]);

  const selectEffect = (effect: GraphicEffectAsset) => {
    setSelectedEffectId(effect.id);
    setDraftEffect(effect);
    setPreviewEffect(effect);
    setRenderNotice(null);
  };

  const renderDraft = useCallback(async () => {
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
  }, [draftEffect, onRenderLottie]);

  const renderLottieDraft = useCallback(() => void renderDraft(), [renderDraft]);

  /**
   * Правка настроек эффекта второго уровня.
   *
   * В библиотеку она уходит с небольшой задержкой: без неё каждое нажатие
   * клавиши перерисовывало всё дерево приложения, и ввод в текстовых полях
   * ощутимо запаздывал. На экране сразу виден локальный черновик, поэтому
   * задержка оператору не заметна.
   */
  const commitTimer = useRef<number | null>(null);
  const changeBroadcastDraft = useCallback((next: GraphicEffectAsset) => {
    setDraftEffect(next);
    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => onChangeBroadcastEffect(next), 300);
  }, [onChangeBroadcastEffect]);

  useEffect(() => () => {
    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
  }, []);

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

      <section className="broadcast-catalog" aria-label="Broadcast effects">
        <div className="broadcast-catalog-heading">
          <span className="broadcast-tier-badge">Уровень 2</span>
          <strong>Эфирные эффекты</strong>
          <small>
            Параметрические эффекты с собственным поведением. Уровень 3 —
            импортированные Lottie-пресеты — служит им оформлением.
          </small>
        </div>
        <div className="broadcast-catalog-actions">
          {broadcastEffectCatalog.map((entry) => (
            <button
              disabled={busy}
              key={entry.kind}
              onClick={() => onCreateBroadcastEffect(entry.kind)}
              title={entry.summary}
              type="button"
            >
              <Radio size={13} /> {entry.title}
            </button>
          ))}
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
          <section
            className="effects-grid"
            aria-label="Project effects"
            onDragOver={(event) => { if (draggedEffectId) event.preventDefault(); }}
            onDrop={(event) => {
              // Сброс мимо карточки — перенос в конец списка.
              if (event.target === event.currentTarget && draggedEffectId) {
                event.preventDefault();
                onReorder(draggedEffectId, null);
              }
              setDraggedEffectId(null);
              setDropTargetId(null);
            }}
          >
            {effects.map((effect) => (
              <article
                className={`effect-card ${effect.broadcast ? "broadcast" : ""} ${selectedEffect?.id === effect.id ? "selected" : ""} ${draggedEffectId === effect.id ? "dragging" : ""} ${dropTargetId === effect.id ? "drop-target" : ""}`}
                draggable
                key={effect.id}
                onClick={() => selectEffect(effect)}
                onDragEnd={() => {
                  setDraggedEffectId(null);
                  setDropTargetId(null);
                }}
                onDragLeave={() => setDropTargetId((current) =>
                  current === effect.id ? null : current)}
                onDragOver={(event) => {
                  if (!draggedEffectId || draggedEffectId === effect.id) return;
                  // Без preventDefault браузер не считает элемент целью сброса.
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTargetId(effect.id);
                }}
                onDragStart={(event) => {
                  setDraggedEffectId(effect.id);
                  event.dataTransfer.effectAllowed = "move";
                  // Safari игнорирует перетаскивание без полезной нагрузки.
                  event.dataTransfer.setData("text/plain", effect.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedEffectId && draggedEffectId !== effect.id) {
                    onReorder(draggedEffectId, effect.id);
                  }
                  setDraggedEffectId(null);
                  setDropTargetId(null);
                }}
              >
                <div className={`effect-kind-icon ${effect.broadcast ? "broadcast" : effect.lottie ? "lottie" : effect.kind}`}>
                  {effect.broadcast
                    ? <Radio size={22} />
                    : effect.lottie
                      ? <FileJson2 size={22} />
                      : effect.kind === "video" ? <FileVideo2 size={22} /> : <Image size={22} />}
                </div>
                <div className="effect-card-summary">
                  <strong title={effect.name}>{effect.name}</strong>
                  <span>
                    {effect.broadcast
                      ? `УРОВЕНЬ 2 · ${broadcastEffectTitle(effect.broadcast.kind)}`
                      : `${effect.lottie ? "LOTTIE" : effect.kind.toUpperCase()} · ${effect.width}×${effect.height}`}
                  </span>
                  <small>
                    {effect.broadcast
                      ? (effect.broadcast.presetEffectId
                          ? effects.find((candidate) => candidate.id === effect.broadcast?.presetEffectId)?.name ??
                            "Пресет не найден"
                          : "Без пресета")
                      : effect.kind === "video" ? formatDuration(effect.durationSeconds) : "Full clip · static"}
                  </small>
                </div>
                {effect.broadcast ? (
                  <div className="effect-broadcast-summary">
                    <span>Поведение</span>
                    <strong>{broadcastEffectSummary(effect)}</strong>
                  </div>
                ) : !effect.lottie ? (
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
              {/* Шапка с предпросмотром прибита к панели: прокручивается только
                  блок настроек ниже, начиная с Assignment. */}
              <div className="effect-inspector-pinned">
                <div className="effect-inspector-heading">
                  <div>
                    <span className="eyebrow">Selected effect</span>
                    <strong title={draftEffect.name}>{draftEffect.name}</strong>
                  </div>
                  {busy ? <LoaderCircle className="spin" size={18} /> : null}
                </div>

                {previewSource?.lottie ? (
                  <LottiePreview
                    // Кнопка применения стоит рядом с картинкой, чтобы результат
                    // правки был виден там же, где её запускают.
                    onRender={draftEffect.lottie ? renderLottieDraft : undefined}
                    playoutActive={playoutActive}
                    renderDisabled={busy}
                    effect={previewSource}
                  />
                ) : (
                  <div className="effect-raster-preview">
                    {draftEffect.broadcast
                      ? <Radio size={36} />
                      : draftEffect.kind === "static" ? <Image size={36} /> : <FileVideo2 size={36} />}
                    <span>
                      {draftEffect.broadcast
                        ? "Выберите Lottie-пресет, чтобы увидеть предпросмотр графики."
                        : "Existing alpha media uses the standard FX pipeline."}
                    </span>
                  </div>
                )}
              </div>

              <div className="effect-inspector-scroll">
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
                <small>
                  {draftEffect.broadcast
                    ? "Эффект сам рассчитает окна показа и текст. Точную подгонку по кадрам делайте в Playlist → Timeline Trimming."
                    : "After assignment, set the exact IN/OUT range in Playlist → Timeline Trimming."}
                </small>
              </section>

              {draftEffect.broadcast ? (
                <BroadcastEffectInspector
                  assignedClipCount={assignedClipCounts[draftEffect.id] ?? 0}
                  busy={busy}
                  effect={draftEffect}
                  onApplyChanges={() => {
                    // Черновик мог ещё не дойти до библиотеки — переносим его
                    // немедленно, иначе Save применил бы прежние настройки.
                    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
                    onChangeBroadcastEffect(draftEffect);
                    void onApplyBroadcastChanges(draftEffect.id);
                  }}
                  onChange={changeBroadcastDraft}
                  onImportPreset={() => void onImportBroadcastPreset(draftEffect.id)}
                  fonts={fonts}
                  onLoadTickerFeed={() => void onLoadTickerFeed(draftEffect.id)}
                  onSelectStingerFile={() => void onSelectStingerFile(draftEffect.id)}
                  onSelectTaskFile={() => void onSelectBroadcastTaskFile(draftEffect.id)}
                  onSelectTickerSource={() => void onSelectTickerSourceFile(draftEffect.id)}
                  presets={presets}
                  taskSummary={broadcastTaskSummaries[draftEffect.id] ?? null}
                />
              ) : null}

              {draftEffect.lottie ? (
                <LottieProperties effect={draftEffect} onChange={setDraftEffect} />
              ) : null}
              </div>
            </aside>
          ) : null}
        </div>
      )}
    </main>
  );
});

const LottiePreview = memo(function LottiePreview({
  effect,
  onRender,
  playoutActive = false,
  renderDisabled = false,
}: {
  effect: GraphicEffectAsset;
  onRender?: () => void;
  playoutActive?: boolean;
  renderDisabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<DotLottiePlayer | null>(null);
  const playingRef = useRef(!playoutActive);
  const [source, setSource] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(!playoutActive);
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
          autoplay: !playingRef.current ? false : true,
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
        {onRender ? (
          <button className="lottie-render-button" disabled={renderDisabled} onClick={onRender} type="button">
            Render changes
          </button>
        ) : null}
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
});

const previewResolutions = {
  "720x576": { height: 576, label: "SD · 720×576", width: 720 },
  "1920x1080": { height: 1_080, label: "FHD · 1920×1080", width: 1_920 },
  "3840x2160": { height: 2_160, label: "UHD · 3840×2160", width: 3_840 },
} as const;

type PreviewResolutionKey = keyof typeof previewResolutions;

const LottieProperties = memo(function LottieProperties({
  effect,
  onChange,
}: {
  effect: GraphicEffectAsset;
  onChange: (effect: GraphicEffectAsset) => void;
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
});

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
    // Значение пипетки браузер отдаёт строчными буквами: приводя его к верхнему
    // регистру, мы расходились с DOM и поле переставало слушаться.
    return <input onChange={(event) => onChange(event.target.value)} type="color" value={String(property.value).toLowerCase()} />;
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

/** Одна строка про то, что эффект сделает — чтобы карточку можно было читать не открывая. */
function broadcastEffectSummary(effect: GraphicEffectAsset): string {
  const definition = effect.broadcast;
  if (!definition) return "";
  const settings = definition.settings;
  if (definition.kind === "animation-in-out") {
    const mode = settings.animationInOut.mode === "in-out"
      ? "In + Out"
      : settings.animationInOut.mode.toUpperCase();
    return `${mode} · ${settings.animationInOut.durationSeconds} с` +
      (settings.animationInOut.taskFilePath ? " · файл задания" : "");
  }
  if (definition.kind === "next-program") {
    return `За ${settings.nextProgram.startOffsetSeconds} с до конца · ` +
      `${settings.nextProgram.durationSeconds} с`;
  }
  if (definition.kind === "ticker-crawl") {
    return `${settings.tickerCrawl.items.filter(Boolean).length} сообщений · ` +
      `${settings.tickerCrawl.speedPixelsPerSecond} px/с` +
      (settings.tickerCrawl.repeat > 0 ? ` · ${settings.tickerCrawl.repeat} круга` : " · непрерывно");
  }
  if (definition.kind === "clock-countdown") {
    return settings.clockCountdown.mode === "clock"
      ? `Часы · ${settings.clockCountdown.format} · UTC${formatOffset(settings.clockCountdown.timezoneOffsetMinutes)}`
      : `Отсчёт ${settings.clockCountdown.countdownSeconds} с · ${settings.clockCountdown.format}`;
  }
  return `${settings.stingerTransition.durationSeconds} с · cut ` +
    `${settings.stingerTransition.cutPointSeconds} с · ${settings.stingerTransition.blendMode}`;
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:` +
    `${String(absolute % 60).padStart(2, "0")}`;
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
