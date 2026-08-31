import {
  sceneFormatSchema,
  sceneSegmentAt,
  sceneTiming,
  trackValueAt,
  type SceneLayoutTarget,
  type SceneBezier,
  type SceneKeyframe,
  type SceneNode,
  type SceneNodeKind,
  type SceneTemplate,
  type SystemFont,
} from "@gruber/contracts";
import {
  AlertTriangle, Check, Circle, FileDown, FileUp, Film, FolderOpen, Image as ImageIcon,
  Group, Maximize2, Minimize2, Redo2, Undo2, Ungroup,
  KeyRound, Ruler, Save, Sparkles, Square, Type, X,
} from "lucide-react";
import {
  memo, useEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
} from "react";
import { SceneCanvas } from "../title-editor/SceneCanvas";
import { SceneInspector, type KeyableTrack } from "../title-editor/SceneInspector";
import { SceneTimeline, type TrackKey } from "../title-editor/SceneTimeline";
import { SceneTree } from "../title-editor/SceneTree";
import { useSceneHistory } from "../title-editor/useSceneHistory";
import {
  addNode, applyLayoutEdit, applyPreset, copyNode, createSceneNode, declareField, descendantIds,
  editTrackAt,
  groupNodes, moveKeyframes, moveNode, pasteNode, removeField, removeKeyframe, removeNode,
  sampleFieldValues, sceneIssues, setKeyframe, setKeyframeEasing,
  trackIsAnimated, ungroupNode, updateNode,
  type SceneNodeClipboard, type ScenePreset, type SceneSegmentSide,
} from "../scene-edit";
import { useI18n } from "../i18n";
import { layoutFormats, layoutTitles } from "../scene-layouts";
import { LanguageSelector } from "../components/LanguageSelector";

/* -------------------------------------------------------------------------- *
 * Редактор титров.
 *
 * Раскладка та же, что у эфирных титровальников, из которых сюда придёт
 * оператор: слои слева, холст в середине, свойства справа, время внизу.
 * Отличие одно и оно принципиальное — **раскладочные цели**: один шаблон
 * обязан выйти в эфир в 4:3, 16:9, HD и UHD, поэтому переключатель формата
 * стоит над холстом, а правки в выбранной цели ложатся поправкой.
 * ------------------------------------------------------------------------- */

const nodeButtons: { kind: SceneNodeKind; icon: typeof Square; ru: string; en: string }[] = [
  { kind: "text", icon: Type, ru: "Текст", en: "Text" },
  { kind: "rect", icon: Square, ru: "Прямоугольник", en: "Rectangle" },
  { kind: "ellipse", icon: Circle, ru: "Эллипс", en: "Ellipse" },
  { kind: "image", icon: ImageIcon, ru: "Картинка", en: "Image" },
  { kind: "video", icon: Film, ru: "Видео с альфой", en: "Alpha video" },
];

const presets: { preset: ScenePreset; ru: string; en: string }[] = [
  { preset: "fade", ru: "Проявление", en: "Fade" },
  { preset: "slide-left", ru: "Выезд слева", en: "Slide in" },
  { preset: "slide-up", ru: "Выезд снизу", en: "Rise" },
  { preset: "wipe", ru: "Развёртка", en: "Wipe" },
  { preset: "reveal", ru: "Раскрытие", en: "Reveal" },
];

const defaultPaneSizes = { left: 268, right: 300, timeline: 250 };
const paneStorageKey = "fluxio-title-editor-panes";

interface TitleEditorScreenProps {
  template: SceneTemplate;
  fonts: SystemFont[];
  /** Кадр из плейлиста под сценой — чтобы видеть титр на реальной картинке. */
  backdropUrl: string | null;
  /** Длительность показа, которую эффект задаёт своим настройкам. */
  durationSeconds: number;
  busy: boolean;
  onChange: (template: SceneTemplate) => void;
  /** Длина показа живёт в настройках эффекта, а не в сцене. */
  onDurationChange: (seconds: number) => void;
  /** Выбор подложки: видео с альфой или последовательность `.png`. */
  onPickMedia: (nodeId: string) => void;
  /** Импорт top-level layers из PDF или PDF-compatible Illustrator. */
  onImportVector: () => void;
  /** Сохранить шаблон отдельным файлом `.fto`. */
  onSaveAs: () => void;
  /** Открыть каталог готовых титров. */
  onOpenLibrary: () => void;
  onSave: () => void;
  onClose: () => void;
}

