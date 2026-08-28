import {
  sceneFormatSchema,
  sceneSegmentAt,
  sceneTiming,
  type SceneLayoutTarget,
  type SceneBezier,
  type SceneKeyframe,
  type SceneNode,
  type SceneNodeKind,
  type SceneTemplate,
  type SystemFont,
} from "@gruber/contracts";
import {
  AlertTriangle, Check, Circle, FileDown, Film, FolderOpen, Image as ImageIcon,
  Group, Redo2, Undo2, Ungroup,
  KeyRound, Ruler, Save, Sparkles, Square, Type, X,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import { SceneCanvas } from "../title-editor/SceneCanvas";
import { SceneInspector, type KeyableTrack } from "../title-editor/SceneInspector";
import { SceneTimeline, type TrackKey } from "../title-editor/SceneTimeline";
import { SceneTree } from "../title-editor/SceneTree";
import { useSceneHistory } from "../title-editor/useSceneHistory";
import {
  addNode, applyPreset, createSceneNode, declareField, duplicateNode,
  groupNodes, moveKeyframe, removeField, removeKeyframe, removeNode, reorderNode,
  sampleFieldValues, sceneIssues, setKeyframe, setKeyframeEasing, trackIsAnimated,
  ungroupNode, updateNode,
  type ScenePreset, type SceneSegmentSide,
} from "../scene-edit";
import { useI18n } from "../i18n";
import { layoutFormats, layoutTitles } from "../scene-layouts";

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
  /** Сохранить шаблон отдельным файлом `.fto`. */
  onSaveAs: () => void;
  /** Открыть каталог готовых титров. */
  onOpenLibrary: () => void;
  onSave: () => void;
  onClose: () => void;
}

export const TitleEditorScreen = memo(function TitleEditorScreen({
  template, fonts, backdropUrl, durationSeconds, busy,
  onChange, onDurationChange, onPickMedia, onSaveAs, onOpenLibrary, onSave, onClose,
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
  // Длина показа приходит из настроек эффекта и туда же возвращается: в эфире
  // режиссёр считает удержание именно от неё.
  const duration = durationSeconds;

  const format = useMemo(
    () => sceneFormatSchema.parse({ layout: target, ...layoutFormats[target] }),
    [target],
  );

  // Узлы, скрытые в редакторе, из шаблона не вынимаются: скрытие — оснастка,
  // а не свойство сцены, и в эфир оно не уходит.
  const visible = useMemo<SceneTemplate>(() => ({
    ...template,
    nodes: template.nodes.filter((node) => !hiddenIds.has(node.id)),
  }), [template, hiddenIds]);

  const selected = template.nodes.find((node) => node.id === selectedId) ?? null;
  const fields = useMemo(() => sampleFieldValues(template), [template]);
  const issues = useMemo(() => sceneIssues(template, format), [template, format]);
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
    const node = createSceneNode(template, kind);
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

  function shiftKeyframe(
    nodeId: string, key: TrackKey, side: SceneSegmentSide, fromSeconds: number, toSeconds: number,
  ) {
    patch(updateNode(template, nodeId, (node) => ({
      ...node,
      transform: {
        ...node.transform,
        [key]: moveKeyframe(node.transform[key], side, fromSeconds, toSeconds),
      },
    })));
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
  const keyAt = segment.segment === "out" ? segment.localSeconds : segment.localSeconds;

  const keyframes = {
    enabled: segment.segment !== "hold" && selected !== null,
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
            : setKeyframe(node.transform[track], keySide, keyAt, node.transform[track].value),
        },
      })), true);
    },
  };

  return (
    <div className="title-editor">
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
          <button onClick={onClose} type="button"><X size={13} /></button>
        </div>
      </header>

      <div className="title-editor-body">
        <div className="title-editor-left">
          <SceneTree
            hiddenIds={hiddenIds}
            onDuplicate={(id) => patch(duplicateNode(template, id), true)}
            onRemove={(id) => { patch(removeNode(template, id), true); if (id === selectedId) selectNode(null); }}
            onRename={(id, name) => patch(updateNode(template, id, (node) => ({ ...node, name })))}
            onReorder={(moved, before) => patch(reorderNode(template, moved, before), true)}
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
                const result = groupNodes(template, selectedIds);
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

        <div className="title-editor-center">
          <div className="scene-edit-target">
            <span>{tr("Правки идут", "Edits land")}</span>
            <button className={editTarget === null ? "active" : ""} onClick={() => setEditTarget(null)} type="button">
              {tr("в общую сцену", "in the shared scene")}
            </button>
            <button className={editTarget === target ? "active" : ""} onClick={() => setEditTarget(target)} type="button">
              {tr(`поправкой ${layoutTitles[target]}`, `as a ${layoutTitles[target]} override`)}
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

      <SceneTimeline
        durationSeconds={duration}
        node={selected}
        onDirector={(directorPatch) => patch({ ...template, director: { ...template.director, ...directorPatch } })}
        onDuration={onDurationChange}
        onKeyframeEasing={keyframeEasing}
        onSelectNode={(id) => selectNode(id)}
        onMoveKeyframe={shiftKeyframe}
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
