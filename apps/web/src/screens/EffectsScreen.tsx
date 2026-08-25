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
  RotateCcw,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { effectBlocker } from "../broadcast-effects";
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
import { useI18n } from "../i18n";

export interface EffectTargetClip {
  id: string;
  name: string;
  schedule: "Current" | "Future";
}

interface EffectsScreenProps {
  effects: GraphicEffectAsset[];
  clips: EffectTargetClip[];
  busy: boolean;
  operationError: string | null;
  message: string | null;
  onSelectTitleDirectory?: (effectId: string) => Promise<void>;
  onClearTitleDirectory: (effectId: string) => void;
  onRemove: (effectId: string) => void;
  onRenderLottie: (effect: GraphicEffectAsset) => Promise<GraphicEffectAsset>;
  onAddToEntireProject: (effect: GraphicEffectAsset) => void;
  onAddToClip: (effect: GraphicEffectAsset, clipId: string) => void;
  broadcastTaskSummaries: Record<string, BroadcastTaskSummary>;
  onCreateBroadcastEffect: (kind: BroadcastEffectKind) => void;
  onChangeBroadcastEffect: (effect: GraphicEffectAsset) => void;
  onSelectBroadcastTaskFile: (effectId: string) => Promise<void>;
  onSelectTickerSourceFile: (effectId: string) => Promise<void>;
  onSelectStingerFile: (effectId: string) => Promise<void>;
  onSelectStingerSequence: (effectId: string) => Promise<void>;
  onLoadTickerFeed: (effectId: string) => Promise<void>;
  /** Перенести правки в уже назначенные ролики. */
  onApplyBroadcastChanges: (effect: GraphicEffectAsset) => Promise<void>;
  /** Идемпотентно разложить Animation In/Out по всему расписанию из JSON. */
  onApplyBroadcastTaskToProject: (effect: GraphicEffectAsset) => Promise<void>;
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
  operationError,
  message,
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
  onSelectStingerSequence,
  onLoadTickerFeed,
  onApplyBroadcastChanges,
  onApplyBroadcastTaskToProject,
  onImportBroadcastPreset,
  assignedClipCounts,
  onReorder,
  playoutActive,
}: EffectsScreenProps) {
  const { tr } = useI18n();
  const [draggedEffectId, setDraggedEffectId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Системные шрифты запрашиваются один раз за сессию: список большой, а
  // меняется он только при установке шрифтов в систему.
  const [fonts, setFonts] = useState<SystemFont[]>([]);
  const [fontLoadError, setFontLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listSystemFonts()
      .then((items) => {
        if (cancelled) return;
        setFonts(items);
        setFontLoadError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFontLoadError(tr(
            `Не удалось получить системные шрифты: ${String(error)}`,
            `Could not load system fonts: ${String(error)}`,
          ));
        }
      });
    return () => { cancelled = true; };
  }, [tr]);
  const [selectedEffectId, setSelectedEffectId] = useState("");
  const [draftEffect, setDraftEffect] = useState<GraphicEffectAsset | null>(null);
  const [previewEffect, setPreviewEffect] = useState<GraphicEffectAsset | null>(null);
  const [renderNotice, setRenderNotice] = useState<string | null>(null);
  const [targetClipId, setTargetClipId] = useState("");
  const [previewCollapsed, setPreviewCollapsed] = useState(() => window.innerHeight < 800);
  const renderNoticeTimer = useRef<number | null>(null);

  /**
   * В списке живут только эфирные эффекты. Графика уровня 3 осталась в
   * библиотеке — на неё ссылается `presetEffectId`, её нужно рендерить и
   * восстанавливать, — но самостоятельным элементом она быть перестала.
   *
   * Только фильтр и никакой сортировки: порядок в библиотеке задал оператор,
   * и он же определяет порядок наложения слоёв в кадре.
   */
  const listedEffects = useMemo(
    () => effects.filter((effect) => Boolean(effect.broadcast)),
    [effects],
  );

  // Запасной выбор берётся из показанного списка, а не из всей библиотеки:
  // иначе инспектор открыл бы графику, которой в списке уже нет.
  const selectedEffect = useMemo(
    () => effects.find((effect) => effect.id === selectedEffectId) ?? listedEffects[0] ?? null,
    [effects, listedEffects, selectedEffectId],
  );
  const lottieNeedsRender = Boolean(
    draftEffect?.lottie && selectedEffect?.lottie &&
    JSON.stringify({
      backgroundColor: draftEffect.lottie.backgroundColor,
      properties: draftEffect.lottie.properties,
    }) !== JSON.stringify({
      backgroundColor: selectedEffect.lottie.backgroundColor,
      properties: selectedEffect.lottie.properties,
    }),
  );
  const broadcastDraftPending = Boolean(
    draftEffect?.broadcast && selectedEffect?.broadcast &&
    JSON.stringify(draftEffect.broadcast) !== JSON.stringify(selectedEffect.broadcast),
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
  }, [selectedEffect?.id, selectedEffect?.filePath, selectedEffect?.broadcast]);

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
  /**
   * Чего не хватает выбранному эффекту. Раньше это выяснялось только при
   * попытке применить — карточка до того выглядела рабочей.
   */
  const draftBlocker = useMemo(
    () => draftEffect ? effectBlocker(draftEffect, effects) : null,
    [draftEffect, effects],
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
      setRenderNotice(tr(
        `${rendered.name} успешно отрендерен и добавлен в текущий проект.`,
        `${rendered.name} successfully rendered and added to the current project.`,
      ));
      if (renderNoticeTimer.current != null) window.clearTimeout(renderNoticeTimer.current);
      renderNoticeTimer.current = window.setTimeout(() => setRenderNotice(null), 5_000);
    } catch {
      // The parent publishes the actionable render error in the global error panel.
    }
  }, [draftEffect, onRenderLottie, tr]);

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
          <span className="eyebrow">{tr("Графическое оформление эфира", "Broadcast graphics")}</span>
          <h1>{tr("Библиотека эффектов", "Effects library")}</h1>
          <p>{tr("Создайте эфирный эффект, задайте его оформление и настройки, затем назначьте проекту либо ролику.", "Create a broadcast effect, set its design and options, then assign it to the project or a clip.")}</p>
        </div>
      </section>

      <section className="broadcast-catalog" aria-label={tr("Эфирные эффекты", "Broadcast effects")}>
        <div className="broadcast-catalog-heading">
          <span className="broadcast-tier-badge">{tr("Уровень 2", "Tier 2")}</span>
          <strong>{tr("Эфирные эффекты", "Broadcast effects")}</strong>
          <small>
            {tr(
              "Параметрические эффекты с собственным поведением. Уровень 3 — импортированные Lottie-пресеты — служит им оформлением.",
              "Parametric effects with their own behavior. Imported Tier 3 Lottie presets provide their visual design.",
            )}
          </small>
        </div>
        <div className="broadcast-catalog-actions">
          {broadcastEffectCatalog.map((entry) => (
            <button
              disabled={busy}
              key={entry.kind}
              onClick={() => onCreateBroadcastEffect(entry.kind)}
              title={tr(entry.summary, entry.summaryEn)}
              type="button"
            >
              <Radio size={13} /> {tr(entry.titleRu, entry.title)}
            </button>
          ))}
        </div>
      </section>

      {operationError ? <div className="operation-error" role="alert">{operationError}</div> : null}
      {busy ? (
        <div className="effects-message effects-busy-message" role="status">
          <LoaderCircle className="spin" size={13} /> {tr("Обработка выбранного файла…", "Processing selected file…")}
        </div>
      ) : message ? <div className="effects-message">{message}</div> : null}
      {busy && listedEffects.length === 0 ? (
        <div className="effects-empty"><LoaderCircle className="spin" size={24} /> {tr("Анализ и подготовка эффектов…", "Analyzing and preparing effects…")}</div>
      ) : listedEffects.length === 0 ? (
        <div className="effects-empty">
          <Layers3 size={30} />
          <strong>{tr("В проекте пока нет эффектов", "No project effects yet")}</strong>
          <span>{tr("Выберите вид эфирного эффекта в каталоге выше — оформление задаётся внутри него.", "Pick a broadcast effect kind in the catalog above; its design is set inside the effect.")}</span>
        </div>
      ) : (
        <div className="effects-workspace">
          <section
            className="effects-grid"
            aria-label={tr("Эффекты проекта", "Project effects")}
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
            {listedEffects.map((effect) => (
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
                      ? `${tr("УРОВЕНЬ 2", "TIER 2")} · ${broadcastEffectTitle(effect.broadcast.kind, tr)}`
                      : `${effect.lottie ? "LOTTIE" : effect.kind.toUpperCase()} · ${effect.width}×${effect.height}`}
                  </span>
                  <small>
                    {effect.broadcast
                      ? (effect.broadcast.presetEffectId
                          ? effects.find((candidate) => candidate.id === effect.broadcast?.presetEffectId)?.name ??
                            tr("Пресет не найден", "Preset not found")
                          : tr("Без пресета", "No preset"))
                      : effect.kind === "video" ? formatDuration(effect.durationSeconds) : tr("Весь ролик · статика", "Full clip · static")}
                  </small>
                </div>
                {effect.broadcast ? (
                  <div className="effect-broadcast-summary">
                    <span>{tr("Поведение", "Behavior")}</span>
                    <strong>{broadcastEffectSummary(effect, tr)}</strong>
                    {effectBlocker(effect, effects) ? (
                      <em className="effect-blocked">
                        <TriangleAlert size={11} /> {effectBlocker(effect, effects)}
                      </em>
                    ) : null}
                  </div>
                ) : !effect.lottie ? (
                  <div className="effect-title-source">
                    <span>{tr("Alpha-плашки для отдельных роликов", "Per-clip alpha titles")}</span>
                    <strong title={effect.titleDirectoryPath ?? undefined}>
                      {effect.titleDirectoryPath
                        ? `${shortPath(effect.titleDirectoryPath)} · ${effect.titlePaths.length} files`
                        : tr("Не назначено", "Not assigned")}
                    </strong>
                    <div>
                      <button disabled={busy || !onSelectTitleDirectory} onClick={(event) => {
                        event.stopPropagation();
                        void onSelectTitleDirectory?.(effect.id);
                      }} type="button">
                        <FolderOpen size={12} /> {effect.titleDirectoryPath ? tr("Изменить", "Change") : tr("Выбрать папку", "Select folder")}
                      </button>
                      {effect.titleDirectoryPath ? (
                        <button onClick={(event) => {
                          event.stopPropagation();
                          onClearTitleDirectory(effect.id);
                        }} type="button">{tr("Очистить", "Clear")}</button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="effect-lottie-summary">
                    <span>{effect.lottie.properties.length} properties</span>
                    <strong>{effect.lottie.frameRate} fps · v{effect.lottie.version}</strong>
                  </div>
                )}
                <button className="effect-remove-button" aria-label={tr(`Удалить ${effect.name}`, `Remove ${effect.name}`)} onClick={(event) => {
                  event.stopPropagation();
                  onRemove(effect.id);
                }} title={tr("Удалить из проекта", "Remove from project")} type="button">
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
                  <button aria-label={tr("Закрыть уведомление о рендере", "Close render notification")} onClick={() => setRenderNotice(null)} type="button">
                    <X size={13} />
                  </button>
                </div>
              ) : null}
              {/* Шапка с предпросмотром прибита к панели; настройки и применение
                  прокручиваются независимо и остаются доступны на малой высоте. */}
              <div className="effect-inspector-pinned">
                <div className="effect-inspector-heading">
                  <div>
                    <span className="eyebrow">{tr("Выбранный эффект", "Selected effect")}</span>
                    <strong title={draftEffect.name}>{draftEffect.name}</strong>
                  </div>
                  <div className="effect-inspector-heading-actions">
                    <button
                      aria-expanded={!previewCollapsed}
                      onClick={() => setPreviewCollapsed((value) => !value)}
                      type="button"
                    >
                      {previewCollapsed ? tr("Показать превью", "Show preview") : tr("Скрыть превью", "Hide preview")}
                    </button>
                    {busy ? <LoaderCircle className="spin" size={18} /> : null}
                  </div>
                </div>

                {!previewCollapsed && previewSource?.lottie ? (
                  <LottiePreview
                    // Кнопка применения стоит рядом с картинкой, чтобы результат
                    // правки был виден там же, где её запускают.
                    onRender={draftEffect.lottie ? renderLottieDraft : undefined}
                    playoutActive={playoutActive}
                    renderDisabled={busy}
                    effect={previewSource}
                  />
                ) : !previewCollapsed ? (
                  <div className="effect-raster-preview">
                    {draftEffect.broadcast
                      ? <Radio size={36} />
                      : draftEffect.kind === "static" ? <Image size={36} /> : <FileVideo2 size={36} />}
                    <span>
                      {draftEffect.broadcast
                        ? tr("Выберите Lottie-пресет, чтобы увидеть предпросмотр графики.", "Select a Lottie preset to preview the graphics.")
                        : tr("Alpha-медиа использует стандартный FX-конвейер.", "Alpha media uses the standard FX pipeline.")}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="effect-inspector-scroll">
              {draftEffect.broadcast ? (
                <BroadcastEffectInspector
                  assignedClipCount={assignedClipCounts[draftEffect.id] ?? 0}
                  busy={busy}
                  clips={clips}
                  effect={draftEffect}
                  onApplyChanges={() => {
                    // Черновик мог ещё не дойти до библиотеки — переносим его
                    // немедленно, иначе Save применил бы прежние настройки.
                    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
                    onChangeBroadcastEffect(draftEffect);
                    void onApplyBroadcastChanges(draftEffect);
                  }}
                  onChange={changeBroadcastDraft}
                  onApplyTaskToProject={() => {
                    // Массовое применение должно получить именно видимый
                    // черновик mapping, не дожидаясь debounce библиотеки.
                    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
                    onChangeBroadcastEffect(draftEffect);
                    void onApplyBroadcastTaskToProject(draftEffect);
                  }}
                  onImportPreset={() => void onImportBroadcastPreset(draftEffect.id)}
                  fonts={fonts}
                  onLoadTickerFeed={() => void onLoadTickerFeed(draftEffect.id)}
                  onSelectStingerFile={() => void onSelectStingerFile(draftEffect.id)}
                  onSelectStingerSequence={() => void onSelectStingerSequence(draftEffect.id)}
                  onSelectTaskFile={() => void onSelectBroadcastTaskFile(draftEffect.id)}
                  onSelectTickerSource={() => void onSelectTickerSourceFile(draftEffect.id)}
                  presets={presets}
                  taskSummary={broadcastTaskSummaries[draftEffect.id] ?? null}
                />
              ) : null}

              {fontLoadError && draftEffect.broadcast ? (
                <p className="broadcast-warning" role="alert">{fontLoadError}</p>
              ) : null}

              {draftEffect.lottie ? (
                <LottieProperties effect={draftEffect} onChange={setDraftEffect} />
              ) : null}

              <section className="effect-assignment-panel">
                <div className="effect-assignment-heading">
                  <strong>{tr("Применение", "Assignment")}</strong>
                  <span className={draftBlocker ? "dirty" : lottieNeedsRender ? "dirty" : broadcastDraftPending ? "pending" : "ready"}>
                    {draftBlocker
                      ? tr("не собран", "incomplete")
                      : lottieNeedsRender
                        ? tr("нужен рендер", "render required")
                        : broadcastDraftPending ? tr("черновик", "draft") : tr("актуально", "up to date")}
                  </span>
                </div>
                <button
                  disabled={busy || clips.length === 0 || lottieNeedsRender || Boolean(draftBlocker)}
                  onClick={() => {
                    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
                    if (draftEffect.broadcast) onChangeBroadcastEffect(draftEffect);
                    onAddToEntireProject(draftEffect);
                  }}
                  title={draftBlocker ?? (lottieNeedsRender ? tr("Сначала обновите Lottie-рендер", "Update the Lottie render first") : undefined)}
                  type="button"
                >
                  <Layers3 size={13} /> {tr("Применить ко всему проекту", "Apply to entire project")}
                </button>
                <div>
                  <select aria-label={tr("Целевой ролик", "Target clip")} onChange={(event) => setTargetClipId(event.target.value)} value={targetClipId}>
                    {clips.map((clip) => <option key={clip.id} value={clip.id}>{clip.schedule} · {clip.name}</option>)}
                  </select>
                  <button
                    disabled={busy || !targetClipId || lottieNeedsRender || Boolean(draftBlocker)}
                    onClick={() => {
                      if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
                      if (draftEffect.broadcast) onChangeBroadcastEffect(draftEffect);
                      onAddToClip(draftEffect, targetClipId);
                    }}
                    title={draftBlocker ?? (lottieNeedsRender ? tr("Сначала обновите Lottie-рендер", "Update the Lottie render first") : undefined)}
                    type="button"
                  >
                    <Send size={13} /> {tr("Применить к ролику", "Apply to clip")}
                  </button>
                </div>
                <small>
                  {draftEffect.broadcast
                    ? tr("Эффект рассчитает окна показа и текст. Точную подгонку по кадрам делайте в Плейлист → Монтаж таймлайна.", "The effect calculates display windows and text. Fine-tune frames in Playlist → Timeline Trimming.")
                    : tr("После назначения задайте точный диапазон IN/OUT в Плейлист → Монтаж таймлайна.", "After assignment, set the exact IN/OUT range in Playlist → Timeline Trimming.")}
                </small>
              </section>
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
  const { tr } = useI18n();
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
          <span>{tr("Формат превью", "Preview format")}</span>
          <select onChange={(event) => setResolutionKey(event.target.value as PreviewResolutionKey)} value={resolutionKey}>
            {Object.entries(previewResolutions).map(([key, value]) => (
              <option key={key} value={key}>{value.label}</option>
            ))}
          </select>
        </label>
        <button className={playing ? "active" : ""} onClick={togglePlayback} type="button">
          {playing ? <Pause size={12} /> : <Play size={12} />}
          {playing ? tr("Остановить анимацию", "Stop animation") : tr("Запустить анимацию", "Start animation")}
        </button>
        {onRender ? (
          <button className="lottie-render-button" disabled={renderDisabled} onClick={onRender} type="button">
            {tr("Отрендерить изменения", "Render changes")}
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
        <span>{resolution.label} · {tr("ОТРЕНДЕРЕННОЕ ПРЕВЬЮ", "RENDERED PREVIEW")}</span>
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
  const { tr } = useI18n();
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
          <strong>{tr("Свойства", "Properties")}</strong>
          <span>{effect.lottie.properties.filter((property) => property.overridden).length} {tr("изменений", "overrides")}</span>
        </div>
      </div>
      <div className="lottie-composition-properties">
        <label>
          <span>{tr("Прозрачный фон", "Transparent background")}</span>
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
          <span>{tr("Фон", "Background")}</span>
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
          <strong>{tr("Редактируемый текст", "Editable text")}</strong>
          <span>{textProperties.length} {tr("текстовых полей", `text field${textProperties.length === 1 ? "" : "s"}`)}</span>
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
            {tr(
              "Редактируемые Text Layer или текстовые слоты Essential Graphics не найдены. В After Effects оставьте титр текстовым слоем и не преобразуйте его в кривые перед экспортом Bodymovin.",
              "No editable Text Layers or Essential Graphics text slots were found. In After Effects, keep the title as a Text Layer and do not convert it to shapes/outlines before Bodymovin export.",
            )}
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
  const { tr } = useI18n();
  return (
    <div className={`lottie-property-row ${property.overridden ? "overridden" : ""}`}>
      <label>
        <span title={property.group}>
          {property.type === "text" ? property.group : property.label}
          {property.animated ? <i>{tr("АНИМАЦИЯ", "ANIMATED")}</i> : null}
        </span>
        <PropertyInput property={property} onChange={onChange} />
      </label>
      <button disabled={!property.overridden} onClick={onReset} title={tr("Использовать исходное значение JSON", "Use original JSON value")} type="button">
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
  const { tr } = useI18n();
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
        title={linked ? tr("Разъединить масштаб X/Y", "Unlock X/Y scale") : tr("Связать масштаб X/Y", "Link X/Y scale")}
        type="button"
      >
        {linked ? <Link2 size={12} /> : <Link2Off size={12} />}
      </button>
      {[0, 1].map((axis) => (
        <label key={axis}>
          <span>{axis === 0 ? "X" : "Y"}</span>
          <input
            aria-label={tr(`Ползунок масштаба ${axis === 0 ? "X" : "Y"}`, `Scale ${axis === 0 ? "X" : "Y"} slider`)}
            max={maximum}
            min={0}
            onChange={(event) => update(axis, Number(event.target.value))}
            step="0.1"
            type="range"
            value={values[axis] ?? 100}
          />
          <input
            aria-label={tr(`Масштаб ${axis === 0 ? "X" : "Y"} в процентах`, `Scale ${axis === 0 ? "X" : "Y"} percent`)}
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
function broadcastEffectSummary(
  effect: GraphicEffectAsset,
  tr: (russian: string, english: string) => string,
): string {
  const definition = effect.broadcast;
  if (!definition) return "";
  const settings = definition.settings;
  if (definition.kind === "animation-in-out") {
    const mode = settings.animationInOut.mode === "in-out"
      ? "In + Out"
      : settings.animationInOut.mode.toUpperCase();
    return `${mode} · ${settings.animationInOut.durationSeconds} ${tr("с", "s")}` +
      (settings.animationInOut.taskFilePath ? tr(" · файл задания", " · task file") : "");
  }
  if (definition.kind === "dynamic-title") {
    const source = settings.dynamicTitle.source === "task-file"
      ? `${tr("файл", "file")} · ${settings.dynamicTitle.taskKey}`
      : (settings.dynamicTitle.text || tr("текст не задан", "text not set"));
    return `${source} · ${settings.dynamicTitle.durationSeconds} ${tr("с", "s")}`;
  }
  if (definition.kind === "next-program") {
    return tr(
      `За ${settings.nextProgram.startOffsetSeconds} с до конца · ${settings.nextProgram.durationSeconds} с`,
      `${settings.nextProgram.startOffsetSeconds} s before end · ${settings.nextProgram.durationSeconds} s`,
    );
  }
  if (definition.kind === "ticker-crawl") {
    return `${settings.tickerCrawl.items.filter(Boolean).length} ${tr("сообщений", "messages")} · ` +
      `${settings.tickerCrawl.speedPixelsPerSecond} px/${tr("с", "s")}` +
      (settings.tickerCrawl.repeat > 0
        ? ` · ${settings.tickerCrawl.repeat} ${tr("круга", "loops")}`
        : tr(" · непрерывно", " · continuous"));
  }
  if (definition.kind === "clock-countdown") {
    return settings.clockCountdown.mode === "clock"
      ? `${tr("Часы", "Clock")} · ${settings.clockCountdown.format} · UTC${formatOffset(settings.clockCountdown.timezoneOffsetMinutes)}`
      : `${tr("Отсчёт", "Countdown")} ${settings.clockCountdown.countdownSeconds} ${tr("с", "s")} · ${settings.clockCountdown.format}`;
  }
  return `${settings.stingerTransition.durationSeconds} ${tr("с", "s")} · cut ` +
    `${settings.stingerTransition.cutPointSeconds} ${tr("с", "s")} · ${settings.stingerTransition.blendMode}`;
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
