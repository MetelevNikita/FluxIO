import type { SceneNode, SceneNodeKind, SceneTemplate } from "@gruber/contracts";
import {
  ChevronDown, ChevronRight, Circle, Copy, Eye, EyeOff, Image as ImageIcon,
  Square, Trash2, Type, Video,
} from "lucide-react";
import { Fragment, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { nodeKindTitle, trackIsAnimated } from "../scene-edit";
import { useI18n } from "../i18n";

/* -------------------------------------------------------------------------- *
 * Дерево узлов.
 *
 * Порядок в списке — порядок наложения, как и в библиотеке эффектов. Список
 * **не сортируется**: его собрал дизайнер, и перестановка мышью — это правка
 * картинки, а не вида.
 *
 * Верхний в стопке показан первым: так его видит человек в кадре, и так же
 * устроены все редакторы, из которых он сюда пришёл.
 * ------------------------------------------------------------------------- */

const kindIcons: Record<SceneNodeKind, typeof Square> = {
  group: Square,
  rect: Square,
  ellipse: Circle,
  text: Type,
  image: ImageIcon,
  video: Video,
};

interface SceneTreeProps {
  template: SceneTemplate;
  selectedId: string | null;
  /** Весь набор выбранного, включая активный узел. */
  selectedIds: readonly string[];
  hiddenIds: ReadonlySet<string>;
  onSelect: (nodeId: string, additive?: boolean) => void;
  onMove: (movedId: string, parentId: string | null, beforeId: string | null) => void;
  onToggleHidden: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onRemove: (nodeId: string) => void;
  onRename: (nodeId: string, name: string) => void;
}

interface DropTarget {
  index: number;
  parentId: string | null;
  beforeId: string | null;
  intoGroupId: string | null;
}

export function SceneTree({
  template, selectedId, selectedIds, hiddenIds,
  onSelect, onMove, onToggleHidden, onDuplicate, onRemove, onRename,
}: SceneTreeProps) {
  const { tr } = useI18n();
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const dragRects = useRef(new Map<string, DOMRect>());
  // Свёрнутые группы. Группа собирается ради того, чтобы её содержимое ехало
  // одним целым, и после сборки читать её по слоям обычно уже не нужно.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const byId = new Map(template.nodes.map((node) => [node.id, node]));

  /** Глубина вложенности: она же величина сдвига строки вправо. */
  function depthOf(node: SceneNode): number {
    let depth = 0;
    let parentId = node.parentId;
    for (let step = 0; parentId && step < 8; step += 1) {
      depth += 1;
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return depth;
  }

  /** Прячет ли узел свёрнутый родитель — на любом уровне вложенности. */
  function hiddenByCollapse(node: SceneNode): boolean {
    let parentId = node.parentId;
    for (let step = 0; parentId && step < 8; step += 1) {
      if (collapsed.has(parentId)) return true;
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return false;
  }

  function toggleCollapsed(nodeId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(nodeId)) next.add(nodeId);
      return next;
    });
  }

  // Сверху вниз — от верхнего слоя к нижнему: так его видит человек в кадре.
  const ordered = [...template.nodes].reverse().filter((node) => !hiddenByCollapse(node));

  // Native dragover fires for every pointer pixel. Re-rendering the whole tree
  // for an unchanged target made rows shake under the pointer.
  function showDrop(next: DropTarget) {
    setDrop((current) => current && current.index === next.index &&
      current.parentId === next.parentId && current.beforeId === next.beforeId &&
      current.intoGroupId === next.intoGroupId ? current : next);
  }

  function commitDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!dragged || !drop) return;
    onMove(dragged, drop.parentId, drop.beforeId);
    dragRects.current.clear();
    setDragged(null);
    setDrop(null);
  }

  /** Можно ли положить перетаскиваемый узел в эту группу. */
  function acceptsDrop(groupId: string): boolean {
    if (!dragged || dragged === groupId) return false;
    // В собственного потомка узел не переезжает: цепочка родителей замкнулась
    // бы в кольцо, и раскладка ушла бы в бесконечный обход.
    let parentId: string | null = groupId;
    for (let step = 0; parentId && step < 8; step += 1) {
      if (parentId === dragged) return false;
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return byId.get(dragged)?.parentId !== groupId;
  }

  /**
   * Перенос в группу мышью.
   *
   * Середина строки группы кладёт узел внутрь, края — оставляют обычную
   * перестановку: иначе мимо группы стало бы невозможно протащить слой,
   * а порядок наложения задаёт именно перестановка.
   */
  function groupZone(event: DragEvent, rect: DOMRect): boolean {
    const offset = event.clientY - rect.top;
    return offset > rect.height * 0.25 && offset < rect.height * 0.75;
  }

  function selectOnPointerDown(event: PointerEvent, nodeId: string) {
    if ((event.target as HTMLElement).closest("button,input")) return;
    onSelect(nodeId, event.ctrlKey || event.metaKey || event.shiftKey);
  }

  return (
    <div className="scene-tree">
      <header>
        <span>{tr("Слои", "Layers")}</span>
        <small>{tr("сверху — ближе к зрителю", "top is nearest the viewer")}</small>
      </header>

      {ordered.length === 0 ? (
        <p className="scene-tree-empty">
          {tr("Пока пусто. Добавьте узел кнопками ниже.", "Empty. Add a node with the buttons below.")}
        </p>
      ) : null}

      {/* Пустое поле под списком — «вынуть из группы»: иначе узел, однажды
          попавший в группу, можно достать только роспуском всей группы. */}
      <ul
        className={dragged && byId.get(dragged)?.parentId ? "un-nesting" : ""}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.target === event.currentTarget) {
            showDrop({ index: ordered.length, parentId: null, beforeId: null, intoGroupId: null });
          }
        }}
        onDrop={commitDrop}
      >
        {ordered.map((node, index) => {
          const Icon = kindIcons[node.kind];
          const hidden = hiddenIds.has(node.id);
          // Анимация принадлежит узлу, а не сцене: у каждого слоя свои дорожки.
          // Без метки в списке это неочевидно — её и не находили.
          const animated = Object.values(node.transform)
            .some((track) => typeof track === "object" && track !== null && "inKeyframes" in track
              && trackIsAnimated(track as never));
          const depth = depthOf(node);
          const isOpenGroup = node.kind === "group" && !collapsed.has(node.id);
          return (
            <Fragment key={node.id}>
              {drop?.index === index ? (
                <li
                  aria-hidden="true"
                  className="scene-tree-drop-placeholder"
                  style={{ marginLeft: 10 + depth * 14 }}
                />
              ) : null}
              <li
              key={node.id}
              data-node-id={node.id}
              style={{ paddingLeft: 10 + depth * 14 }}
              className={`${node.id === selectedId ? "selected" : ""} ${
                selectedIds.includes(node.id) && node.id !== selectedId ? "co-selected" : ""
              } ${hidden ? "hidden-node" : ""} ${node.parentId ? "in-group" : ""} ${
                drop?.intoGroupId === node.id ? "drop-into" : ""
              }`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", node.id);
                dragRects.current = new Map(Array.from(
                  event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("li[data-node-id]") ?? [],
                  (row) => [row.dataset.nodeId ?? "", row.getBoundingClientRect()],
                ));
                setDragged(node.id);
              }}
              onDragEnd={() => { dragRects.current.clear(); setDragged(null); setDrop(null); }}
              onDragOver={(event) => {
                event.preventDefault();
                if (node.id === dragged) return;
                const rect = dragRects.current.get(node.id) ?? event.currentTarget.getBoundingClientRect();
                const into = node.kind === "group" && acceptsDrop(node.id) && groupZone(event, rect);
                if (into) {
                  const firstChild = ordered.find((entry) => entry.parentId === node.id);
                  showDrop({
                    index: index + 1,
                    parentId: node.id,
                    beforeId: firstChild?.id ?? null,
                    intoGroupId: node.id,
                  });
                  return;
                }
                const after = event.clientY - rect.top >= rect.height / 2;
                const siblings = ordered.filter((entry) => entry.parentId === node.parentId);
                const siblingIndex = siblings.findIndex((entry) => entry.id === node.id);
                showDrop({
                  index: index + (after ? 1 : 0),
                  parentId: node.parentId,
                  beforeId: after ? siblings[siblingIndex + 1]?.id ?? null : node.id,
                  intoGroupId: null,
                });
              }}
              onDrop={commitDrop}
              onPointerDown={(event) => selectOnPointerDown(event, node.id)}
              onDoubleClick={() => setRenaming(node.id)}
            >
              {node.kind === "group" ? (
                <button
                  className="scene-tree-twist"
                  onClick={(event) => { event.stopPropagation(); toggleCollapsed(node.id); }}
                  title={isOpenGroup
                    ? tr("Свернуть группу", "Collapse group")
                    : tr("Раскрыть группу", "Expand group")}
                  type="button"
                >
                  {isOpenGroup ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              ) : <span className="scene-tree-twist" />}
              <Icon size={13} />
              {renaming === node.id ? (
                <input
                  autoFocus
                  defaultValue={node.name}
                  onBlur={(event) => { onRename(node.id, event.target.value.trim() || node.name); setRenaming(null); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") setRenaming(null);
                  }}
                  onClick={(event) => event.stopPropagation()}
                />
              ) : (
                <span className="scene-tree-name" title={node.name}>{node.name}</span>
              )}
              {animated ? (
                <b className="scene-tree-animated" title={tr(
                  "У слоя своя анимация — дорожки внизу",
                  "This layer has its own animation — tracks below",
                )}>◆</b>
              ) : null}
              <em>{nodeKindTitle(node.kind, tr)}</em>
              <button
                className="scene-tree-action"
                onClick={(event) => { event.stopPropagation(); onToggleHidden(node.id); }}
                title={tr("Скрыть в редакторе (в эфир не влияет)", "Hide in the editor (does not affect air)")}
                type="button"
              >
                {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button
                className="scene-tree-action"
                onClick={(event) => { event.stopPropagation(); onDuplicate(node.id); }}
                title={tr("Дублировать", "Duplicate")}
                type="button"
              >
                <Copy size={12} />
              </button>
              <button
                className="scene-tree-action danger"
                onClick={(event) => { event.stopPropagation(); onRemove(node.id); }}
                title={tr("Удалить", "Delete")}
                type="button"
              >
                <Trash2 size={12} />
              </button>
              </li>
            </Fragment>
          );
        })}
        {drop?.index === ordered.length ? <li aria-hidden="true" className="scene-tree-drop-placeholder" /> : null}
      </ul>
    </div>
  );
}