export const TitleEditorScreen = memo(function TitleEditorScreen({
  template, fonts, backdropUrl, durationSeconds, busy,
  onChange, onDurationChange, onPickMedia, onImportVector, onSaveAs, onOpenLibrary, onSave, onClose,
}: TitleEditorScreenProps) {
  const { tr } = useI18n();
  /**
   * Выделение одним состоянием: активный узел и остальные выбранные.
   *
   * Двумя состояниями это уже ломалось — при Ctrl-щелчке второй вызов читал
   * прежний активный узел из устаревшего замыкания, и набор не набирался.
   */
  const [selection, setSelection] = useState<{ activeId: string | null; others: string[] }>({
    activeId: null,
    others: [],
  });
  const clipboard = useRef<SceneNodeClipboard | null>(null);
  const selectedId = selection.activeId;
  const selectedIds = useMemo(
    () => (selection.activeId ? [...selection.others, selection.activeId] : selection.others),
    [selection],
  );

  /** Щелчок по узлу: обычный меняет активный, Ctrl добавляет к набору. */
  function selectNode(nodeId: string | null, additive = false) {
    setSelection((current) => {
      if (!nodeId) return { activeId: null, others: [] };
      if (!additive) return { activeId: nodeId, others: [] };
      const others = current.others.filter((id) => id !== nodeId);
      if (current.activeId && current.activeId !== nodeId) others.push(current.activeId);
      return { activeId: nodeId, others };
    });
  }

  const [target, setTarget] = useState<SceneLayoutTarget>(template.targets[0] ?? "hd");
  /** `null` — правим общую сцену; иначе правки идут поправкой этой цели. */
  const [editTarget, setEditTarget] = useState<SceneLayoutTarget | null>(null);
  const [timeSeconds, setTimeSeconds] = useState(0);
  /** Нарисованная коробка выделенного узла — приходит с холста. */
  const [drawnBox, setDrawnBox] = useState<{ width: number; height: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showSafe, setShowSafe] = useState(true);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  /**
   * Крупный предпросмотр.
   *
   * По умолчанию холст ужат в пользу дорожек времени: ключи ставят чаще, чем
   * разглядывают кадр. Разглядеть кадр всё равно надо — поэтому холст
   * увеличивается по кнопке, а не занимает экран постоянно.
   */
  const [zoomedPreview, setZoomedPreview] = useState(false);
  const [paneSizes, setPaneSizes] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(paneStorageKey) ?? "null") as Partial<typeof defaultPaneSizes> | null;
      return saved ? { ...defaultPaneSizes, ...saved } : defaultPaneSizes;
    } catch {
      return defaultPaneSizes;
    }
  });
  useEffect(() => {
    window.localStorage.setItem(paneStorageKey, JSON.stringify(paneSizes));
  }, [paneSizes]);
  // Длина показа приходит из настроек эффекта и туда же возвращается: в эфире
  // режиссёр считает удержание именно от неё.
  const duration = durationSeconds;

  const format = useMemo(
    () => sceneFormatSchema.parse({ layout: target, ...layoutFormats[target] }),
    [target],
  );

  // Узлы, скрытые в редакторе, из шаблона не вынимаются: скрытие — оснастка,
  // а не свойство сцены, и в эфир оно не уходит. Скрытая группа уносит с собой
  // содержимое: без этого «глаз» на группе гасил бы пустой узел-родитель, а
  // плашка оставалась бы в кадре.
  const visible = useMemo<SceneTemplate>(() => {
    if (hiddenIds.size === 0) return template;
    const family = new Set<string>();
    for (const id of hiddenIds) for (const member of descendantIds(template, id)) family.add(member);
    return { ...template, nodes: template.nodes.filter((node) => !family.has(node.id)) };
  }, [template, hiddenIds]);

  const selected = template.nodes.find((node) => node.id === selectedId) ?? null;
  const fields = useMemo(() => sampleFieldValues(template), [template]);
  const issues = useMemo(() => sceneIssues(template, format, tr), [template, format, tr]);
  const errors = issues.filter((issue) => issue.severity === "error");

  /**
   * Правка шаблона с записью в историю.
   *
   * `commit` закрывает шаг сразу: у структурных правок — добавления, удаления,
   * перестановки — сливать нечего, а у перетаскивания подряд идущие правки
   * сливаются в один шаг.
   */
  const history = useSceneHistory(template, onChange);
  const patch = (next: SceneTemplate, commit = false) => {
    history.push(next, commit);
    onChange(next);
  };

  function addKind(kind: SceneNodeKind) {
    const node = createSceneNode(template, kind, tr);
    patch(addNode(template, node), true);
    selectNode(node.id);
  }

  /** Холст присылает готовый узел — считать его от текущего шаблона нельзя. */
  function transform(nodeId: string, node: SceneNode) {
    patch(updateNode(template, nodeId, () => node));
  }

  function keyframeEasing(
    nodeId: string, key: TrackKey, side: SceneSegmentSide, atSeconds: number,
    easing: SceneKeyframe["easing"], bezier?: SceneBezier,
  ) {
    patch(updateNode(template, nodeId, (node) => ({
      ...node,
      transform: {
        ...node.transform,
        [key]: setKeyframeEasing(node.transform[key], side, atSeconds, easing, bezier),
      },
    })));
  }

  function shiftKeyframes(moves: readonly {
    nodeId: string; key: TrackKey; side: SceneSegmentSide;
    fromSeconds: number; toSeconds: number;
  }[]) {
    let next = template;
    for (const move of moves) {
      if (moves.some((candidate) => candidate !== move && candidate.nodeId === move.nodeId &&
        candidate.key === move.key && candidate.side === move.side &&
        moves.indexOf(candidate) < moves.indexOf(move))) continue;
      const laneMoves = moves.filter((candidate) => candidate.nodeId === move.nodeId &&
        candidate.key === move.key && candidate.side === move.side);
      next = updateNode(next, move.nodeId, (node) => ({
        ...node,
        transform: {
          ...node.transform,
          [move.key]: moveKeyframes(node.transform[move.key], move.side, laneMoves),
        },
      }));
    }
    patch(next);
  }

  function dropKeyframe(nodeId: string, key: TrackKey, side: SceneSegmentSide, atSeconds: number) {
    patch(updateNode(template, nodeId, (node) => ({
      ...node,
      transform: { ...node.transform, [key]: removeKeyframe(node.transform[key], side, atSeconds) },
    })));
  }

  // Где сейчас стоит головка: ключ ставится в свой отрезок, а в удержании их
  // не бывает — оно растягивается под длительность показа.
  const timing = sceneTiming(template.director, duration);
  const segment = sceneSegmentAt(timing, timeSeconds);
  const keySide: SceneSegmentSide = segment.segment === "out" ? "out" : "in";
  const keyAt = segment.segment === "hold" ? timing.inSeconds : segment.localSeconds;

  const keyframes = {
    enabled: segment.segment !== "hold" && selected !== null,
    value: (track: KeyableTrack): number => selected
      ? trackValueAt(selected.transform[track], timing, timeSeconds)
      : 0,
    commit: (track: KeyableTrack, value: number) => {
      if (!selected) return;
      patch(updateNode(template, selected.id, (node) => {
        if (editTarget && (track === "x" || track === "y" || track === "width" || track === "height")) {
          return applyLayoutEdit(node, editTarget, { [track]: value });
        }
        return {
          ...node,
          transform: {
            ...node.transform,
            [track]: editTrackAt(node.transform[track], keySide, keyAt, value),
          },
        };
      }));
    },
    at: (track: KeyableTrack): "here" | "animated" | "none" => {
      if (!selected) return "none";
      const list = keySide === "in"
        ? selected.transform[track].inKeyframes
        : selected.transform[track].outKeyframes;
      if (list.some((frame) => Math.abs(frame.atSeconds - keyAt) < 0.02)) return "here";
      return trackIsAnimated(selected.transform[track]) ? "animated" : "none";
    },
    toggle: (track: KeyableTrack) => {
      if (!selected) return;
      const list = keySide === "in"
        ? selected.transform[track].inKeyframes
        : selected.transform[track].outKeyframes;
      const existing = list.find((frame) => Math.abs(frame.atSeconds - keyAt) < 0.02);
      patch(updateNode(template, selected.id, (node) => ({
        ...node,
        transform: {
          ...node.transform,
          [track]: existing
            ? removeKeyframe(node.transform[track], keySide, existing.atSeconds)
            : setKeyframe(
              node.transform[track], keySide, keyAt,
              trackValueAt(node.transform[track], timing, timeSeconds),
            ),
        },
      })), true);
    },
  };

  /**
   * Монтажные сочетания работают везде, кроме полей ввода.
   *
   * Так устроен любой монтажный стол, из которого сюда придёт дизайнер. Ввод
   * при этом трогать нельзя: пробел в имени слоя или в строке титра обязан
   * оставаться пробелом, поэтому поля ввода и правка текста прямо в кадре
   * забирают нажатие себе.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (command && key === "c" && selectedId) {
        clipboard.current = copyNode(template, selectedId);
        event.preventDefault();
        return;
      }
      if (command && key === "v" && clipboard.current) {
        const pasted = pasteNode(template, clipboard.current, tr("копия", "copy"));
        if (pasted.nodeId) {
          patch(pasted.template, true);
          selectNode(pasted.nodeId);
        }
        event.preventDefault();
        return;
      }
      if (!command && !event.altKey && (event.key === "Delete" || event.key === "Backspace")) {
        if (tag === "BUTTON" || selectedIds.length === 0) return;
        let next = template;
        for (const id of selectedIds) next = removeNode(next, id);
        patch(next, true);
        selectNode(null);
        event.preventDefault();
        return;
      }
      if (event.code === "Space" && !event.repeat && !command && !event.altKey && tag !== "BUTTON") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, selectedIds, template, tr]);

  return (
    <div
      className="title-editor"
      style={{
        "--title-left-width": `${paneSizes.left}px`,
        "--title-right-width": `${paneSizes.right}px`,
        "--title-timeline-height": `${paneSizes.timeline}px`,
      } as CSSProperties}
    >
      <header className="title-editor-head">
        <div className="title-editor-title">
          <Sparkles size={14} />
          <input
            onChange={(event) => patch({ ...template, name: event.target.value || template.name })}
            value={template.name}
          />
          <span className="title-editor-count">
            {tr(`узлов: ${template.nodes.length}`, `${template.nodes.length} nodes`)}
          </span>
        </div>

        <div className="title-editor-targets">
          {(Object.keys(layoutFormats) as SceneLayoutTarget[]).map((entry) => {
            const declared = template.targets.includes(entry);
            return (
              <button
                className={`${entry === target ? "active" : ""} ${declared ? "" : "undeclared"}`}
                key={entry}
                onClick={() => setTarget(entry)}
                title={declared
                  ? tr("Раскладка заявлена в шаблоне", "Declared in the template")
                  : tr("Раскладка не заявлена — правки в ней в эфир не пойдут", "Not declared — edits here will not reach air")}
                type="button"
              >
                {layoutTitles[entry]}
              </button>
            );
          })}
        </div>

        <div className="title-editor-actions">
          <LanguageSelector />
          <button
            className={showSafe ? "active" : ""}
            onClick={() => setShowSafe((value) => !value)}
            title={tr("Безопасные зоны вещания", "Broadcast safe areas")}
            type="button"
          >
            <Ruler size={12} />
          </button>
          <button
            disabled={!history.canUndo}
            onClick={() => history.undo()}
            title={tr("Отменить · Ctrl+Z", "Undo · Ctrl+Z")}
            type="button"
          >
            <Undo2 size={12} />
          </button>
          <button
            disabled={!history.canRedo}
            onClick={() => history.redo()}
            title={tr("Вернуть · Ctrl+Shift+Z", "Redo · Ctrl+Shift+Z")}
            type="button"
          >
            <Redo2 size={12} />
          </button>
          <button
            disabled={busy}
            onClick={onOpenLibrary}
            title={tr("Загрузить готовый титр", "Load a saved title")}
            type="button"
          >
            <FolderOpen size={12} />
          </button>
          <button
            disabled={busy}
            onClick={onSaveAs}
            title={tr("Сохранить как файл .fto", "Save as a .fto file")}
            type="button"
          >
            <FileDown size={12} />
          </button>
          <button className="title-editor-save" disabled={busy || errors.length > 0} onClick={onSave} type="button">
            <Save size={12} /> {tr("Сохранить", "Save")}
          </button>
          <button onClick={onClose} title={tr("Закрыть без сохранения", "Close without saving")} type="button">
            <X size={13} />
          </button>
        </div>
      </header>

      <div className="title-editor-body">
        <div className="title-editor-left">
          <SceneTree
            hiddenIds={hiddenIds}
            onDuplicate={(id) => {
              const copied = copyNode(template, id);
              if (!copied) return;
              const pasted = pasteNode(template, copied, tr("копия", "copy"));
              patch(pasted.template, true);
              if (pasted.nodeId) selectNode(pasted.nodeId);
            }}
            onRemove={(id) => { patch(removeNode(template, id), true); if (id === selectedId) selectNode(null); }}
            onRename={(id, name) => patch(updateNode(template, id, (node) => ({ ...node, name })))}
            onMove={(moved, parentId, before) => patch(moveNode(template, moved, parentId, before), true)}
            onSelect={selectNode}
            onToggleHidden={(id) => setHiddenIds((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
            selectedId={selectedId}
            selectedIds={selectedIds}
            template={template}
          />

          {/* Группа — узел-родитель: анимация ставится на него, дети едут
              вместе. Иначе одинаковые ключи пришлось бы держать на каждом
              узле, и рано или поздно они разъедутся. */}
          <div className="scene-group-row">
            <button
              disabled={selectedIds.length < 2}
              onClick={() => {
                const result = groupNodes(template, selectedIds, tr("Группа", "Group"));
                if (!result.groupId) return;
                patch(result.template, true);
                selectNode(result.groupId);
              }}
              title={selectedIds.length < 2
                ? tr("Выберите два узла и более: Ctrl-щелчок добавляет к выбору", "Select two or more: Ctrl-click adds to the selection")
                : tr(`Объединить ${selectedIds.length} узла(ов) в группу`, `Group ${selectedIds.length} nodes`)}
              type="button"
            >
              <Group size={12} /> {tr("В группу", "Group")}
              {selectedIds.length > 1 ? <i>{selectedIds.length}</i> : null}
            </button>
            <button
              disabled={selected?.kind !== "group"}
              onClick={() => selected && patch(ungroupNode(template, selected.id), true)}
              title={tr("Распустить группу", "Ungroup")}
              type="button"
            >
              <Ungroup size={12} /> {tr("Распустить", "Ungroup")}
            </button>
          </div>

          <div className="scene-add-row">
            {nodeButtons.map(({ kind, icon: Icon, ru, en }) => (
              <button key={kind} onClick={() => addKind(kind)} title={tr(ru, en)} type="button">
                <Icon size={13} />
              </button>
            ))}
            <button
              disabled={busy}
              onClick={onImportVector}
              title={tr("Импортировать слои .ai/.pdf", "Import layered .ai/.pdf")}
              type="button"
            >
              <FileUp size={13} />
            </button>
          </div>

          <SceneFields
            onDeclare={() => selected && patch(declareField(template, selected.id, selected.name), true)}
            onRemove={(key) => patch(removeField(template, key), true)}
            onSample={(key, sample) => patch({
              ...template,
              fields: template.fields.map((field) => (field.key === key ? { ...field, sample } : field)),
            })}
            selectedIsText={selected?.kind === "text" && selected.text?.kind === "static"}
            template={template}
          />
        </div>

        <PanelDivider
          orientation="vertical"
          value={paneSizes.left}
          onDelta={(delta) => setPaneSizes((current) => ({
            ...current,
            left: clampPane(current.left + delta, 200, Math.min(480, window.innerWidth - current.right - 440)),
          }))}
          onReset={() => setPaneSizes((current) => ({ ...current, left: defaultPaneSizes.left }))}
        />

        <div className={`title-editor-center ${zoomedPreview ? "zoomed" : ""}`}>
          <div className="scene-edit-target">
            <span>{tr("Правки идут", "Edits land")}</span>
            <button className={editTarget === null ? "active" : ""} onClick={() => setEditTarget(null)} type="button">
              {tr("в общую сцену", "in the shared scene")}
            </button>
            <button className={editTarget === target ? "active" : ""} onClick={() => setEditTarget(target)} type="button">
              {tr(`поправкой ${layoutTitles[target]}`, `as a ${layoutTitles[target]} override`)}
            </button>
            <button
              className={`scene-zoom-toggle ${zoomedPreview ? "active" : ""}`}
              onClick={() => setZoomedPreview((value) => !value)}
              title={zoomedPreview
                ? tr("Вернуть место дорожкам времени", "Give the room back to the tracks")
                : tr("Разглядеть кадр крупнее", "Look at the frame larger")}
              type="button"
            >
              {zoomedPreview ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
              {zoomedPreview ? tr("Уменьшить кадр", "Shrink frame") : tr("Увеличить кадр", "Enlarge frame")}
            </button>
          </div>

          <SceneCanvas
            backdropUrl={backdropUrl}
            durationSeconds={duration}
            fields={fields}
            format={format}
            onSelect={selectNode}
            onEditText={(node, value) => {
              // Статичная строка живёт в самом узле, привязанная — в образце
              // поля: править надо то, что рисуется, иначе правка не видна.
              if (node.text?.kind === "static") {
                patch(updateNode(template, node.id, (entry) => ({
                  ...entry,
                  text: { kind: "static", text: value },
                })));
                return;
              }
              if (node.text?.kind === "field") {
                const key = node.text.fieldKey;
                patch({
                  ...template,
                  fields: template.fields.map((field) => (
                    field.key === key ? { ...field, sample: value } : field
                  )),
                });
              }
            }}
            editTarget={editTarget}
            onSelectedBox={setDrawnBox}
            onTransform={transform}
            selectedId={selectedId}
            selectedIds={selectedIds}
            showSafeAreas={showSafe}
            template={visible}
            timeSeconds={timeSeconds}
          />

          {selected ? (
            <div className="scene-preset-row">
              <span>{tr("Готовый вход", "Entrance")}</span>
              {presets.map(({ preset, ru, en }) => (
                <button
                  key={preset}
                  onClick={() => patch(updateNode(template, selected.id, (node) =>
                    applyPreset(node, preset, template.director.inSeconds, template.director.outSeconds)))}
                  type="button"
                >
                  {tr(ru, en)}
                </button>
              ))}
            </div>
          ) : null}

          {issues.length > 0 ? (
            <ul className="scene-issues">
              {issues.map((issue, index) => (
                <li className={issue.severity} key={index}>
                  <AlertTriangle size={11} />
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="scene-issues-clean"><Check size={11} /> {tr("Шаблон собран без замечаний", "The template is clean")}</p>
          )}
        </div>


        <PanelDivider
          orientation="vertical"
          value={paneSizes.right}
          onDelta={(delta) => setPaneSizes((current) => ({
            ...current,
            right: clampPane(current.right - delta, 240, Math.min(520, window.innerWidth - current.left - 440)),
          }))}
          onReset={() => setPaneSizes((current) => ({ ...current, right: defaultPaneSizes.right }))}
        />

        <SceneInspector
          fonts={fonts}
          node={selected}
          onChange={(node) => patch(updateNode(template, node.id, () => node))}
          onChangeTemplate={(next) => patch(next)}
          onDeclareField={(nodeId, label) => patch(declareField(template, nodeId, label))}
          drawnBox={drawnBox}
          keyframes={keyframes}
          onPickMedia={onPickMedia}
          onFieldChange={(key, fieldPatch) => patch({
            ...template,
            fields: template.fields.map((field) => (field.key === key ? { ...field, ...fieldPatch } : field)),
          })}
          onRemoveField={(key) => patch(removeField(template, key))}
          target={editTarget}
          template={template}
        />
      </div>


      <PanelDivider
        orientation="horizontal"
        value={paneSizes.timeline}
        onDelta={(delta) => setPaneSizes((current) => ({
          ...current,
          timeline: clampPane(current.timeline - delta, 150, Math.max(150, window.innerHeight - 260)),
        }))}
        onReset={() => setPaneSizes((current) => ({ ...current, timeline: defaultPaneSizes.timeline }))}
      />

      <SceneTimeline
        durationSeconds={duration}
        node={selected}
        onDirector={(directorPatch) => patch({ ...template, director: { ...template.director, ...directorPatch } })}
        onDuration={onDurationChange}
        onKeyframeEasing={keyframeEasing}
        onSelectNode={(id) => selectNode(id)}
        onMoveKeyframes={shiftKeyframes}
        onRemoveKeyframe={dropKeyframe}
        onTime={setTimeSeconds}
        onTogglePlay={() => setPlaying((value) => !value)}
        playing={playing}
        template={template}
        timeSeconds={timeSeconds}
      />
    </div>
  );
});

function clampPane(value: number, minimum: number, maximum: number): number {
  return Math.round(Math.min(Math.max(minimum, maximum), Math.max(minimum, value)));
}

function PanelDivider({
  orientation, value, onDelta, onReset,
}: {
  orientation: "vertical" | "horizontal";
  value: number;
  onDelta: (delta: number) => void;
  onReset: () => void;
}) {
  const { tr } = useI18n();
  const drag = useRef<{ pointerId: number; at: number } | null>(null);
  const coordinate = (event: ReactPointerEvent) => orientation === "vertical" ? event.clientX : event.clientY;
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    try { event.currentTarget.releasePointerCapture(drag.current.pointerId); } catch { /* already released */ }
    drag.current = null;
  };
  return (
    <div
      aria-label={orientation === "vertical"
        ? tr("Изменить ширину панели", "Resize panel")
        : tr("Изменить высоту таймлайна", "Resize timeline")}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      className={`title-editor-divider ${orientation}`}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 12;
        if (orientation === "vertical" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          onDelta(event.key === "ArrowLeft" ? -step : step);
          event.preventDefault();
        }
        if (orientation === "horizontal" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          onDelta(event.key === "ArrowUp" ? -step : step);
          event.preventDefault();
        }
      }}
      onPointerCancel={end}
      onPointerDown={(event) => {
        drag.current = { pointerId: event.pointerId, at: coordinate(event) };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        const at = coordinate(event);
        onDelta(at - drag.current.at);
        drag.current.at = at;
      }}
      onPointerUp={end}
      role="separator"
      tabIndex={0}
    />
  );
}

