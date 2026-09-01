import type {
  BroadcastEffectKind,
  GraphicEffectAsset,
  SystemFont,
} from "@gruber/contracts";
import {
  Braces,
  CheckCircle2,
  FileJson,
  Layers3,
  Radio,
  LoaderCircle,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  effectBlocker, mapBroadcastTaskRecords, preferredTextFont, sceneShowDurationSeconds,
  summarizeBroadcastTaskMatches,
} from "../broadcast-effects";
import {
  BroadcastEffectInspector,
  BroadcastEffectPreview,
} from "./BroadcastEffectInspector";
import {
  broadcastEffectCatalog,
  broadcastEffectTitle,
  type BroadcastTaskSummary,
} from "../broadcast-effect-catalog";
import { ScenePreview } from "../title-editor/ScenePreview";
import { useI18n } from "../i18n";

interface EffectTargetClip {
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
  onRemove: (effectId: string) => void;
  onAddToEntireProject: (effect: GraphicEffectAsset) => void;
  onAddToClip: (effect: GraphicEffectAsset, clipId: string) => void;
  broadcastTaskSummaries: Record<string, BroadcastTaskSummary>;
  onCreateBroadcastEffect: (kind: BroadcastEffectKind, defaultFont: SystemFont | null) => void;
  onChangeBroadcastEffect: (effect: GraphicEffectAsset) => void;
  onSelectBroadcastTaskFile: (effectId: string) => Promise<void>;
  onSelectTickerSourceFile: (effectId: string) => Promise<void>;
  onSelectStingerFile: (effectId: string) => Promise<void>;
  onSelectDecorationFile: (effectId: string) => Promise<void>;
  /** Открыть редактор титров для сцены эффекта. */
  onEditScene: (effectId: string) => void;
  onSelectStingerSequence: (effectId: string) => Promise<void>;
  onLoadTickerFeed: (effectId: string) => Promise<void>;
  /** Перенести правки в уже назначенные ролики. */
  onApplyBroadcastChanges: (effect: GraphicEffectAsset) => Promise<void>;
  /** Идемпотентно разложить Animation In/Out по всему расписанию из JSON. */
  onApplyBroadcastTaskToProject: (effect: GraphicEffectAsset) => Promise<void>;
  /** Сколько роликов несёт каждый эффект — по его id. */
  assignedClipCounts: Record<string, number>;
  /** Перестановка эффекта в списке: порядок задаёт оператор. */
  onReorder: (movedEffectId: string, beforeEffectId: string | null) => void;
  /** Системные шрифты грузит App: они нужны и при применении эффекта. */
  fonts: SystemFont[];
  fontLoadError: string | null;
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
  onRemove,
  onAddToEntireProject,
  onAddToClip,
  broadcastTaskSummaries,
  onCreateBroadcastEffect,
  onChangeBroadcastEffect,
  onSelectBroadcastTaskFile,
  onSelectTickerSourceFile,
  onSelectStingerFile,
  onSelectDecorationFile,
  onEditScene,
  onSelectStingerSequence,
  onLoadTickerFeed,
  onApplyBroadcastChanges,
  onApplyBroadcastTaskToProject,
  assignedClipCounts,
  onReorder,
  fonts,
  fontLoadError,
}: EffectsScreenProps) {
  const { tr } = useI18n();
  const [draggedEffectId, setDraggedEffectId] = useState<string | null>(null);
  /** Эффект, имя которого правят прямо в списке. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [selectedEffectId, setSelectedEffectId] = useState("");
  const [draftEffect, setDraftEffect] = useState<GraphicEffectAsset | null>(null);
  const [renderNotice, setRenderNotice] = useState<string | null>(null);
  const [targetClipId, setTargetClipId] = useState("");
  const [previewCollapsed, setPreviewCollapsed] = useState(() => window.innerHeight < 800);
  /**
   * Разбор JSON — окно, а не шаг мастера, и открывается кнопкой в «Применении»:
   * там же выбирают файл и по нему раскладывают. Само оно не открывается —
   * раньше открывалось на каждый вход на вкладку.
   */
  const [mappingOpen, setMappingOpen] = useState(false);
  const renderNoticeTimer = useRef<number | null>(null);

  /**
   * Список содержит только эфирные эффекты — других сущностей в библиотеке
   * больше нет.
   *
   * Только фильтр и никакой сортировки: порядок задал оператор, и он же
   * определяет порядок наложения слоёв в кадре.
   */
  const listedEffects = useMemo(
    () => effects.filter((effect) => Boolean(effect.broadcast)),
    [effects],
  );

  const selectedEffect = useMemo(
    () => effects.find((effect) => effect.id === selectedEffectId) ?? listedEffects[0] ?? null,
    [effects, listedEffects, selectedEffectId],
  );
  const broadcastDraftPending = Boolean(
    draftEffect?.broadcast && selectedEffect?.broadcast &&
    JSON.stringify(draftEffect.broadcast) !== JSON.stringify(selectedEffect.broadcast),
  );

  useEffect(() => {
    if (!selectedEffect) {
      setSelectedEffectId("");
      setDraftEffect(null);
      return;
    }
    if (selectedEffect.id !== selectedEffectId) setSelectedEffectId(selectedEffect.id);
    setDraftEffect(selectedEffect);
  }, [selectedEffect?.id, selectedEffect?.name, selectedEffect?.filePath, selectedEffect?.broadcast]);

  useEffect(() => () => {
    if (renderNoticeTimer.current != null) window.clearTimeout(renderNoticeTimer.current);
  }, []);

  useEffect(() => {
    if (!targetClipId || !clips.some((clip) => clip.id === targetClipId)) {
      setTargetClipId(clips[0]?.id ?? "");
    }
  }, [clips, targetClipId]);

  /**
   * Чего не хватает выбранному эффекту. Раньше это выяснялось только при
   * попытке применить — карточка до того выглядела рабочей.
   */
  const draftBlocker = useMemo(
    () => draftEffect ? effectBlocker(draftEffect) : null,
    [draftEffect, effects],
  );


  const selectEffect = (effect: GraphicEffectAsset) => {
    setSelectedEffectId(effect.id);
    setDraftEffect(effect);
    setRenderNotice(null);
  };

  /**
   * Правка настроек эффекта второго уровня.
   *
   * В библиотеку она уходит с небольшой задержкой: без неё каждое нажатие
   * клавиши перерисовывало всё дерево приложения, и ввод в текстовых полях
   * ощутимо запаздывал. На экране сразу виден локальный черновик, поэтому
   * задержка оператору не заметна.
   */
  const taskSummary = draftEffect ? broadcastTaskSummaries[draftEffect.id] ?? null : null;
  /**
   * Сколько роликов расписания найдёт себе запись в файле задания.
   *
   * Считается до применения: «разложить по расписанию» — операция на весь
   * проект, и узнавать, что не совпало ничего, после неё уже поздно.
   */
  const taskMatch = useMemo(() => {
    const mapping = draftEffect?.broadcast?.dataMapping;
    if (!taskSummary || !mapping) return null;
    return summarizeBroadcastTaskMatches(
      mapBroadcastTaskRecords(taskSummary.records, mapping),
      clips.map((clip) => ({ id: clip.id, name: clip.name })),
    );
  }, [taskSummary, draftEffect?.broadcast?.dataMapping, clips]);

  const commitTimer = useRef<number | null>(null);
  /**
   * Применяет черновик выбранным способом.
   *
   * Откуда брать значения — решает нажатая кнопка, а не отдельный селектор
   * «источник текста»: лишний переключатель оператор забывает переставить, и
   * титр выходит в эфир с резервным значением вместо данных задания. Черновик
   * при этом переносится в библиотеку немедленно, не дожидаясь задержки, —
   * иначе применились бы прежние настройки.
   */
  const applyNow = useCallback((
    run: (effect: GraphicEffectAsset) => void,
    source: "manual" | "task-file",
  ) => {
    if (!draftEffect?.broadcast) return;
    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
    const ready: GraphicEffectAsset = draftEffect.broadcast.kind === "dynamic-title"
      ? {
          ...draftEffect,
          broadcast: {
            ...draftEffect.broadcast,
            settings: {
              ...draftEffect.broadcast.settings,
              dynamicTitle: { ...draftEffect.broadcast.settings.dynamicTitle, source },
            },
          },
        }
      : draftEffect;
    setDraftEffect(ready);
    onChangeBroadcastEffect(ready);
    run(ready);
  }, [draftEffect, onChangeBroadcastEffect]);

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
              "Параметрические эффекты с собственным поведением. Оформление живёт внутри эффекта сценой или готовым файлом.",
              "Parametric effects with their own behavior. The design lives inside the effect as a scene or a ready file.",
            )}
          </small>
        </div>
        <div className="broadcast-catalog-actions">
          {broadcastEffectCatalog.map((entry) => (
            <button
              disabled={busy}
              key={entry.kind}
              // Шрифт подставляется сразу: без файла кириллица выходит
              // прямоугольниками, а подложку `fit:` нечем измерить.
              onClick={() => onCreateBroadcastEffect(entry.kind, preferredTextFont(fonts))}
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
                <div className="effect-kind-icon broadcast">
                  <Radio size={22} />
                </div>
                <div className="effect-card-summary">
                  {/* Имя набирает оператор: «Динамическая плашка (2)» ничего не
                      говорит о том, что это за титр, а в списке из двух
                      десятков эффектов различать их больше нечем. */}
                  {renaming === effect.id ? (
                    <input
                      autoFocus
                      className="effect-rename"
                      defaultValue={effect.name}
                      onBlur={(event) => {
                        const name = event.target.value.trim();
                        if (name && name !== effect.name) {
                          onChangeBroadcastEffect({ ...effect, name });
                        }
                        setRenaming(null);
                      }}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") setRenaming(null);
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                    />
                  ) : (
                    <strong
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        setRenaming(effect.id);
                      }}
                      title={tr(
                        `${effect.name} — двойной щелчок переименует`,
                        `${effect.name} — double-click to rename`,
                      )}
                    >
                      {effect.name}
                    </strong>
                  )}
                  <span>
                    {`${tr("УРОВЕНЬ 2", "TIER 2")} · ${broadcastEffectTitle(effect.broadcast!.kind, tr)}`}
                  </span>
                  <small>
                    {effect.broadcast!.scene
                      ? effect.broadcast!.scene.name
                      : effect.broadcast!.decorationFilePath
                        ? shortPath(effect.broadcast!.decorationFilePath)
                        : tr("Оформление не задано", "No design")}
                  </small>
                </div>
                <div className="effect-broadcast-summary">
                  <span>{tr("Поведение", "Behavior")}</span>
                  <strong>{broadcastEffectSummary(effect, tr)}</strong>
                  {effectBlocker(effect) ? (
                    <em className="effect-blocked">
                      <TriangleAlert size={11} /> {effectBlocker(effect)}
                    </em>
                  ) : null}
                </div>
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
                    <input
                      className="effect-name-field"
                      key={`${draftEffect.id}:${draftEffect.name}`}
                      defaultValue={draftEffect.name}
                      onBlur={(event) => {
                        const name = event.target.value.trim();
                        if (name && name !== draftEffect.name) {
                          onChangeBroadcastEffect({ ...draftEffect, name });
                        } else {
                          event.target.value = draftEffect.name;
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                          event.currentTarget.value = draftEffect.name;
                          event.currentTarget.blur();
                        }
                      }}
                      title={tr("Имя эффекта", "Effect name")}
                    />
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

                {/* Превью одно на весь экран эффекта. Двух не бывает: у сцены
                    и макета положения разная правда о кадре, и оператор
                    доверял бы тому, что видит первым. Сцену рисует та же
                    функция, что и эфир, — макет остаётся только там, где
                    оформление задано файлом и рисовать нечего. */}
                {!previewCollapsed ? (
                  draftEffect.broadcast?.scene ? (
                    <ScenePreview
                      durationSeconds={sceneShowDurationSeconds(draftEffect.broadcast)}
                      template={draftEffect.broadcast.scene}
                    />
                  ) : draftEffect.broadcast ? (
                    <BroadcastEffectPreview
                      disabled={busy || draftEffect.broadcast.kind === "stinger-transition"}
                      effect={draftEffect}
                      onPlacementChange={(placement) => changeBroadcastDraft({
                        ...draftEffect,
                        broadcast: { ...draftEffect.broadcast!, placement },
                      })}
                    />
                  ) : (
                    <div className="effect-raster-preview">
                      <Radio size={36} />
                      <span>
                        {tr("Оформление не задано.", "No design yet.")}
                      </span>
                    </div>
                  )
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
                  onLoadTickerFeed={() => void onLoadTickerFeed(draftEffect.id)}
                  onEditScene={() => onEditScene(draftEffect.id)}
                  onSelectDecorationFile={() => void onSelectDecorationFile(draftEffect.id)}
                  onSelectStingerFile={() => void onSelectStingerFile(draftEffect.id)}
                  onSelectStingerSequence={() => void onSelectStingerSequence(draftEffect.id)}
                  onSelectTaskFile={() => void onSelectBroadcastTaskFile(draftEffect.id)}
                  onSelectTickerSource={() => void onSelectTickerSourceFile(draftEffect.id)}
                  taskSummary={broadcastTaskSummaries[draftEffect.id] ?? null}
                  mappingOpen={mappingOpen}
                  onMappingOpenChange={setMappingOpen}
                />
              ) : null}

              {fontLoadError && draftEffect.broadcast ? (
                <p className="broadcast-warning" role="alert">{fontLoadError}</p>
              ) : null}

              {/* Три способа применения в одном месте и в конце — после того,
                  как эффект собран и время задано. Раньше «применить по файлу
                  задания» жило отдельно, внутри шага «Данные», и его находили
                  не все: снаружи это выглядело как «JSON не работает». */}
              <section className="effect-assignment-panel">
                <div className="effect-assignment-heading">
                  <strong>{tr("Применение", "Assignment")}</strong>
                  <span className={draftBlocker ? "dirty" : broadcastDraftPending ? "pending" : "ready"}>
                    {draftBlocker
                      ? tr("не собран", "incomplete")
                      : broadcastDraftPending ? tr("черновик", "draft") : tr("актуально", "up to date")}
                  </span>
                </div>

                <div className="assignment-way">
                  <div className="assignment-way-head">
                    <b>{tr("На один ролик", "On one clip")}</b>
                    <small>{tr("значения полей — те, что заданы выше", "field values as typed above")}</small>
                  </div>
                  <select
                    aria-label={tr("Целевой ролик", "Target clip")}
                    onChange={(event) => setTargetClipId(event.target.value)}
                    value={targetClipId}
                  >
                    {clips.map((clip) => (
                      <option key={clip.id} value={clip.id}>{clip.schedule} · {clip.name}</option>
                    ))}
                  </select>
                  <button
                    disabled={busy || !targetClipId || Boolean(draftBlocker)}
                    onClick={() => applyNow((effect) => onAddToClip(effect, targetClipId), "manual")}
                    title={draftBlocker ?? undefined}
                    type="button"
                  >
                    <Send size={13} /> {tr("Применить", "Apply")}
                  </button>
                </div>

                <div className="assignment-way">
                  <div className="assignment-way-head">
                    <b>{tr("На весь проект", "On the whole project")}</b>
                    <small>
                      {tr(
                        `одни и те же значения на все ролики — ${clips.length}`,
                        `the same values on every clip — ${clips.length}`,
                      )}
                    </small>
                  </div>
                  <button
                    className="assignment-way-wide"
                    disabled={busy || clips.length === 0 || Boolean(draftBlocker)}
                    onClick={() => applyNow(onAddToEntireProject, "manual")}
                    title={draftBlocker ?? undefined}
                    type="button"
                  >
                    <Layers3 size={13} /> {tr("Применить ко всему проекту", "Apply to entire project")}
                  </button>
                </div>

                {draftEffect.broadcast?.scene ? (
                  <div className="assignment-way">
                    <div className="assignment-way-head">
                      <b>{tr("По файлу задания", "From a task file")}</b>
                      <small>
                        {taskMatch
                          ? tr(
                              `совпало ${taskMatch.matchedClipCount} из ${clips.length} роликов`,
                              `${taskMatch.matchedClipCount} of ${clips.length} clips matched`,
                            )
                          : tr("свои значения каждому ролику", "its own values for every clip")}
                      </small>
                    </div>
                    <button
                      className="assignment-way-file"
                      disabled={busy}
                      onClick={() => void onSelectBroadcastTaskFile(draftEffect.id)}
                      type="button"
                    >
                      <FileJson size={12} />
                      {taskSummary ? shortPath(taskSummary.filePath) : tr("Выбрать .json", "Choose .json")}
                    </button>
                    {taskSummary ? (
                      <button
                        className="assignment-way-parser"
                        onClick={() => setMappingOpen(true)}
                        title={tr(
                          "Посмотреть, что прочитано из файла, и связать ключи с полями титра",
                          "Inspect what was read from the file and bind its keys to the title fields",
                        )}
                        type="button"
                      >
                        <Braces size={12} /> {tr("Разбор JSON", "JSON Parser")}
                      </button>
                    ) : null}
                    {taskSummary ? (
                      <label className="assignment-match-key">
                        <span>{tr("Имя ролика в ключе", "Clip name key")}</span>
                        <select
                          onChange={(event) => changeBroadcastDraft({
                            ...draftEffect,
                            broadcast: {
                              ...draftEffect.broadcast!,
                              dataMapping: {
                                ...draftEffect.broadcast!.dataMapping,
                                matchSourceKey: event.target.value,
                              },
                            },
                          })}
                          value={draftEffect.broadcast.dataMapping.matchSourceKey}
                        >
                          {taskSummary.fields.map((field) => (
                            <option key={field.key} value={field.key}>{field.key}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <button
                      className="assignment-way-wide"
                      disabled={busy || !taskSummary || !taskMatch || taskMatch.matchedClipCount === 0
                        || Boolean(draftBlocker)}
                      onClick={() => applyNow(
                        (effect) => void onApplyBroadcastTaskToProject(effect),
                        "task-file",
                      )}
                      title={draftBlocker ?? undefined}
                      type="button"
                    >
                      <FileJson size={13} /> {tr("Разложить по расписанию", "Lay out across the schedule")}
                    </button>
                    {taskSummary && taskMatch ? (
                      <p className="assignment-way-note">
                        {taskMatch.duplicateTitles.length > 0
                          ? tr(
                              `Повторы в ключе «${draftEffect.broadcast.dataMapping.matchSourceKey}»: ${taskMatch.duplicateTitles.slice(0, 3).join(", ")}. Такие ролики пропускаются.`,
                              `Duplicates in “${draftEffect.broadcast.dataMapping.matchSourceKey}”: ${taskMatch.duplicateTitles.slice(0, 3).join(", ")}. Those clips are skipped.`,
                            )
                          : tr(
                              `Записей вне расписания: ${taskMatch.unmatchedRecordCount}; роликов без записи: ${taskMatch.unmatchedClipCount}. Значения берутся по тем же именам, что у полей титра.`,
                              `Records outside the schedule: ${taskMatch.unmatchedRecordCount}; clips without a record: ${taskMatch.unmatchedClipCount}. Values are read by the title's own field names.`,
                            )}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <small>
                  {tr(
                    "Эффект рассчитает окна показа и текст. Точную подгонку по кадрам делайте в Плейлист → Монтаж таймлайна.",
                    "The effect calculates display windows and text. Fine-tune frames in Playlist → Timeline Trimming.",
                  )}
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
