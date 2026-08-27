import type { SceneNode, SceneNodeKind, SceneTemplate } from "@gruber/contracts";
import {
  Circle, Copy, Eye, EyeOff, Image as ImageIcon,
  Square, Trash2, Type, Video,
} from "lucide-react";
import { useState, type DragEvent } from "react";
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
  hiddenIds: ReadonlySet<string>;
  onSelect: (nodeId: string) => void;
  onReorder: (movedId: string, beforeId: string | null) => void;
  onToggleHidden: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onRemove: (nodeId: string) => void;
  onRename: (nodeId: string, name: string) => void;
}

export function SceneTree({
  template, selectedId, hiddenIds,
  onSelect, onReorder, onToggleHidden, onDuplicate, onRemove, onRename,
}: SceneTreeProps) {
  const { tr } = useI18n();
  const [dragged, setDragged] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  // Сверху вниз — от верхнего слоя к нижнему: так его видит человек в кадре.
  const ordered = [...template.nodes].reverse();

  function handleDrop(event: DragEvent, beforeId: string | null) {
    event.preventDefault();
    if (!dragged) return;
    onReorder(dragged, beforeId);
    setDragged(null);
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

      <ul onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDrop(event, null)}>
        {ordered.map((node, index) => {
          const Icon = kindIcons[node.kind];
          const hidden = hiddenIds.has(node.id);
          // Анимация принадлежит узлу, а не сцене: у каждого слоя свои дорожки.
          // Без метки в списке это неочевидно — её и не находили.
          const animated = Object.values(node.transform)
            .some((track) => typeof track === "object" && track !== null && "inKeyframes" in track
              && trackIsAnimated(track as never));
          // Перетаскивание в списке идёт сверху вниз, а порядок наложения —
          // снизу вверх: цель вставки берём из исходного массива.
          const below = ordered[index + 1];
          return (
            <li
              key={node.id}
              className={`${node.id === selectedId ? "selected" : ""} ${hidden ? "hidden-node" : ""}`}
              draggable
              onDragStart={() => setDragged(node.id)}
              onDragEnd={() => setDragged(null)}
              onDrop={(event) => { event.stopPropagation(); handleDrop(event, below ? below.id : null); }}
              onClick={() => onSelect(node.id)}
              onDoubleClick={() => setRenaming(node.id)}
            >
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
              <em>{nodeKindTitle(node.kind)}</em>
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
          );
        })}
      </ul>
    </div>
  );
}

export function isTextNode(node: SceneNode): boolean {
  return node.kind === "text";
}