/* -------------------------------- поля ------------------------------------ */

function SceneFields({
  template, selectedIsText, onDeclare, onRemove, onSample,
}: {
  template: SceneTemplate;
  selectedIsText: boolean;
  onDeclare: () => void;
  onRemove: (key: string) => void;
  onSample: (key: string, sample: string) => void;
}) {
  const { tr } = useI18n();
  return (
    <div className="scene-fields">
      <header>
        <span>{tr("Поля шаблона", "Template fields")}</span>
        <button disabled={!selectedIsText} onClick={onDeclare} title={tr(
          "Объявить полем текст выбранного узла",
          "Declare the selected text node as a field",
        )} type="button">
          <KeyRound size={11} />
        </button>
      </header>
      {template.fields.length === 0 ? (
        <p>
          {tr(
            "Поле — это то, что подставляет эфир. Без полей шаблон покажет только постоянный текст.",
            "A field is what playout fills in. Without fields the template shows static text only.",
          )}
        </p>
      ) : (
        <ul>
          {template.fields.map((field) => (
            <li key={field.key}>
              <div>
                <b>{field.label}</b>
                <code>{field.key}</code>
              </div>
              <input
                onChange={(event) => onSample(field.key, event.target.value)}
                placeholder={tr("образец", "sample")}
                value={field.sample}
              />
              <button onClick={() => onRemove(field.key)} type="button"><X size={11} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
